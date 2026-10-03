import { it, expect, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { SessionStore, BusyError } from './store.js';

vi.mock('node:fs/promises', async importOriginal => ({ ...await importOriginal<typeof fs>() }));

it('validates completed receipt metadata while retaining legacy conversations', async () => {
 const dir = await mkdtemp(join(tmpdir(), 'piton-receipt-'));
 const store = new SessionStore(dir);
 const id = '11111111-1111-4111-8111-111111111111';
 const completedTurn = { projectId: id, documentId: id, runId: id, requestId: id };
 const record = { version: 1, sessionId: 'test-session', uncertain: false, messages: [{ role: 'user', content: 'question' }, { role: 'assistant', content: 'answer' }], completedTurn };
 try {
  await writeFile(join(dir, 'scope.json'), JSON.stringify(record), { mode: 0o600 });
  expect((await store.load('scope')).completedTurn).toEqual(completedTurn);
  for (const invalid of [null, [], {}, { ...completedTurn, runId: 'bad' }, { ...completedTurn, requestId: 1 }, { ...completedTurn, extra: id }]) {
   await writeFile(join(dir, 'scope.json'), JSON.stringify({ ...record, completedTurn: invalid }));
   await expect(store.load('scope')).rejects.toThrow('Invalid receipt');
  }
  await writeFile(join(dir, 'scope.json'), JSON.stringify({ ...record, uncertain: true }));
  await expect(store.load('scope')).rejects.toThrow('Invalid receipt');
  await writeFile(join(dir, 'scope.json'), JSON.stringify({ ...record, completedTurn: undefined }));
  expect((await store.load('scope')).completedTurn).toBeUndefined();
 } finally { await rm(dir, { recursive: true, force: true }); }
});

it('fails closed on orphan recovery fences for normal and recovery acquisition', async () => {
 const dir = await mkdtemp(join(tmpdir(), 'piton-fence-'));
 const store = new SessionStore(dir);
 try {
  for (const kind of ['orphan', 'unsafe', 'symlink']) {
   const fence = join(dir, kind + '.lock.recovery');
   if (kind === 'symlink') await symlink(join(dir, 'orphan.lock.recovery'), fence);
   else await mkdir(fence, { mode: kind === 'unsafe' ? 0o755 : 0o700 });
   for (const recover of [false, true]) {
    const callback = vi.fn(async () => {});
    await expect(store.locked(kind, callback, recover)).rejects.toBeInstanceOf(BusyError);
    expect(callback).not.toHaveBeenCalled();
    expect(await store.lockState(kind)).toBe('absent');
   }
   expect((await readdir(dir)).includes(kind + '.lock.recovery')).toBe(true);
  }
 } finally { await rm(dir, { recursive: true, force: true }); }
});
it('arbitrates normal and recovery acquisition across the archived-lock gap', async () => {
 const dir = await mkdtemp(join(tmpdir(), 'piton-race-'));
 const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)']);
 let release!: () => void;
 const gate = new Promise<void>(resolve => { release = resolve; });
 let entered!: () => void;
 const entry = new Promise<void>(resolve => { entered = resolve; });
 const rename = fs.rename;
 let recovering: Promise<void> | undefined;
 try {
  const stat = await readFile(`/proc/${child.pid}/stat`, 'utf8');
  const owner = { version: 1, pid: child.pid, start: stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19], boot: (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim(), token: 'race-owner' };
  await mkdir(join(dir, 'scope.lock'), { mode: 0o700 });
  await writeFile(join(dir, 'scope.lock', 'owner.json'), JSON.stringify(owner), { mode: 0o600 });
  child.kill('SIGKILL'); await once(child, 'exit');
  vi.spyOn(fs, 'rename').mockImplementation(async (source, target) => {
   await rename(source, target);
   if (source === join(dir, 'scope.lock')) { entered(); await gate; }
  });
  const store = new SessionStore(dir);
  const recovered = vi.fn(async () => {});
  recovering = store.locked('scope', recovered, true);
  await entry;
  for (const recover of [false, true]) {
   const callback = vi.fn(async () => {});
   await expect(store.locked('scope', callback, recover)).rejects.toBeInstanceOf(BusyError);
   expect(callback).not.toHaveBeenCalled();
  }
  release(); await recovering;
  expect(recovered).toHaveBeenCalledTimes(1);
  const archives = (await readdir(dir)).filter(name => name.includes('.recovered-'));
  expect(archives).toHaveLength(1);
  expect(JSON.parse(await readFile(join(dir, archives[0], 'owner.json'), 'utf8'))).toEqual(owner);
  await expect(store.locked('scope', async () => 'normal')).resolves.toBe('normal');
 } finally {
  release(); await recovering?.catch(() => {}); vi.restoreAllMocks();
  child.kill(); await rm(dir, { recursive: true, force: true });
 }
});


