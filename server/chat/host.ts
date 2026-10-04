import type { IncomingMessage, ServerResponse } from 'node:http';
import { constants } from 'node:fs';
import { open, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { createBackendService, type BackendOptions } from './backend.js';

export type ApplicationOptions = BackendOptions & { staticDirectory: string };
const inside = (root: string, path: string) => { const rel = relative(root, path); return rel === '' || (!rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel)); };
const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
function failure(res: ServerResponse, status: number) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ error: status === 404 ? 'not_found' : 'invalid_request' }));
}
/** Same-origin application host. No runtime-policy bypass or general upstream proxy. */
export async function createApplicationService(options: ApplicationOptions) {
  if (!isAbsolute(options.staticDirectory)) throw Error('Absolute static directory required');
  const root = await realpath(options.staticDirectory);
  if (!(await stat(root)).isDirectory()) throw Error('Static directory required');
  // Resolve even a not-yet-created state directory through its nearest existing ancestor.
  let ancestor = resolve(options.stateDirectory);
  const suffix: string[] = [];
  for (;;) {
    try { ancestor = resolve(await realpath(ancestor), ...suffix.reverse()); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = resolve(ancestor, '..'); if (parent === ancestor) throw error;
      suffix.push(relative(parent, ancestor)); ancestor = parent;
    }
  }
  if (inside(root, ancestor)) throw Error('Private state must be outside static assets');
  const backend = createBackendService(options);
  async function handle(req: IncomingMessage, res: ServerResponse) {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    let url: URL;
    try { url = new URL(req.url ?? '/', options.origin); }
    catch { failure(res, 400); return; }
    if (url.origin !== options.origin || req.headers.host !== new URL(options.origin).host) { failure(res, 400); return; }
    if (url.pathname.startsWith('/api/chat/')) { backend.handler(req, res); return; }
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) { failure(res, 404); return; }
    if (req.method !== 'GET' && req.method !== 'HEAD') { failure(res, 405); return; }
    try {
      const pathname = decodeURIComponent(url.pathname);
      if (pathname.includes('\0') || pathname.includes('\\') || pathname.split('/').includes('..')) { failure(res, 400); return; }
      let target = resolve(root, '.' + pathname);
      if (!inside(root, target)) { failure(res, 404); return; }
      if (pathname === '/') target = resolve(root, 'index.html');
      try { target = await realpath(target); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        if (extname(pathname) || !req.headers.accept?.includes('text/html')) { failure(res, 404); return; }
        target = await realpath(resolve(root, 'index.html'));
      }
      if (!inside(root, target)) { failure(res, 404); return; }
      const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const info = await file.stat();
        if (!info.isFile()) { failure(res, 404); return; }
        res.writeHead(200, { 'Content-Type': mime[extname(target)] ?? 'application/octet-stream', 'Content-Length': info.size, 'Cache-Control': 'no-cache' });
        if (req.method === 'HEAD') { res.end(); return; }
        // Pipeline owns the descriptor once streaming starts and closes on disconnect.
        const { pipeline } = await import('node:stream/promises');
        await pipeline(file.createReadStream({ autoClose: false }), res);
      } finally { await file.close(); }
    } catch {
      if (!res.headersSent) failure(res, 404);
      else res.destroy();
    }
  }
  return { handler: (req: IncomingMessage, res: ServerResponse) => { void handle(req, res); }, shutdown: backend.shutdown };
}
