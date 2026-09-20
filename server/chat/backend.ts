/**
 * Node-TS HTTP service that exposes the exact browser-facing contract the frontend
 * (src/chat/client.ts + context.ts + ConversationPanel.tsx) requires.
 *
 * Architecture:
 *   - This file is the sole browser-facing boundary (bootstrap, projects, availability,
 *     history, stop, recover, conversation).
 *   - Real Hermes Sessions API work is delegated to the bridge substrate (./bridge.ts)
 *     which already speaks the upstream Hermes contract (/api/sessions, /api/sessions/{id}/chat/stream).
 *   - The bridge substrate is mounted on a private loopback HTTP listener; this service
 *     proxies conversation/history/availability calls through that listener. This keeps
 *     bridge.ts unchanged (its existing bridge.test.ts continues to apply unchanged) while
 *     adding the cookie/CSRF/ownership/idempotency surface the frontend expects.
 *
 * No fabrication authority: when upstream credentials are missing or the bridge substrate
 * is unreachable, this layer reports `available: false` with an empty capability list.
 * The frontend renders a truthful "blocked" status; no synthetic reply is ever emitted.
 *
 * Storage (all mode 0o700, owned by this process, under options.stateDirectory):
 *   auth/         — hashed auth tokens with csrf + principal + expiry
 *   projects/     — per-project principal ownership + native session id + status
 *   conversations/ — per-project visible user/assistant transcript
 *   requests/     — idempotency keys
 *   bridge/       — bridge substrate session/key store (SessionStore from ./store.js)
 *
 * The Nick profile config.yaml is NEVER mutated. HERMES_HOME for any future subprocess
 * is always the profile directory but credentials / profile selection are never overridable
 * from caller input. All POSTs require Origin exact match + valid CSRF.
 */
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, rename, lstat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { createChatHandler, type ChatOptions as BridgeOptions } from './bridge.js';

type BackendProfile = 'nick-mercer';

type Capability =
  | 'project_conversation'
  | 'frozen_context_attach'
  | 'document_link'
  | 'live_mcp_query'
  | 'release_authority'
  | 'workstation_tool';

export type BackendOptions = {
  /** Exact secure browser origin (https:// or http://127.0.0.1 / localhost). */
  origin: string;
  /** Absolute private state directory, mode 0o700, owned by this process. */
  stateDirectory: string;
  /** Optional env overrides for upstream and bridge substrate. */
  env?: Partial<Pick<NodeJS.ProcessEnv, 'PITON_HERMES_UPSTREAM' | 'API_SERVER_KEY'>>;
  /** Trusted Tailscale Serve login for non-loopback bootstrap; loopback bootstrap requires allowLocalBootstrap. */
  tailscaleLogin?: string;
  /** When true AND origin is loopback, anonymous local bootstrap is permitted. */
  allowLocalBootstrap?: boolean;
  /** Override the request timeout for upstream calls. */
  timeoutMs?: number;
};

export type BackendSnapshot = {
  available: boolean;
  profile: BackendProfile;
  capabilities: Capability[];
  runtime: { model: string; provider: string } | null;
  substrate: { upstream: string | null; authenticated: boolean };
};

