// Local mock and synthetic state only; no real Hermes session or credentials.
import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createBackendService, type BackendOptions } from './backend.js';

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

async function fixture(verifier?: BackendOptions['verifyConversationIsolation']) {
  const calls: { path: string; host: string | undefined; origin: string | undefined }[] = [];
  const upstream = await listen(createServer(async (req, res) => {
    calls.push({ path: req.url ?? '', host: req.headers.host, origin: req.headers.origin });
    if (req.url === '/p/nick-mercer/v1/models') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ data: [{ id: 'test-model' }] })); return; }
    if (req.url === '/p/nick-mercer/api/sessions') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ session: { id: 'test-session' } })); return; }
    if (req.url === '/p/nick-mercer/api/sessions/test-session/chat/stream') {
      res.setHeader('Content-Type', 'text/event-stream');
      res.end('event: assistant.completed\ndata: {"session_id":"test-session","content":"mock answer","completed":true}\n\n');
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
  return { backend, call, calls, upstream, base };
}

describe('backend confinement and bridge routing', () => {
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
});
