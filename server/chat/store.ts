import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, rename, rm, lstat, readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

export type Message = { role: 'user' | 'assistant'; content: string };
export type TurnReceipt = { projectId: string; documentId: string; runId: string; requestId: string };
export type Conversation = { version: 1; sessionId?: string; uncertain?: boolean; messages: Message[]; completedTurn?: TurnReceipt };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function validTurnReceipt(value: unknown): value is TurnReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const receipt = value as Record<string, unknown>;
  return Object.keys(receipt).length === 4 && ['projectId', 'documentId', 'runId', 'requestId'].every(field =>
    typeof receipt[field] === 'string' && uuid.test(receipt[field] as string));
}
export class BusyError extends Error {}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

/** Private transport metadata only. Never imports or writes product/CAD storage. */
export class SessionStore {
  constructor(private readonly directory: string) {
    if (!isAbsolute(directory)) throw new Error('Private absolute storage directory required');
  }
  private async ready() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const stat = await lstat(this.directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) || stat.uid !== process.getuid?.()) throw new Error('Unsafe storage');
  }
  key(principal: string, projectId: string, documentId: string) {
    return hash(JSON.stringify(['nick-mercer', principal, projectId, documentId]));
  }
  private async read(path: string): Promise<string | undefined> {
    let file;
    try { file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw e; }
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > 1_048_576 || stat.uid !== process.getuid?.() || (stat.mode & 0o077)) throw new Error('Unsafe record');
      return await file.readFile('utf8');
    } finally { await file.close(); }
  }
  async load(key: string): Promise<Conversation> {
    await this.ready();
    const raw = await this.read(join(this.directory, key + '.json'));
    if (raw === undefined) return { version: 1, messages: [] };
    const record = JSON.parse(raw) as Conversation;
    if (record.version !== 1 || !Array.isArray(record.messages) || record.messages.length > 100 ||
      record.messages.some(m => !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string' || m.content.length > 65_536) ||
      (record.sessionId !== undefined && !/^[a-zA-Z0-9_-]{1,160}$/.test(record.sessionId))) throw new Error('Invalid record');
    if (record.completedTurn !== undefined && (!validTurnReceipt(record.completedTurn) || !record.sessionId ||
        record.uncertain !== false || record.messages.at(-1)?.role !== 'assistant' || record.messages.at(-2)?.role !== 'user')) throw new Error('Invalid receipt');
    return record;
  }
  async save(key: string, record: Conversation) {
    while (record.messages.length > 100 || Buffer.byteLength(JSON.stringify(record.messages)) > 524_288) record.messages.shift();
    const target = join(this.directory, key + '.json');
    const temporary = target + '.' + randomUUID() + '.tmp';
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(record)); await file.sync(); }
    finally { await file.close(); }
    try {
      await rename(temporary, target);
      const directory = await open(this.directory, 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    } finally { await rm(temporary, { force: true }); }
  }
  /** Persistent reservation prevents even an upstream ID collision crossing scopes. */
  async bind(key: string, sessionId: string) {
    const path = join(this.directory, 'owner-' + hash(sessionId));
    let file;
    try { file = await open(path, 'wx', 0o600); }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST' || await this.read(path) !== key) throw new Error('Session ownership conflict');
      return;
    }
    try { await file.writeFile(key); await file.sync(); } finally { await file.close(); }
  }
  /** Missing, legacy, unsafe and PID-reused owners are never dead evidence. */
  async lockState(key: string): Promise<'absent' | 'live' | 'dead' | 'unknown'> {
    await this.ready();
    const lock = join(this.directory, key + '.lock');
    try {
      const stat = await lstat(lock);
      if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o077)) return 'unknown';
      const raw = await this.read(join(lock, 'owner.json'));
      if (!raw || process.platform !== 'linux') return 'unknown';
      const owner = JSON.parse(raw);
      if (owner.version !== 1 || !Number.isSafeInteger(owner.pid) || owner.pid <= 0 ||
          typeof owner.start !== 'string' || !/^\d+$/.test(owner.start) || typeof owner.token !== 'string' || !owner.token ||
          owner.boot !== (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim()) return 'unknown';
      try {
        const proc = await readFile(`/proc/${owner.pid}/stat`, 'utf8');
        return proc.slice(proc.lastIndexOf(')') + 2).split(' ')[19] === owner.start ? 'live' : 'unknown';
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return 'unknown';
        try { process.kill(owner.pid, 0); return 'unknown'; }
        catch (probe) { return (probe as NodeJS.ErrnoException).code === 'ESRCH' ? 'dead' : 'unknown'; }
      }
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'absent' : 'unknown';
    }
  }
  async archive(key: string) {
    const record = await this.load(key);
    await this.save(key + '.recovered-' + randomUUID(), record);
  }
  async locked<T>(key: string, run: () => Promise<T>, recover = false): Promise<T> {
    await this.ready();
    const lock = join(this.directory, key + '.lock');
    // Every acquisition arbitrates on the same exclusive fence, including when
    // the original lock is absent. Interrupted fences require manual review;
    // their owner is never assumed dead or automatically reclaimed.
    const fence = lock + '.recovery';
    try { await mkdir(fence, { mode: 0o700 }); } catch { throw new BusyError(); }
    let identity: Awaited<ReturnType<typeof lstat>>;
    try {
      try { await mkdir(lock, { mode: 0o700 }); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        if (!recover || await this.lockState(key) !== 'dead') throw new BusyError();
        await rename(lock, lock + '.recovered-' + randomUUID());
        try { await mkdir(lock, { mode: 0o700 }); } catch { throw new BusyError(); }
      }
      const proc = await readFile('/proc/self/stat', 'utf8');
      const owner = { version: 1, pid: process.pid, start: proc.slice(proc.lastIndexOf(')') + 2).split(' ')[19],
        boot: (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim(), token: randomUUID() };
      const file = await open(join(lock, 'owner.json'), 'wx', 0o600);
      try { await file.writeFile(JSON.stringify(owner)); await file.sync(); } finally { await file.close(); }
      identity = await lstat(lock);
    } finally { await rm(fence, { recursive: true }); }
    try { return await run(); } finally {
      const current = await lstat(lock);
      if (current.ino === identity.ino && current.dev === identity.dev && !current.isSymbolicLink()) await rm(lock, { recursive: true });
    }
  }
}