export type BackendService = {
  handler: (req: IncomingMessage, res: ServerResponse) => void;
  snapshot: () => Promise<BackendSnapshot>;
  stopAll: () => void;
  shutdown: () => Promise<void>;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROJECT_NULL = '00000000-0000-4000-8000-000000000000';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 64_000;
const MAX_RECORD_BYTES = 524_288;

const hashToken = (value: string) => createHash('sha256').update(value).digest('hex');
const safeEqual = (a: string, b: string) => {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length > 512 || b.length > 512 || a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
};
const now = () => Date.now();

class HttpError extends Error { constructor(readonly status: number, readonly code: string) { super(code); } }
const badRequest = () => new HttpError(400, 'invalid_request');
const forbidden = (code = 'forbidden') => new HttpError(403, code);
const unauthorized = (code = 'authentication_required') => new HttpError(401, code);
const conflict = (code: string) => new HttpError(409, code);
const unavailable = () => new HttpError(503, 'unavailable');

type AuthRecord = { tokenHash: string; csrf: string; principal: string; expires: number };
type ProjectRecord = { id: string; principal: string; nativeSessionId: string | null; status: 'idle' | 'running' | 'interrupted'; updatedAt: number };
type RequestRecord = { id: string; projectId: string; fingerprint: string };
type Message = { role: 'user' | 'assistant'; content: string };

/** Project-scoped visible transcript storage. Distinct from bridge SessionStore. */
class ConversationLedger {
  constructor(private readonly directory: string) {
    if (!isAbsolute(directory)) throw new Error('Private absolute storage directory required');
  }
  private async ready() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const stat = await lstat(this.directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) || stat.uid !== process.getuid?.()) throw new Error('Unsafe storage');
  }
  private key(projectId: string, documentId: string | null) {
    const scope = documentId ?? PROJECT_NULL;
    return join(this.directory, createHash('sha256').update(`${projectId}:${scope}`).digest('hex') + '.json');
  }
  private async read(path: string): Promise<Message[]> {
    try {
      const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_RECORD_BYTES || stat.uid !== process.getuid?.() || (stat.mode & 0o077)) throw new Error('Unsafe record');
        const text = await file.readFile('utf8');
        const value = JSON.parse(text) as { messages?: Message[] };
        if (!Array.isArray(value.messages)) throw new Error('Invalid record');
        return value.messages;
      } finally { await file.close(); }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw e;
    }
  }
  async load(projectId: string, documentId: string | null): Promise<Message[]> {
    await this.ready();
    return this.read(this.key(projectId, documentId));
  }
  async append(projectId: string, documentId: string | null, message: Message): Promise<Message[]> {
    const current = await this.load(projectId, documentId);
    const trimmed = [...current.slice(-199), message];
    await this.write(projectId, documentId, trimmed);
    return trimmed;
  }
  private async write(projectId: string, documentId: string | null, messages: Message[]): Promise<void> {
    const target = this.key(projectId, documentId);
    const temporary = target + '.' + randomUUID() + '.tmp';
    const file = await open(temporary, constants.O_EXCL | constants.O_CREAT, 0o600);
    try {
      await file.writeFile(JSON.stringify({ messages, updatedAt: now() }));
      await file.sync();
    } finally { await file.close(); }
    await rename(temporary, target);
  }
}

class AuthStore {
  constructor(private readonly directory: string) {
    if (!isAbsolute(directory)) throw new Error('Private absolute storage directory required');
  }
  private async ready() { await mkdir(this.directory, { recursive: true, mode: 0o700 }); }
  private path(tokenHash: string) { return join(this.directory, tokenHash.slice(0, 2), tokenHash + '.json'); }
  async findByToken(token: string): Promise<AuthRecord | undefined> {
    await this.ready();
    if (!token || token.length > 256) return undefined;
    const target = this.path(hashToken(token));
    try {
      const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.nlink !== 1 || stat.size > 4096 || stat.uid !== process.getuid?.() || (stat.mode & 0o077)) throw new Error('Unsafe auth record');
        const text = await file.readFile('utf8');
        const record = JSON.parse(text) as AuthRecord;
        if (record.expires <= now()) return undefined;
        return record;
      } finally { await file.close(); }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw e;
    }
  }
  async create(principal: string): Promise<{ token: string; record: AuthRecord }> {
    await this.ready();
    const token = randomUUID() + '.' + randomUUID();
    const csrf = randomUUID().replace(/-/g, '').slice(0, 32);
    const record: AuthRecord = { tokenHash: hashToken(token), csrf, principal, expires: now() + SESSION_TTL_MS };
    await mkdir(join(this.directory, record.tokenHash.slice(0, 2)), { recursive: true, mode: 0o700 });
    const target = this.path(record.tokenHash);
    const temporary = target + '.' + randomUUID() + '.tmp';
    const file = await open(temporary, constants.O_EXCL | constants.O_CREAT, 0o600);
    try {
      await file.writeFile(JSON.stringify(record));
      await file.sync();
    } finally { await file.close(); }
    await rename(temporary, target);
    return { token, record };
  }
}

