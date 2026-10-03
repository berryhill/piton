import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, rename, rm, lstat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

export type Message = { role: 'user' | 'assistant'; content: string };
export type Conversation = { version: 1; sessionId?: string; uncertain?: boolean; messages: Message[] };
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
  async locked<T>(key: string, run: () => Promise<T>): Promise<T> {
    await this.ready();
    const lock = join(this.directory, key + '.lock');
    try { await mkdir(lock, { mode: 0o700 }); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new BusyError(); throw e; }
    try { return await run(); } finally { await rm(lock, { recursive: true }); }
  }
}
