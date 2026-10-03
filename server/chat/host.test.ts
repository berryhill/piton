// Real local HTTP/static/backend factory tests; no provider, credentials or model invocation.
import { afterEach, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createApplicationService } from './host.js';
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function fixture() {
  const directory = await mkdtemp(join(process.cwd(), '.piton-host-test-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const assets = join(directory, 'dist'); await mkdir(assets);
  await writeFile(join(assets, 'index.html'), '<html>Piton shell</html>');
  await writeFile(join(assets, 'app.js'), 'export const piton = true;');
  await writeFile(join(directory, 'private.txt'), 'not public');
  await symlink(join(directory, 'private.txt'), join(assets, 'escape.txt'));
  const server: Server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw Error('no address');
  const origin = `http://127.0.0.1:${address.port}`;
  const app = await createApplicationService({ origin, stateDirectory: join(directory, 'state'), staticDirectory: assets, allowLocalBootstrap: true, env: {} });
  server.on('request', app.handler);
  cleanup.push(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await app.shutdown(); });
  return { origin, assets, directory };
}
it('serves the shell and assets with SQLite isolation headers and real authenticated JSON routes', async () => {
  const f = await fixture();
  for (const path of ['/', '/projects/example', '/app.js']) {
    const response = await fetch(f.origin + path, { headers: { accept: 'text/html' } });
    expect(response.status).toBe(200);
    expect(response.headers.get('cross-origin-opener-policy')).toBe('same-origin');
    expect(response.headers.get('cross-origin-embedder-policy')).toBe('require-corp');
  }
  const response = await fetch(f.origin + '/api/chat/bootstrap');
  expect(response.headers.get('content-type')).toContain('application/json');
  expect(response.headers.get('set-cookie')).toContain('HttpOnly');
  expect(await response.json()).toMatchObject({ authenticated: true, profile: 'nick-mercer' });
  const availability = await fetch(f.origin + '/api/chat/availability', { headers: { cookie: response.headers.get('set-cookie')!.split(';')[0] } });
  expect(await availability.json()).toMatchObject({ available: false, capabilities: [] });
});
it('never serves SPA HTML for missing API or assets and denies static escape', async () => {
  const f = await fixture();
  for (const path of ['/api/chat/missing', '/api/other', '/missing.js', '/escape.txt', '/%2e%2e%2fprivate.txt']) {
    const response = await fetch(f.origin + path, { headers: { accept: 'text/html' } });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.text()).not.toContain('not public');
  }
});
it('rejects private state within the public asset root', async () => {
  const f = await fixture();
  await expect(createApplicationService({ origin: f.origin, stateDirectory: join(f.assets, 'state'), staticDirectory: f.assets, env: {} })).rejects.toThrow('outside');
});