class ProjectStore {
  constructor(private readonly directory: string) {
    if (!isAbsolute(directory)) throw new Error('Private absolute storage directory required');
  }
  private async ready() { await mkdir(this.directory, { recursive: true, mode: 0o700 }); }
  private path(projectId: string) { return join(this.directory, projectId + '.json'); }
  async get(projectId: string): Promise<ProjectRecord | undefined> {
    await this.ready();
    try {
      const file = await open(this.path(projectId), constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.nlink !== 1 || stat.size > 4096 || stat.uid !== process.getuid?.() || (stat.mode & 0o077)) throw new Error('Unsafe project record');
        const text = await file.readFile('utf8');
        return JSON.parse(text) as ProjectRecord;
      } finally { await file.close(); }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw e;
    }
  }
  async write(record: ProjectRecord): Promise<void> {
    await this.ready();
    const target = this.path(record.id);
    const temporary = target + '.' + randomUUID() + '.tmp';
    const file = await open(temporary, constants.O_EXCL | constants.O_CREAT, 0o600);
    try {
      await file.writeFile(JSON.stringify(record));
      await file.sync();
    } finally { await file.close(); }
    await rename(temporary, target);
  }
  async enroll(principal: string, projectId: string): Promise<ProjectRecord> {
    const existing = await this.get(projectId);
    if (existing) {
      if (existing.principal !== principal) throw forbidden('project_not_owned');
      return existing;
    }
    const record: ProjectRecord = { id: projectId, principal, nativeSessionId: null, status: 'idle', updatedAt: now() };
    await this.write(record);
    return record;
  }
  async update(projectId: string, mutator: (record: ProjectRecord) => ProjectRecord | Promise<ProjectRecord>): Promise<ProjectRecord> {
    const existing = await this.get(projectId);
    if (!existing) throw forbidden('project_not_owned');
    const next = await mutator(existing);
    next.updatedAt = now();
    await this.write(next);
    return next;
  }
}

class IdempotencyStore {
  constructor(private readonly directory: string) {
    if (!isAbsolute(directory)) throw new Error('Private absolute storage directory required');
  }
  private async ready() { await mkdir(this.directory, { recursive: true, mode: 0o700 }); }
  private path(id: string) { return join(this.directory, createHash('sha256').update(id).digest('hex') + '.json'); }
  async check(id: string, projectId: string, fingerprint: string): Promise<{ status: 'new' } | { status: 'duplicate' } | { status: 'conflict' }> {
    await this.ready();
    try {
      const file = await open(this.path(id), constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const text = await file.readFile('utf8');
        const existing = JSON.parse(text) as RequestRecord;
        if (existing.projectId === projectId && existing.fingerprint === fingerprint) return { status: 'duplicate' };
        return { status: 'conflict' };
      } finally { await file.close(); }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      return { status: 'new' };
    }
  }
  async record(record: RequestRecord): Promise<void> {
    await this.ready();
    const target = this.path(record.id);
    const temporary = target + '.' + randomUUID() + '.tmp';
    const file = await open(temporary, constants.O_EXCL | constants.O_CREAT, 0o600);
    try {
      await file.writeFile(JSON.stringify(record));
      await file.sync();
    } finally { await file.close(); }
    await rename(temporary, target);
  }
}

class ActiveRuns {
  private readonly runs = new Map<string, AbortController>();
  limit(projectId: string): void { if (this.runs.has(projectId)) throw conflict('conversation_busy'); }
  start(projectId: string, controller: AbortController): void { this.runs.set(projectId, controller); }
  end(projectId: string): void { this.runs.delete(projectId); }
  stop(projectId: string): boolean { const c = this.runs.get(projectId); if (!c) return false; try { c.abort(); } catch { /* ignore */ } return true; }
  cancelAll(): void { for (const c of this.runs.values()) { try { c.abort(); } catch { /* ignore */ } } this.runs.clear(); }
}