it('reclaims only a proven exited Linux owner, fences recovery and retains evidence', async () => {
 const dir = await mkdtemp(join(tmpdir(), 'piton-lock-'));
 const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)']);
 try {
  const stat = await readFile(`/proc/${child.pid}/stat`, 'utf8');
  const owner = { version: 1, pid: child.pid, start: stat.slice(stat.lastIndexOf(')')+2).split(' ')[19], boot: (await readFile('/proc/sys/kernel/random/boot_id','utf8')).trim(), token: 'durable-test-owner' };
  await mkdir(join(dir,'scope.lock'), {mode:0o700});
  await writeFile(join(dir,'scope.lock','owner.json'),JSON.stringify(owner), {mode:0o600});
  const store = new SessionStore(dir);
  await expect(store.locked('scope',async()=>{},true)).rejects.toBeInstanceOf(BusyError);
  await writeFile(join(dir,'scope.lock','owner.json'),JSON.stringify({...owner,start:'0'}));
  expect(await store.lockState('scope')).toBe('unknown');
  await expect(store.locked('scope',async()=>{},true)).rejects.toBeInstanceOf(BusyError);
  await writeFile(join(dir,'scope.lock','owner.json'),JSON.stringify(owner));
  child.kill('SIGKILL'); await once(child,'exit');
  expect(await store.lockState('scope')).toBe('dead');
  let release!:()=>void; const gate = new Promise<void>(r=>{release=r;});
  let entered!:()=>void; const entry = new Promise<void>(r=>{entered=r;});
  const first = store.locked('scope',async()=>{entered();await gate;},true);
  await entry;
  await expect(store.locked('scope',async()=>{},true)).rejects.toBeInstanceOf(BusyError);
  release();await first;
  const archives = (await readdir(dir)).filter(n=>n.includes('.recovered-'));
  expect(archives).toHaveLength(1);
  expect(JSON.parse(await readFile(join(dir,archives[0],'owner.json'),'utf8'))).toEqual(owner);
 } finally { child.kill();await rm(dir,{recursive:true,force:true}); }
});
it('denies unknown and symlink locks without removing evidence',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'piton-lock-'));const store=new SessionStore(dir);
 try {
  await mkdir(join(dir,'unknown.lock'),{mode:0o700});
  await expect(store.locked('unknown',async()=>{},true)).rejects.toBeInstanceOf(BusyError);
  await symlink(join(dir,'unknown.lock'),join(dir,'unsafe.lock'));
  await expect(store.locked('unsafe',async()=>{},true)).rejects.toBeInstanceOf(BusyError);
  expect(await store.lockState('unsafe')).toBe('unknown');
  await symlink(join(dir,'unknown.lock'),join(dir,'unknown.lock','owner.json'));
  expect(await store.lockState('unknown')).toBe('unknown');
  await expect(store.locked('unknown',async()=>{},true)).rejects.toBeInstanceOf(BusyError);
 } finally { await rm(dir,{recursive:true,force:true}); }
});
