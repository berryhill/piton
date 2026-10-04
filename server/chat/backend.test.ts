// Local mock and synthetic state only; no real Hermes session or credentials.
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs, { rename, open, link } from 'node:fs/promises';
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename), open: vi.fn(actual.open), link: vi.fn(actual.link) };
});
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { ConversationLedger, createBackendService, type BackendOptions } from './backend.js';
import { SessionStore } from './store.js';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const servers: Server[] = [];
const directories: string[] = [];
const projectId = '11111111-1111-4111-8111-111111111111';
async function listen(server: Server): Promise<string> {
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test listener');
  return `http://127.0.0.1:${address.port}`;
}
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
  for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function waitForProjectCleanup(stateDirectory: string, id = projectId) {
  await vi.waitFor(async () => {
    await expect(fs.lstat(join(stateDirectory, 'project-locks', id + '.lock'))).rejects.toMatchObject({ code: 'ENOENT' });
  }, { timeout: 1000, interval: 5 });
}

async function fixture(verifier?: BackendOptions['verifyConversationIsolation'], mode: 'complete' | 'interrupt-once' | 'wait' = 'complete', answer = 'mock answer') {
  const calls: { path: string; host: string | undefined; origin: string | undefined }[] = [];
  const inputs: string[] = []; let sessions = 0; let turns = 0;
  const upstream = await listen(createServer(async (req, res) => {
    calls.push({ path: req.url ?? '', host: req.headers.host, origin: req.headers.origin });
    if (req.url === '/p/nick-mercer/v1/models') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ data: [{ id: 'test-model' }] })); return; }
    if (req.url === '/p/nick-mercer/api/sessions') { sessions++; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ session: { id: sessions === 1 ? 'test-session' : `test-session-${sessions}` } })); return; }
    const match = req.url?.match(/\/api\/sessions\/(test-session(?:-\d+)?)\/chat\/stream$/);
    if (match) {
      let body = ''; for await (const chunk of req) body += chunk;
      inputs.push(JSON.parse(body).input); turns++;
      res.setHeader('Content-Type', 'text/event-stream');
      if (mode === 'wait') { res.flushHeaders(); res.write(': waiting\n\n'); return; }
      if (mode === 'interrupt-once' && turns === 1) { res.end('event: assistant.delta\ndata: {"delta":"partial"}\n\n'); return; }
      res.end(`event: assistant.completed\ndata: ${JSON.stringify({session_id: match[1], content: answer, completed: true})}\n\n`);
      return;
    }
    res.statusCode = 404; res.end();
  }));
  const stateDirectory = await mkdtemp(join(process.cwd(), '.piton-chat-test-')); directories.push(stateDirectory);
  // Public test listener needs the exact advertised origin. Bind a reserved port first.
  const reservation = createServer();
  const base = await listen(reservation);
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  servers.splice(servers.indexOf(reservation), 1);
  const backend = createBackendService({
    origin: base, stateDirectory, allowLocalBootstrap: true,
    env: { PITON_HERMES_UPSTREAM: upstream, API_SERVER_KEY: `synthetic-${randomUUID()}` },
    verifyConversationIsolation: verifier,
  });
  const publicServer = createServer(backend.handler);
  servers.push(publicServer);
  await new Promise<void>(resolve => publicServer.listen(Number(new URL(base).port), '127.0.0.1', resolve));
  const bootstrap = await fetch(base + '/api/chat/bootstrap');
  expect(bootstrap.status).toBe(200);
  const cookie = bootstrap.headers.get('set-cookie')?.split(';')[0] ?? '';
  const csrf = (await bootstrap.json()).csrfToken as string;
  async function call(path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
    return fetch(base + '/api/chat/' + path, {
      method,
      headers: { cookie, origin: base, 'x-piton-csrf': csrf, 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  expect((await call('projects', 'POST', { projectId })).status).toBe(200);
  return { backend, call, calls, inputs, upstream, base, stateDirectory };
}

describe('backend confinement and bridge routing', () => {
  it('rejects an impossible single UTF-8 record without changing the published ledger', async () => {
    const directory = await mkdtemp(join(process.cwd(), '.piton-chat-test-')); directories.push(directory);
    const ledger = new ConversationLedger(directory);
    const message = { role: 'user' as const, content: 'retained question' };
    await ledger.append(projectId, null, message);
    const target = join(directory, (await fs.readdir(directory))[0]);
    const before = await fs.readFile(target);
    await expect(ledger.append(projectId, null, { role: 'assistant', content: '界'.repeat(174_763) })).rejects.toThrow('Conversation message too large');
    expect(await fs.readFile(target)).toEqual(before);
    expect(await ledger.load(projectId, null)).toEqual([message]);
    expect(await fs.readdir(directory)).toHaveLength(1);
  });
  it.each(['x'.repeat(65_536), '界'.repeat(32_768)])('keeps large reply rollover readable through next turn and receipt recovery (%#)', async answer => {
    const f = await fixture(async () => true, 'complete', answer);
    try {
      for (let i = 0; i < 8; i++) {
        expect(await (await f.call('conversation', 'POST', { projectId, message: `query-${i}` })).text()).toContain('event: assistant.completed');
        await waitForProjectCleanup(f.stateDirectory);
      }
      const history = await f.call('history?projectId=' + projectId);
      expect(history.status).toBe(200);
      const messages = (await history.json()).messages;
      expect(messages.length).toBeLessThan(16);
      expect(messages.slice(-2)).toEqual([{ role: 'user', content: 'query-7' }, { role: 'assistant', content: answer }]);
      const ledger = join(f.stateDirectory, 'conversations', (await fs.readdir(join(f.stateDirectory, 'conversations'))).find(name => name.endsWith('.json'))!);
      expect((await fs.stat(ledger)).size).toBeLessThanOrEqual(524_288);
      let failed = false;
      vi.mocked(rename).mockImplementation(async (source, target) => {
        if (!failed && String(target) === ledger && JSON.parse(await fs.readFile(source, 'utf8')).messages.at(-1)?.role === 'assistant') {
          failed = true; throw new Error('injected large reply append failure');
        }
        return fs.rename(source, target);
      });
      const input = { projectId, message: 'query-8', requestId: randomUUID() };
      expect(await (await f.call('conversation', 'POST', input)).text()).toContain('event: error');
      expect(failed).toBe(true);
      await waitForProjectCleanup(f.stateDirectory);
      expect((await f.call('history?projectId=' + projectId)).status).toBe(200);
      expect((await f.call('recover', 'POST', { projectId })).status).toBe(200);
      const recovered = await f.call('history?projectId=' + projectId);
      expect(recovered.status).toBe(200);
      expect((await recovered.json()).messages.slice(-2)).toEqual([{ role: 'user', content: input.message }, { role: 'assistant', content: answer }]);
      expect((await fs.stat(ledger)).size).toBeLessThanOrEqual(524_288);
      expect(await (await f.call('conversation', 'POST', input)).json()).toEqual({ error: 'duplicate_request' });
      expect(f.inputs).toHaveLength(9);
    } finally { vi.mocked(rename).mockImplementation(fs.rename); await f.backend.shutdown(); }
  });
  it('reports a proven process crash and explicitly recovers both durable locks without replay', async () => {
    const f = await fixture(async () => true);
    const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)']);
    try {
      const target = join(f.stateDirectory, 'projects', projectId + '.json');
      const project = JSON.parse(await fs.readFile(target, 'utf8'));
      await fs.writeFile(target, JSON.stringify({ ...project, status: 'running' }));
      const bridge = new SessionStore(join(f.stateDirectory, 'bridge'));
      const key = bridge.key(project.principal, projectId, '00000000-0000-4000-8000-000000000000');
      await bridge.load(key);
      const uncertain = { version: 1 as const, sessionId: 'uncertain-session', uncertain: true, messages: [{ role: 'user' as const, content: 'uncertain turn' }] };
      await bridge.save(key, uncertain);
      const ledger = join(f.stateDirectory, 'conversations');
      await fs.mkdir(ledger, { mode: 0o700 });
      const { createHash } = await import('node:crypto');
      await fs.writeFile(join(ledger, createHash('sha256').update(`${projectId}:00000000-0000-4000-8000-000000000000`).digest('hex') + '.json'), JSON.stringify({ messages: uncertain.messages }), { mode: 0o600 });
      const proc = await fs.readFile(`/proc/${child.pid}/stat`, 'utf8');
      const owner = { version: 1, pid: child.pid, start: proc.slice(proc.lastIndexOf(')') + 2).split(' ')[19], boot: (await fs.readFile('/proc/sys/kernel/random/boot_id','utf8')).trim(), token: 'crash-test' };
      for (const [directory, scope] of [['project-locks', projectId], ['bridge', key]]) {
        await fs.mkdir(join(f.stateDirectory, directory), { recursive: true, mode: 0o700 });
        await fs.mkdir(join(f.stateDirectory, directory, scope + '.lock'), { mode: 0o700 });
        await fs.writeFile(join(f.stateDirectory, directory, scope + '.lock', 'owner.json'), JSON.stringify(owner), { mode: 0o600 });
      }
      expect(await (await f.call('history?projectId=' + projectId)).json()).toMatchObject({ blocked: false, status: 'running' });
      expect((await f.call('recover','POST',{projectId})).status).toBe(409);
      child.kill('SIGKILL'); await once(child, 'exit');
      expect(await (await f.call('history?projectId=' + projectId)).json()).toMatchObject({ blocked: true, recoveryRequired: true, status: 'interrupted' });
      expect((await f.call('conversation','POST',{projectId,message:'do not replay'})).status).toBe(409);
      expect((await f.call('recover','POST',{projectId},{cookie:''})).status).toBe(401);
      expect((await f.call('recover','POST',{projectId})).status).toBe(200);
      expect(f.inputs).toHaveLength(0);
      expect(await (await f.call('history?projectId=' + projectId)).json()).toMatchObject({status:'idle',messages:uncertain.messages});
      const archives = (await fs.readdir(join(f.stateDirectory,'bridge'))).filter(n=>n.startsWith(key+'.recovered-') && n.endsWith('.json'));
      expect(archives).toHaveLength(1);
      expect(JSON.parse(await fs.readFile(join(f.stateDirectory,'bridge',archives[0]),'utf8'))).toEqual(uncertain);
    } finally { child.kill(); await f.backend.shutdown(); }
  });

  it.each(['projects', 'conversations'])('cleans registered runs after a %s storage failure', async directory => {
    const f = await fixture(async () => true);
    let failed = false;
    vi.mocked(rename).mockImplementation(async (source, target) => {
      if (!failed && String(target).startsWith(join(f.stateDirectory, directory) + '/')) {
        failed = true;
        throw new Error('injected storage failure');
      }
      return fs.rename(source, target);
    });
    try {
      expect((await f.call('conversation', 'POST', { projectId, message: 'failed turn' })).status).toBe(503);
      expect(failed).toBe(true);
      expect(await (await f.call('history?projectId=' + projectId)).json()).toMatchObject({ status: 'interrupted', blocked: true });
      expect(await (await f.call('stop', 'POST', { projectId })).json()).toEqual({ stopped: false, upstreamCancellationConfirmed: false });
      expect((await f.call('recover', 'POST', { projectId })).status).toBe(200);
      expect(f.inputs).toHaveLength(0);
    } finally {
      vi.mocked(rename).mockImplementation(fs.rename);
      await f.backend.shutdown();
    }
  });
  it.each(['assistant ledger append', 'final idle write'])('recovers the completed upstream turn after %s fails', async boundary => {
    const f = await fixture(async () => true);
    let failed = false;
    vi.mocked(rename).mockImplementation(async (source, target) => {
      const path = String(target);
      if (!failed && (path.startsWith(join(f.stateDirectory, 'conversations') + '/') || path === join(f.stateDirectory, 'projects', projectId + '.json'))) {
        const record = JSON.parse(await fs.readFile(source, 'utf8'));
        if ((boundary === 'assistant ledger append' && record.messages?.at(-1)?.role === 'assistant') ||
            (boundary === 'final idle write' && record.status === 'idle')) {
          failed = true;
          throw new Error('injected completion persistence failure');
        }
      }
      return fs.rename(source, target);
    });
    try {
      const input = { projectId, message: 'completed question', requestId: randomUUID() };
      const stream = await (await f.call('conversation', 'POST', input)).text();
      expect(failed).toBe(true);
      expect(stream).toContain('event: error');
      expect(stream).not.toContain('event: assistant.completed');
      const history = await (await f.call('history?projectId=' + projectId)).json();
      expect(history).toMatchObject({ status: 'interrupted', blocked: true, recoveryRequired: true });
      expect(history.messages).toEqual(boundary === 'assistant ledger append' ? [{ role: 'user', content: input.message }] :
        [{ role: 'user', content: input.message }, { role: 'assistant', content: 'mock answer' }]);
      expect(await (await f.call('stop', 'POST', { projectId })).json()).toMatchObject({ stopped: false });
      expect((await f.call('conversation', 'POST', input)).status).toBe(409);
      expect((await f.call('recover', 'POST', { projectId })).status).toBe(200);
      expect(await (await f.call('history?projectId=' + projectId)).json()).toEqual({
        status: 'idle', blocked: false, recoveryRequired: false,
        messages: [{ role: 'user', content: input.message }, { role: 'assistant', content: 'mock answer' }],
      });
      expect((await f.call('recover', 'POST', { projectId })).status).toBe(200);
      expect(await (await f.call('conversation', 'POST', input)).json()).toEqual({ error: 'duplicate_request' });
      expect(f.inputs).toHaveLength(1);
    } finally {
      vi.mocked(rename).mockImplementation(fs.rename);
      await f.backend.shutdown();
    }
  });
  it('recovers a completed receipt after identical 100-message rollover and failed assistant ledger append', async () => {
    const f = await fixture(async () => true);
    try {
      for (let i = 0; i < 50; i++) {
        expect(await (await f.call('conversation', 'POST', { projectId, message: 'same question' })).text()).toContain('assistant.completed');
        await waitForProjectCleanup(f.stateDirectory);
      }
      const project = JSON.parse(await fs.readFile(join(f.stateDirectory, 'projects', projectId + '.json'), 'utf8'));
      const store = new SessionStore(join(f.stateDirectory, 'bridge'));
      const key = store.key(project.principal, projectId, '00000000-0000-4000-8000-000000000000');
      const before = await store.load(key);
      expect(before.messages).toHaveLength(100);
      let failed = false;
      vi.mocked(rename).mockImplementation(async (source, target) => {
        if (!failed && String(target).startsWith(join(f.stateDirectory, 'conversations') + '/') &&
            JSON.parse(await fs.readFile(source, 'utf8')).messages.at(-1)?.role === 'assistant') {
          failed = true; throw new Error('injected assistant append failure');
        }
        return fs.rename(source, target);
      });
      expect(await (await f.call('conversation', 'POST', { projectId, message: 'same question' })).text()).toContain('event: error');
      expect(failed).toBe(true);
      expect((await store.load(key)).messages).toEqual(before.messages);
      expect(f.inputs).toHaveLength(51);
      await waitForProjectCleanup(f.stateDirectory);
      expect((await f.call('recover', 'POST', { projectId })).status).toBe(200);
      const history = await (await f.call('history?projectId=' + projectId)).json();
      expect(history.messages.at(-1)).toEqual({ role: 'assistant', content: 'mock answer' });
      expect(f.inputs).toHaveLength(51);
    } finally { vi.mocked(rename).mockImplementation(fs.rename); await f.backend.shutdown(); }
  });
  it.each(['projectId', 'documentId', 'runId', 'requestId', 'legacy'])('rejects a completed receipt with mismatched %s and preserves archive evidence', async field => {
    const f = await fixture(async () => true);
    try {
      let failed = false;
      vi.mocked(rename).mockImplementation(async (source, target) => {
        if (!failed && String(target).startsWith(join(f.stateDirectory, 'conversations') + '/') &&
            JSON.parse(await fs.readFile(source, 'utf8')).messages.at(-1)?.role === 'assistant') {
          failed = true; throw new Error('injected assistant append failure');
        }
        return fs.rename(source, target);
      });
      const input = { projectId, message: 'same question', requestId: randomUUID() };
      expect(await (await f.call('conversation', 'POST', input)).text()).toContain('event: error');
      const project = JSON.parse(await fs.readFile(join(f.stateDirectory, 'projects', projectId + '.json'), 'utf8'));
      const store = new SessionStore(join(f.stateDirectory, 'bridge'));
      const key = store.key(project.principal, projectId, '00000000-0000-4000-8000-000000000000');
      const receipt = await store.load(key);
      expect(receipt.completedTurn).toMatchObject({ projectId, ...project.expectedTurn });
      if (field === 'legacy') receipt.completedTurn = undefined;
      else receipt.completedTurn = { ...receipt.completedTurn!, [field]: randomUUID() };
      await store.save(key, receipt);
      expect((await f.call('recover', 'POST', { projectId })).status).toBe(200);
      expect(await (await f.call('history?projectId=' + projectId)).json()).toMatchObject({ messages: [{ role: 'user', content: input.message }] });
      const archives = (await fs.readdir(join(f.stateDirectory, 'bridge'))).filter(name => name.startsWith(key + '.recovered-') && name.endsWith('.json'));
      expect(archives).toHaveLength(1);
      expect(JSON.parse(await fs.readFile(join(f.stateDirectory, 'bridge', archives[0]), 'utf8'))).toEqual(receipt);
      expect((await f.call('conversation', 'POST', input)).status).toBe(409);
      expect(f.inputs).toHaveLength(1);
    } finally { vi.mocked(rename).mockImplementation(fs.rename); await f.backend.shutdown(); }
  });
  it('does not reconcile a stale completed bridge reply into a later identical user turn', async () => {
    const f = await fixture(async () => true);
    try {
      expect(await (await f.call('conversation', 'POST', { projectId, message: 'same question' })).text()).toContain('assistant.completed');
      await waitForProjectCleanup(f.stateDirectory);
      let failed = false;
      vi.mocked(rename).mockImplementation(async (source, target) => {
        if (!failed && String(target).startsWith(join(f.stateDirectory, 'bridge') + '/')) {
          const record = JSON.parse(await fs.readFile(source, 'utf8'));
          if (record.uncertain === true) { failed = true; throw new Error('injected pre-send bridge failure'); }
        }
        return fs.rename(source, target);
      });
      expect(await (await f.call('conversation', 'POST', { projectId, message: 'same question' })).text()).toContain('event: error');
      expect(failed).toBe(true);
      expect((await f.call('recover', 'POST', { projectId })).status).toBe(200);
      expect(await (await f.call('history?projectId=' + projectId)).json()).toMatchObject({ status: 'idle', messages: [
        { role: 'user', content: 'same question' }, { role: 'assistant', content: 'mock answer' }, { role: 'user', content: 'same question' },
      ] });
      expect(f.inputs).toHaveLength(1);
    } finally { vi.mocked(rename).mockImplementation(fs.rename); await f.backend.shutdown(); }
  });
  it('blocks a running record without a lock even when interrupted marking also fails', async () => {
    const f = await fixture(async () => true);
    try {
      vi.mocked(rename).mockImplementation(async (source, target) => {
        if (String(target).startsWith(join(f.stateDirectory, 'conversations') + '/')) {
          if (JSON.parse(await fs.readFile(source, 'utf8')).messages.at(-1)?.role === 'assistant') throw new Error('injected assistant persistence failure');
        }
        if (String(target) === join(f.stateDirectory, 'projects', projectId + '.json') &&
            JSON.parse(await fs.readFile(source, 'utf8')).status === 'interrupted') throw new Error('injected interrupted marking failure');
        return fs.rename(source, target);
      });
      expect(await (await f.call('conversation', 'POST', { projectId, message: 'completed despite local failure' })).text()).toContain('event: error');
      expect(await (await f.call('history?projectId=' + projectId)).json()).toMatchObject({ status: 'interrupted', blocked: true, recoveryRequired: true });
      expect(await (await f.call('stop', 'POST', { projectId })).json()).toMatchObject({ stopped: false });
      vi.mocked(rename).mockImplementation(fs.rename);
      expect((await f.call('recover', 'POST', { projectId })).status).toBe(200);
      expect(await (await f.call('history?projectId=' + projectId)).json()).toMatchObject({ status: 'idle', messages: [
        { role: 'user', content: 'completed despite local failure' }, { role: 'assistant', content: 'mock answer' },
      ] });
      expect(f.inputs).toHaveLength(1);
    } finally { vi.mocked(rename).mockImplementation(fs.rename); await f.backend.shutdown(); }
  });
  it('settles a disconnected HTTP stream without another upstream frame or replay', async () => {
    const f = await fixture(async () => true, 'wait');
    const controller = new AbortController();
    try {
      const bootstrap = await fetch(f.base + '/api/chat/bootstrap');
      const cookie = bootstrap.headers.get('set-cookie')?.split(';')[0] ?? '';
      const csrf = (await bootstrap.json()).csrfToken;
      const response = await fetch(f.base + '/api/chat/conversation', {
        method: 'POST', signal: controller.signal,
        headers: { cookie, origin: f.base, 'x-piton-csrf': csrf, 'content-type': 'application/json' },
        body: JSON.stringify({ projectId, message: 'disconnected turn', requestId: randomUUID() }),
      });
      expect(response.status).toBe(200);
      await vi.waitFor(() => expect(f.inputs).toHaveLength(1), { timeout: 1000 });
      controller.abort();
      await vi.waitFor(async () => {
        expect(await (await f.call('history?projectId=' + projectId)).json()).toMatchObject({ status: 'interrupted', blocked: true });
        expect(await (await f.call('stop', 'POST', { projectId })).json()).toEqual({ stopped: false, upstreamCancellationConfirmed: false });
      }, { timeout: 1000 });
      expect((await f.call('conversation', 'POST', { projectId, message: 'blocked retry' })).status).toBe(409);
      await vi.waitFor(async () => expect((await f.call('recover', 'POST', { projectId })).status).toBe(200), { timeout: 1000 });
      expect(f.inputs).toHaveLength(1);
      expect(await (await f.call('history?projectId=' + projectId)).json()).toMatchObject({ status: 'idle', messages: [{ role: 'user', content: 'disconnected turn' }] });
    } finally { controller.abort(); await f.backend.shutdown(); }
  });
  it('recovers the actual uncertain bridge session, preserves transcript and never resends the old user turn', async () => {
    const f = await fixture(async () => true, 'interrupt-once');
    try {
      const requestId = randomUUID();
      const first = await f.call('conversation', 'POST', { projectId, message: 'old question', requestId });
      expect(await first.text()).toContain('event: error');
      expect(await (await f.call('history?projectId=' + projectId)).json()).toMatchObject({ blocked: true, messages: [{role:'user',content:'old question'}] });
      expect((await f.call('recover', 'POST', {projectId})).status).toBe(200);
      expect(await (await f.call('conversation', 'POST', { projectId, message: 'old question', requestId })).json()).toEqual({ error: 'duplicate_request' });
      expect(f.inputs).toHaveLength(1);
      const second = await f.call('conversation', 'POST', { projectId, message: 'new question', requestId: randomUUID() });
      expect(await second.text()).toContain('assistant.completed');
      expect(f.calls.filter(c => c.path === '/p/nick-mercer/api/sessions')).toHaveLength(2);
      expect(f.inputs).toHaveLength(2);
      expect(f.inputs[1]).toContain('old question');
      expect(f.inputs[1]).toContain('USER MESSAGE:\nnew question');
      expect(await (await f.call('history?projectId=' + projectId)).json()).toMatchObject({ blocked: false, messages: [{role:'user',content:'old question'},{role:'user',content:'new question'},{role:'assistant',content:'mock answer'}] });
    } finally { await f.backend.shutdown(); }
  });
  it('serializes concurrent turns and refuses recovery while a local stream is active', async () => {
    const f = await fixture(async () => true, 'wait');
    try {
      const first = await f.call('conversation', 'POST', { projectId, message: 'waiting', requestId: randomUUID() });
      const read = first.text();
      const second = await f.call('conversation', 'POST', { projectId, message: 'other', requestId: randomUUID() });
      expect(second.status).toBe(409);
      expect((await f.call('recover', 'POST', {projectId})).status).toBe(409);
      expect(await (await f.call('stop', 'POST', {projectId})).json()).toMatchObject({ stopped: true, upstreamCancellationConfirmed: false });
      await read;
      expect(await (await f.call('history?projectId=' + projectId)).json()).toMatchObject({ blocked: true, status: 'interrupted' });
    } finally { await f.backend.shutdown(); }
  });
  it('atomically reserves a global request ID across concurrent enrolled projects', async () => {
    const f = await fixture(async () => true);
    const otherProject = randomUUID();
    const requestId = randomUUID();
    let arrivals = 0;
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const arrive = async () => { if (++arrivals === 2) release(); await barrier; };
    const requests = join(f.stateDirectory, 'requests') + '/';
    // Hold both legacy absent reads or atomic publications at the same boundary.
    // All filesystem operations remain real; only scheduling is controlled.
    vi.mocked(open).mockImplementation(async (...args) => {
      try { return await fs.open(...args); }
      catch (error) {
        if (String(args[0]).startsWith(requests) && (error as NodeJS.ErrnoException).code === 'ENOENT') await arrive();
        throw error;
      }
    });
    vi.mocked(link).mockImplementation(async (source, target) => {
      if (String(target).startsWith(requests)) await arrive();
      return fs.link(source, target);
    });
    try {
      expect((await f.call('projects', 'POST', { projectId: otherProject })).status).toBe(200);
      const commands = [projectId, otherProject].map(projectId => ({ projectId, message: 'once globally', requestId }));
      const responses = await Promise.all(commands.map(command => f.call('conversation', 'POST', command)));
      const bodies = await Promise.all(responses.map(response => response.text()));
      expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
      const winner = responses.findIndex(response => response.status === 200);
      expect(bodies[winner]).toContain('assistant.completed');
      expect(JSON.parse(bodies[1 - winner])).toEqual({ error: 'idempotency_conflict' });
      expect(f.inputs).toHaveLength(1);
      expect(f.calls.filter(call => call.path === '/p/nick-mercer/api/sessions')).toHaveLength(1);
      await waitForProjectCleanup(f.stateDirectory, commands[winner].projectId);
      expect(await (await f.call('conversation', 'POST', commands[winner])).json()).toEqual({ error: 'duplicate_request' });
      expect(await (await f.call('conversation', 'POST', commands[1 - winner])).json()).toEqual({ error: 'idempotency_conflict' });
      expect(await (await f.call('conversation', 'POST', { ...commands[winner], context: 'changed' })).json()).toEqual({ error: 'idempotency_conflict' });
      expect(f.inputs).toHaveLength(1);
    } finally {
      release();
      vi.mocked(open).mockImplementation(fs.open);
      vi.mocked(link).mockImplementation(fs.link);
      await f.backend.shutdown();
    }
  });
  it('rejects same-id replays and changed-content replays without adding turns', async () => {
    const f = await fixture(async () => true);
    try {
      const input = { projectId, message: 'once', requestId: randomUUID() };
      expect(await (await f.call('conversation', 'POST', input)).text()).toContain('assistant.completed');
      await waitForProjectCleanup(f.stateDirectory);
      expect(await (await f.call('conversation', 'POST', input)).json()).toEqual({error:'duplicate_request'});
      expect(await (await f.call('conversation', 'POST', {...input,message:'different'})).json()).toEqual({error:'idempotency_conflict'});
      expect(f.inputs).toHaveLength(1);
    } finally { await f.backend.shutdown(); }
  });
  it('defaults to deny and prevents upstream session creation', async () => {
    const f = await fixture();
    expect((await f.call('availability')).status).toBe(200);
    expect((await (await f.call('availability')).json()).available).toBe(false);
    await expect(f.backend.snapshot()).resolves.toMatchObject({ available: false, capabilities: [] });
    const response = await f.call('conversation', 'POST', { projectId, message: 'test' });
    expect((await response.text())).not.toContain('assistant.completed');
    expect(f.calls).toEqual([]);
    await f.backend.shutdown();
  });
  it('denies a throwing verifier and revocation between requests', async () => {
    let allowed = false;
    const f = await fixture(async () => { if (allowed) throw Error('test verifier failure'); return false; });
    expect((await (await f.call('availability')).json()).available).toBe(false);
    allowed = true;
    expect((await (await f.call('availability')).json()).available).toBe(false);
    const response = await f.call('conversation', 'POST', { projectId, message: 'test' });
    expect((await response.text())).not.toContain('assistant.completed');
    expect(f.calls).toEqual([]);
    await f.backend.shutdown();
  });
  it('routes a test-approved request through bridge with root upstream and bound private origin', async () => {
    let allowed = true; // TEST-ONLY mock; not evidence of a production isolation verifier.
    const f = await fixture(async () => allowed);
    expect((await (await f.call('availability')).json()).available).toBe(true);
    expect((await f.backend.snapshot()).available).toBe(true);
    allowed = false;
    expect((await (await f.call('availability')).json()).available).toBe(false);
    expect((await f.backend.snapshot()).available).toBe(false);
    const count = f.calls.length;
    const denied = await f.call('conversation', 'POST', { projectId, message: 'revoked' });
    expect((await denied.text())).not.toContain('assistant.completed');
    expect(f.calls).toHaveLength(count);
    allowed = true;
    const response = await f.call('conversation', 'POST', { projectId, message: 'allowed' });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('assistant.completed');
    expect(f.calls.map(c => c.path)).toContain('/p/nick-mercer/api/sessions');
    expect(f.calls.map(c => c.path)).toContain('/p/nick-mercer/api/sessions/test-session/chat/stream');
    expect(f.calls.some(c => c.path.includes('/p/nick-mercer/p/nick-mercer'))).toBe(false);
    expect(f.calls.every(c => c.host === new URL(f.upstream).host)).toBe(true);
    await f.backend.shutdown();
  });
  it('rejects unauthenticated, cross-origin and missing-CSRF requests before upstream', async () => {
    const f = await fixture(async () => true);
    expect((await f.call('conversation', 'POST', { projectId, message: 'test' }, { cookie: '' })).status).toBe(401);
    expect((await f.call('conversation', 'POST', { projectId, message: 'test' }, { origin: 'http://evil.invalid' })).status).toBe(403);
    expect((await f.call('conversation', 'POST', { projectId, message: 'test' }, { 'x-piton-csrf': '' })).status).toBe(403);
    expect(f.calls).toEqual([]);
    await f.backend.shutdown();
  });
  it('keeps one project transcript and native session across active Part changes and no Part', async () => {
    const f = await fixture(async () => true);
    try {
      for (const documentId of ['22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', null]) {
        const response = await f.call('conversation', 'POST', { projectId, documentId, message: `part ${documentId}`, requestId: randomUUID() });
        expect(await response.text()).toContain('assistant.completed');
        await waitForProjectCleanup(f.stateDirectory);
      }
      const history = await (await f.call('history?projectId=' + projectId)).json();
      expect(history.messages).toHaveLength(6);
      expect(history.messages.filter((m: {role: string}) => m.role === 'assistant')).toHaveLength(3);
      expect(f.calls.filter(c => c.path === '/p/nick-mercer/api/sessions')).toHaveLength(1);
    } finally { await f.backend.shutdown(); }
  });
});