export function createBackendService(options: BackendOptions): BackendService {
  const origin = new URL(options.origin);
  if (origin.origin !== options.origin || origin.username || origin.password ||
      (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(origin.hostname)))) throw new Error('Exact secure origin required');
  if (!isAbsolute(options.stateDirectory)) throw new Error('Private absolute storage directory required');

  const env = options.env ?? process.env;
  const stateRoot = options.stateDirectory;
  const authStore = new AuthStore(join(stateRoot, 'auth'));
  const projectStore = new ProjectStore(join(stateRoot, 'projects'));
  const ledger = new ConversationLedger(join(stateRoot, 'conversations'));
  const idem = new IdempotencyStore(join(stateRoot, 'requests'));
  const activeRuns = new ActiveRuns();
  const isLoopback = ['127.0.0.1', '[::1]', 'localhost'].includes(origin.hostname);
  const allowLocalBootstrap = Boolean(options.allowLocalBootstrap) && isLoopback;
  const tailscaleLogin = options.tailscaleLogin;

  let upstream: string | undefined;
  let credential: string | undefined;
  try {
    const candidate = new URL(env.PITON_HERMES_UPSTREAM ?? '');
    if (candidate.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(candidate.hostname) && candidate.pathname === '/' && !candidate.search && !candidate.hash && !candidate.username && !candidate.password) {
      upstream = candidate.origin + '/p/nick-mercer';
    }
  } catch { /* No upstream available. */ }
  credential = env.API_SERVER_KEY;

  // Mount the existing bridge substrate on a private loopback HTTP listener so we can
  // proxy the browser-facing conversation/history/availability through it without
  // mutating bridge.ts.
  let bridgeServer: Server | undefined;
  let bridgeOrigin = '';
  function startBridgeServer(): void {
    if (bridgeServer) return;
    if (!upstream || !credential) return;
    const bridgeOptions: BridgeOptions = {
      origin: `http://127.0.0.1`,
      storeDirectory: join(stateRoot, 'bridge'),
      env: { PITON_HERMES_UPSTREAM: upstream, API_SERVER_KEY: credential },
      authenticate: async (req) => {
        const record = await authenticateFromCookie(req);
        if (!record) return null;
        const csrfHeader = req.headers['x-piton-csrf'];
        if (typeof csrfHeader !== 'string' || !safeEqual(csrfHeader, record.csrf)) return null;
        return { principal: record.principal, csrfToken: record.csrf };
      },
      authorizeScope: async (principal, scope) => {
        if (!UUID_RE.test(scope.projectId) || !UUID_RE.test(scope.documentId)) return false;
        const project = await projectStore.get(scope.projectId);
        return Boolean(project && project.principal === principal);
      },
      verifyConversationIsolation: async () => Boolean(upstream && credential),
      timeoutMs: options.timeoutMs,
    };
    const server = createServer(createChatHandler(bridgeOptions));
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') bridgeOrigin = `http://127.0.0.1:${address.port}`;
    });
    bridgeServer = server;
  }
  startBridgeServer();

  let cachedRuntime: { model: string; provider: string } | null = null;
  let cachedRuntimeAt = 0;
  async function fetchRuntime(): Promise<{ model: string; provider: string } | null> {
    if (!upstream || !credential) return null;
    if (cachedRuntime && (now() - cachedRuntimeAt) < 30_000) return cachedRuntime;
    try {
      const runtime = await proxyUpstream('/v1/models', 'GET');
      if (!runtime) return null;
      const value = JSON.parse(runtime) as { data?: Array<{ id?: string }> };
      const model = Array.isArray(value.data) && value.data[0]?.id ? String(value.data[0].id) : 'unknown';
      cachedRuntime = { model, provider: 'configured' };
      cachedRuntimeAt = now();
      return cachedRuntime;
    } catch { return null; }
  }

  async function proxyUpstream(path: string, method: 'GET' | 'POST', body?: unknown): Promise<string | null> {
    if (!upstream || !credential) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000); timer.unref();
    try {
      const response = await fetch(upstream + path, {
        method, signal: controller.signal, redirect: 'error',
        headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!response.ok) { await response.body?.cancel(); return null; }
      return await response.text();
    } catch { return null; }
    finally { clearTimeout(timer); }
  }

  function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    res.end(JSON.stringify(body));
  }

  async function readBody(req: IncomingMessage, max: number): Promise<string> {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      total += buffer.length;
      if (total > max) throw badRequest();
      chunks.push(buffer);
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  function parseCookies(header: string | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    if (typeof header !== 'string') return out;
    for (const part of header.split(';')) {
      const trimmed = part.trim();
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (key && !(key in out)) out[key] = value;
    }
    return out;
  }

  function provenanceMatches(req: IncomingMessage): boolean {
    if (req.headers.host !== origin.host) return false;
    const secFetchSite = req.headers['sec-fetch-site'];
    if (typeof secFetchSite === 'string' && (secFetchSite === 'cross-site' || secFetchSite === 'same-site')) return false;
    const originHeader = req.headers.origin;
    if (req.method !== 'GET') {
      if (originHeader !== options.origin) return false;
    } else if (originHeader !== undefined && originHeader !== options.origin) return false;
    return true;
  }

  async function authenticateFromCookie(req: IncomingMessage): Promise<AuthRecord | null> {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies['piton_session'];
    if (!token) return null;
    return (await authStore.findByToken(token)) ?? null;
  }

  function setSessionCookie(res: ServerResponse, token: string): void {
    const parts = [`piton_session=${token}`, 'HttpOnly', 'SameSite=Strict', 'Path=/', `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`];
    if (options.origin.startsWith('https:')) parts.push('Secure');
    const existing = res.getHeader('Set-Cookie');
    const list = Array.isArray(existing) ? existing : existing ? [String(existing)] : [];
    list.push(parts.join('; '));
    res.setHeader('Set-Cookie', list);
  }

  async function requireAuthAndCsrf(req: IncomingMessage): Promise<AuthRecord> {
    if (!provenanceMatches(req)) throw forbidden('forbidden');
    const record = await authenticateFromCookie(req);
    if (!record) throw unauthorized('authentication_required');
    if (req.method !== 'GET') {
      const header = req.headers['x-piton-csrf'];
      if (typeof header !== 'string' || !safeEqual(header, record.csrf)) throw forbidden('csrf_required');
    }
    return record;
  }

  async function bootstrap(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!provenanceMatches(req)) throw forbidden('forbidden');
    const existing = await authenticateFromCookie(req);
    if (existing && existing.expires > now()) {
      jsonResponse(res, 200, { authenticated: true, csrfToken: existing.csrf, profile: 'nick-mercer' });
      return;
    }
    if (!isLoopback) {
      const peer = req.socket?.remoteAddress ?? '';
      const trustForwardedIdentity = peer === '127.0.0.1' || peer === '::1' || peer === '::ffff:127.0.0.1';
      if (!trustForwardedIdentity) throw unauthorized('authentication_required');
      const forwardedLogin = req.headers['tailscale-user-login'];
      if (typeof forwardedLogin !== 'string' || !tailscaleLogin || !safeEqual(forwardedLogin, tailscaleLogin)) {
        throw unauthorized('authentication_required');
      }
      const { token, record } = await authStore.create('tailnet:' + tailscaleLogin);
      setSessionCookie(res, token);
      jsonResponse(res, 200, { authenticated: true, csrfToken: record.csrf, profile: 'nick-mercer' });
      return;
    }
    if (!allowLocalBootstrap) throw unauthorized('authentication_required');
    const { token, record } = await authStore.create('local-operator');
    setSessionCookie(res, token);
    jsonResponse(res, 200, { authenticated: true, csrfToken: record.csrf, profile: 'nick-mercer' });
  }

  async function enrollProject(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const auth = await requireAuthAndCsrf(req);
    if ((req.headers['content-type'] ?? '').split(';')[0].trim() !== 'application/json') throw badRequest();
    const text = await readBody(req, MAX_BODY_BYTES);
    let body: Record<string, unknown>;
    try { body = JSON.parse(text); } catch { throw badRequest(); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest();
    const projectId = body.projectId;
    if (typeof projectId !== 'string' || !UUID_RE.test(projectId)) throw badRequest();
    await projectStore.enroll(auth.principal, projectId);
    jsonResponse(res, 200, { projectId });
  }

  async function availability(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const record = await requireAuthAndCsrf(req);
    void record;
    const runtime = upstream && credential ? await fetchRuntime() : null;
    const capabilities: Capability[] = upstream && credential ? ['project_conversation', 'frozen_context_attach', 'document_link'] : [];
    jsonResponse(res, 200, {
      available: Boolean(upstream && credential && runtime),
      profile: 'nick-mercer',
      capabilities,
      runtime: runtime ?? undefined,
    });
  }

  async function history(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const auth = await requireAuthAndCsrf(req);
    const params = [...url.searchParams.keys()];
    if (params.length !== 1 || params[0] !== 'projectId') throw badRequest();
    const projectId = url.searchParams.get('projectId') ?? '';
    if (!UUID_RE.test(projectId)) throw badRequest();
    const project = await projectStore.get(projectId);
    if (!project || project.principal !== auth.principal) throw forbidden('project_not_owned');
    const messages = await ledger.load(projectId, null);
    jsonResponse(res, 200, { messages, blocked: project.status === 'interrupted', status: project.status });
  }

  async function stopControl(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const auth = await requireAuthAndCsrf(req);
    if ((req.headers['content-type'] ?? '').split(';')[0].trim() !== 'application/json') throw badRequest();
    const text = await readBody(req, MAX_BODY_BYTES);
    let body: Record<string, unknown>;
    try { body = JSON.parse(text); } catch { throw badRequest(); }
    if (!body || typeof body !== 'object') throw badRequest();
    const projectId = body.projectId;
    if (typeof projectId !== 'string' || !UUID_RE.test(projectId)) throw badRequest();
    const project = await projectStore.get(projectId);
    if (!project || project.principal !== auth.principal) throw forbidden('project_not_owned');
    const stopped = activeRuns.stop(projectId);
    jsonResponse(res, 200, { stopped });
  }

  async function recoverControl(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const auth = await requireAuthAndCsrf(req);
    if ((req.headers['content-type'] ?? '').split(';')[0].trim() !== 'application/json') throw badRequest();
    const text = await readBody(req, MAX_BODY_BYTES);
    let body: Record<string, unknown>;
    try { body = JSON.parse(text); } catch { throw badRequest(); }
    if (!body || typeof body !== 'object') throw badRequest();
    const projectId = body.projectId;
    if (typeof projectId !== 'string' || !UUID_RE.test(projectId)) throw badRequest();
    const next = await projectStore.update(projectId, (record) => {
      if (record.principal !== auth.principal) throw forbidden('project_not_owned');
      return { ...record, nativeSessionId: null, status: 'idle' };
    });
    jsonResponse(res, 200, { recovered: true, status: next.status });
  }

  type BridgeProxyFrame = { event: string; data: Record<string, unknown> };

  function proxyConversationToBridge(input: {
    projectId: string;
    documentId: string;
    message: string;
    context: string | undefined;
    cookie: string | undefined;
    csrf: string;
    signal: AbortSignal;
  }): Promise<{ status: number; frames: AsyncIterable<BridgeProxyFrame> }> {
    return new Promise((resolve, reject) => {
      if (!bridgeOrigin) { reject(unavailable()); return; }
      const payload = JSON.stringify({ projectId: input.projectId, documentId: input.documentId, message: input.message, context: input.context });
      const url = new URL(bridgeOrigin + '/api/chat/conversation');
      const req = httpRequest(url, {
        method: 'POST',
        headers: {
          host: url.host,
          origin: 'http://127.0.0.1',
          'content-type': 'application/json',
          'x-piton-csrf': input.csrf,
          ...(input.cookie ? { cookie: input.cookie } : {}),
          'sec-fetch-site': 'same-origin',
        },
      }, (response) => {
        const status = response.statusCode ?? 0;
        if (status !== 200) {
          response.resume();
          if (status === 503) resolve({ status: 503, frames: (async function* () {})() });
          else reject(new HttpError(status >= 400 && status < 500 ? status : 503, status === 409 ? 'conversation_busy' : 'unavailable'));
          return;
        }
        async function* frames(): AsyncIterable<BridgeProxyFrame> {
          let buffer = '';
          response.setEncoding('utf8');
          for await (const chunk of response) {
            if (input.signal.aborted) return;
            buffer += chunk;
            let boundary: number;
            buffer = buffer.replace(/\r\n/g, '\n');
            while ((boundary = buffer.indexOf('\n\n')) >= 0) {
              const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
              const lines = frame.split('\n');
              const eventLine = lines.find(line => line.startsWith('event:'));
              const dataLines = lines.filter(line => line.startsWith('data:'));
              if (!eventLine || dataLines.length === 0) continue;
              const event = eventLine.slice(6).trim();
              const dataText = dataLines.map(line => line.slice(5).trimStart()).join('\n');
              let data: Record<string, unknown>;
              try { data = JSON.parse(dataText) as Record<string, unknown>; } catch { continue; }
              yield { event, data };
            }
          }
        }
        resolve({ status, frames: frames() });
      });
      req.on('error', () => reject(unavailable()));
      req.on('close', () => { if (!input.signal.aborted) reject(unavailable()); });
      input.signal.addEventListener('abort', () => { try { req.destroy(); } catch { /* ignore */ } });
      req.end(payload);
    });
  }

  async function conversation(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const auth = await requireAuthAndCsrf(req);
    if ((req.headers['content-type'] ?? '').split(';')[0].trim() !== 'application/json') throw badRequest();
    const text = await readBody(req, MAX_BODY_BYTES);
    let body: Record<string, unknown>;
    try { body = JSON.parse(text); } catch { throw badRequest(); }
    if (!body || typeof body !== 'object') throw badRequest();
    const projectId = body.projectId;
    const message = body.message;
    const context = body.context;
    const documentId = body.documentId;
    if (typeof projectId !== 'string' || !UUID_RE.test(projectId)) throw badRequest();
    if (typeof message !== 'string' || !message.trim() || message.length > 8000) throw badRequest();
    if (context !== undefined && (typeof context !== 'string' || context.length > 24_000)) throw badRequest();
    if (documentId !== undefined && documentId !== null && (typeof documentId !== 'string' || !UUID_RE.test(documentId))) throw badRequest();
    const requestId = typeof body.requestId === 'string' && UUID_RE.test(body.requestId) ? body.requestId : randomUUID();
    const project = await projectStore.get(projectId);
    if (!project || project.principal !== auth.principal) throw forbidden('project_not_owned');
    activeRuns.limit(projectId);
    if (project.status === 'interrupted') throw conflict('conversation_requires_recovery');
    const fingerprint = createHash('sha256').update(JSON.stringify({ message, context: context ?? '' })).digest('hex');
    const idemResult = await idem.check(requestId, projectId, fingerprint);
    if (idemResult.status === 'duplicate') throw conflict('duplicate_request');
    if (idemResult.status === 'conflict') throw conflict('idempotency_conflict');
    await idem.record({ id: requestId, projectId, fingerprint });
    const runController = new AbortController();
    const scopeDocumentId = (documentId ?? PROJECT_NULL) as string;
    activeRuns.start(projectId, runController);
    await projectStore.update(projectId, (record) => ({ ...record, status: 'running' }));
    await ledger.append(projectId, scopeDocumentId, { role: 'user', content: message });

    if (!bridgeOrigin) {
      await projectStore.update(projectId, (record) => ({ ...record, status: 'interrupted' }));
      activeRuns.end(projectId);
      throw unavailable();
    }

    const send = (event: string, payload: Record<string, unknown>): Promise<void> => new Promise((resolve, reject) => {
      if (res.destroyed || runController.signal.aborted) { reject(new Error('aborted')); return; }
      const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
      res.write(frame, error => error ? reject(error) : resolve());
    });

    let committed = false;
    let fullAssistant = '';
    try {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        'X-Accel-Buffering': 'no',
        'X-Content-Type-Options': 'nosniff',
        'Connection': 'keep-alive',
      });
      res.flushHeaders?.();
      const runId = randomUUID();
      await send('run.started', { runId });
      const proxy = await proxyConversationToBridge({
        projectId,
        documentId: scopeDocumentId,
        message,
        context: context ?? undefined,
        cookie: req.headers.cookie,
        csrf: auth.csrf,
        signal: runController.signal,
      });
      if (proxy.status !== 200) throw unavailable();
      for await (const frame of proxy.frames) {
        if (runController.signal.aborted) throw unavailable();
        if (frame.event === 'assistant.delta' && typeof frame.data.delta === 'string') {
          fullAssistant += frame.data.delta;
          await send('assistant.delta', { delta: frame.data.delta });
        } else if (frame.event === 'assistant.completed' && typeof frame.data.content === 'string') {
          fullAssistant = frame.data.content;
          await send('assistant.completed', { content: fullAssistant });
          committed = true;
          break;
        } else if (frame.event === 'assistant.completed' || frame.event === 'error' || frame.event === 'done') {
          break;
        }
      }
      if (!committed) throw unavailable();
      await ledger.append(projectId, scopeDocumentId, { role: 'assistant', content: fullAssistant });
      await projectStore.update(projectId, (record) => ({ ...record, status: 'idle' }));
      await send('done', {});
      res.end();
    } catch (error) {
      if (!committed) {
        try { await projectStore.update(projectId, (record) => ({ ...record, status: 'interrupted' })); } catch { /* ignore */ }
      }
      if (res.headersSent) {
        try { await send('error', { error: error instanceof HttpError ? error.code : 'unavailable' }); await send('done', {}); res.end(); } catch { /* ignore */ }
      } else {
        const status = error instanceof HttpError ? error.status : 503;
        const code = error instanceof HttpError ? error.code : 'unavailable';
        jsonResponse(res, status, { error: code });
      }
    } finally {
      activeRuns.end(projectId);
      runController.abort();
    }
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let url: URL;
    try { url = new URL(req.url ?? '/', options.origin); }
    catch { jsonResponse(res, 400, { error: 'invalid_request' }); return; }
    if (url.origin !== options.origin) { jsonResponse(res, 400, { error: 'invalid_request' }); return; }
    try {
      if (req.method === 'GET' && url.pathname === '/api/chat/bootstrap') { await bootstrap(req, res); return; }
      if (req.method === 'POST' && url.pathname === '/api/chat/projects') { await enrollProject(req, res); return; }
      if (req.method === 'GET' && url.pathname === '/api/chat/availability') { await availability(req, res); return; }
      if (req.method === 'GET' && url.pathname === '/api/chat/history') { await history(req, res, url); return; }
      if (req.method === 'POST' && url.pathname === '/api/chat/stop') { await stopControl(req, res); return; }
      if (req.method === 'POST' && url.pathname === '/api/chat/recover') { await recoverControl(req, res); return; }
      if (req.method === 'POST' && url.pathname === '/api/chat/conversation') { await conversation(req, res); return; }
      jsonResponse(res, 404, { error: 'not_found' });
    } catch (error) {
      if (error instanceof HttpError) { jsonResponse(res, error.status, { error: error.code }); return; }
      jsonResponse(res, 503, { error: 'unavailable' });
    }
  }

  async function snapshot(): Promise<BackendSnapshot> {
    const runtime = upstream && credential ? await fetchRuntime() : null;
    return {
      available: Boolean(upstream && credential && runtime),
      profile: 'nick-mercer',
      capabilities: upstream && credential ? ['project_conversation', 'frozen_context_attach', 'document_link'] : [],
      runtime: runtime ?? null,
      substrate: { upstream: upstream ?? null, authenticated: Boolean(credential) },
    };
  }

  function stopAll(): void { activeRuns.cancelAll(); }

  async function shutdown(): Promise<void> {
    activeRuns.cancelAll();
    if (bridgeServer) {
      await new Promise<void>(resolve => bridgeServer!.close(() => resolve()));
      bridgeServer = undefined;
    }
  }

  return {
    handler: (req, res) => { void handle(req, res); },
    snapshot,
    stopAll,
    shutdown,
  };
}
