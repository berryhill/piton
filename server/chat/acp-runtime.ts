import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { isAbsolute } from 'node:path';

/** Transport only. A true, independent, server-side restricted-runtime policy must attest
 * before launch; ACP capabilities, an empty mcpServers list and denied client RPCs do NOT
 * prevent the agent from using its own tools. Never wire this directly to browser input. */
export type AcpRuntimeOptions = {
  executable: string;
  argv: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  attestRestrictedRuntime: () => Promise<boolean>;
  verifySessionPolicy?: (sessionId: string, metadata: unknown) => boolean;
  deadlineMs?: number;
  maxLineBytes?: number;
  maxOutputBytes?: number;
  terminationGraceMs?: number;
};
export type AcpModel = { id: string; name: string };
export type AcpDiscovery = { version: string | null; models: AcpModel[]; currentModelId: string | null };
export type AcpTurn = { sessionId: string; text: string; stopReason: string };
export type AcpTurnInput = { prompt: string; modelId?: string; signal?: AbortSignal; onText?: (delta: string) => void };
export class AcpTransportError extends Error {
  constructor(readonly code: 'policy_unverified' | 'busy' | 'invalid_input' | 'protocol_error' | 'rpc_error' | 'child_exit' | 'timeout' | 'cancelled' | 'spawn_error') {
    super(code);
  }
}

type Json = Record<string, unknown>;
const object = (v: unknown): Json | null => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Json : null;
const idIsValid = (v: unknown): v is string | number => typeof v === 'string' || (typeof v === 'number' && Number.isSafeInteger(v));
const DEFAULT_DEADLINE = 120_000;

export class AcpRuntime {
  private busy = false;
  constructor(private readonly options: AcpRuntimeOptions) {
    if (!options.executable || !isAbsolute(options.executable) || !isAbsolute(options.cwd) ||
        !Array.isArray(options.argv) || options.argv.some(a => typeof a !== 'string') ||
        !options.env || typeof options.attestRestrictedRuntime !== 'function' ||
        [options.deadlineMs ?? DEFAULT_DEADLINE, options.maxLineBytes ?? 64_000, options.maxOutputBytes ?? 512_000, options.terminationGraceMs ?? 250].some(n => !Number.isSafeInteger(n) || n <= 0)) {
      throw new AcpTransportError('invalid_input');
    }
  }

  /** Discovery is a separate bounded process, never a side effect of an active turn. */
  discover(): Promise<AcpDiscovery> {
    return this.execute(undefined);
  }

  run(input: AcpTurnInput): Promise<AcpTurn> {
    if (typeof input?.prompt !== 'string' || !input.prompt.trim() || Buffer.byteLength(input.prompt) > 64_000 ||
        (input.modelId !== undefined && (typeof input.modelId !== 'string' || !input.modelId || input.modelId.length > 256))) {
      return Promise.reject(new AcpTransportError('invalid_input'));
    }
    return this.execute(input);
  }

  private async execute(input: AcpTurnInput | undefined): Promise<AcpTurn & AcpDiscovery> {
    if (this.busy) throw new AcpTransportError('busy');
    this.busy = true;
    let child: ChildProcessWithoutNullStreams | undefined;
    try {
      if (input?.signal?.aborted) throw new AcpTransportError('cancelled');
      // Attestation is a trusted server callback, not a flag supplied by the browser or ACP agent.
      try {
        if (await this.options.attestRestrictedRuntime() !== true) throw new AcpTransportError('policy_unverified');
      } catch { throw new AcpTransportError('policy_unverified'); }
      if (input?.signal?.aborted) throw new AcpTransportError('cancelled');
      child = spawn(this.options.executable, [...this.options.argv], {
        cwd: this.options.cwd, env: { ...this.options.env }, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
      });
      return await this.exchange(child, input);
    } finally {
      if (child) await this.terminate(child);
      this.busy = false;
    }
  }

  private async terminate(child: ChildProcessWithoutNullStreams): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const closed = new Promise<void>(resolve => child.once('close', () => resolve()));
    child.kill('SIGTERM');
    await Promise.race([closed, new Promise<void>(resolve => setTimeout(resolve, this.options.terminationGraceMs ?? 250))]);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await Promise.race([closed, new Promise<void>(resolve => setTimeout(resolve, this.options.terminationGraceMs ?? 250))]);
  }

  private exchange(child: ChildProcessWithoutNullStreams, input: AcpTurnInput | undefined): Promise<AcpTurn & AcpDiscovery> {
    return new Promise((resolve, reject) => {
      let state: 'initialize' | 'new' | 'model' | 'prompt' | 'done' = 'initialize';
      let expected = 1;
      let next = 2;
      let sessionId = '';
      let text = '';
      let line = Buffer.alloc(0);
      let total = 0;
      let settled = false;
      let version: string | null = null;
      let models: AcpModel[] = [];
      let currentModelId: string | null = null;
      const fail = (code: AcpTransportError['code']) => finish(new AcpTransportError(code));
      const finish = (error?: AcpTransportError, stopReason?: string) => {
        if (settled) return;
        settled = true;
        state = 'done';
        clearTimeout(timer);
        input?.signal?.removeEventListener('abort', abort);
        child.stdout.off('data', receive);
        child.off('error', childError);
        child.off('close', childClose);
        child.stdin.off('error', stdinError);
        if (error) reject(error);
        else resolve({ sessionId, text, stopReason: stopReason ?? '', version, models, currentModelId });
      };
      const send = (message: Json) => {
        if (settled) return;
        try {
          const data = JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n';
          if (Buffer.byteLength(data) > (this.options.maxLineBytes ?? 64_000)) { fail('invalid_input'); return; }
          child.stdin.write(data);
        } catch { fail('protocol_error'); }
      };
      const call = (method: string, params: Json) => {
        expected = next++;
        send({ id: expected, method, params });
      };
      const abort = () => {
        if (sessionId) send({ method: 'session/cancel', params: { sessionId } });
        fail('cancelled');
      };
      const childError = () => fail('spawn_error');
      const childClose = () => fail('child_exit');
      const stdinError = () => fail('child_exit');
      const receive = (chunk: Buffer) => {
        if (settled) return;
        total += chunk.length;
        if (total > (this.options.maxOutputBytes ?? 512_000)) { fail('protocol_error'); return; }
        line = Buffer.concat([line, chunk]);
        let end: number;
        while (!settled && (end = line.indexOf(10)) >= 0) {
          const raw = line.subarray(0, end);
          line = line.subarray(end + 1);
          if (raw.length > (this.options.maxLineBytes ?? 64_000)) { fail('protocol_error'); return; }
          if (raw.length === 0) continue;
          let message: Json | null;
          try { message = object(JSON.parse(raw.toString('utf8'))); } catch { fail('protocol_error'); return; }
          if (!message || message.jsonrpc !== '2.0') { fail('protocol_error'); return; }
          handle(message);
        }
        if (line.length > (this.options.maxLineBytes ?? 64_000)) fail('protocol_error');
      };
      const handle = (message: Json) => {
        if (typeof message.method === 'string') {
          if (idIsValid(message.id)) {
            if (message.method === 'session/request_permission') {
              // ACP cancelled outcome is independent of offered allow/deny options.
              send({ id: message.id, result: { outcome: { outcome: 'cancelled' } } });
              return;
            }
            // All other agent->client RPCs, including filesystem and terminal, are unavailable.
            send({ id: message.id, error: { code: -32601, message: 'Method not found' } });
            return;
          }
          if (message.method !== 'session/update' || state !== 'prompt') return;
          const params = object(message.params);
          if (params?.sessionId !== sessionId) return;
          const update = object(params.update);
          if (update?.sessionUpdate !== 'agent_message_chunk') return;
          const content = object(update.content);
          if (content?.type !== 'text' || typeof content.text !== 'string') return;
          text += content.text;
          if (Buffer.byteLength(text) > (this.options.maxOutputBytes ?? 512_000)) { fail('protocol_error'); return; }
          try { input?.onText?.(content.text); } catch { fail('protocol_error'); }
          return;
        }
        // A response for an unknown or late id is never allowed to advance state.
        if (message.id !== expected || settled) return;
        if (object(message.error)) { fail('rpc_error'); return; }
        const result = object(message.result);
        if (!result) { fail('protocol_error'); return; }
        if (state === 'initialize') {
          if (result.protocolVersion !== 1) { fail('protocol_error'); return; }
          const info = object(result.agentInfo);
          version = typeof info?.version === 'string' ? info.version.slice(0, 128) : null;
          state = 'new';
          call('session/new', { cwd: this.options.cwd, mcpServers: [] });
        } else if (state === 'new') {
          if (typeof result.sessionId !== 'string' || !result.sessionId || result.sessionId.length > 256) { fail('protocol_error'); return; }
          sessionId = result.sessionId;
          if (this.options.verifySessionPolicy && !this.options.verifySessionPolicy(sessionId, result._meta)) {
            fail('policy_unverified'); return;
          }
          const catalog = object(result.models);
          currentModelId = typeof catalog?.currentModelId === 'string' ? catalog.currentModelId : null;
          models = (Array.isArray(catalog?.availableModels) ? catalog.availableModels : []).slice(0, 100).flatMap(m => {
            const value = object(m);
            return typeof value?.modelId === 'string' && value.modelId.length <= 256 ? [{ id: value.modelId, name: typeof value.name === 'string' ? value.name.slice(0, 256) : value.modelId }] : [];
          });
          if (!input) { finish(); return; }
          if (input.modelId && input.modelId !== 'default' && input.modelId !== currentModelId) {
            state = 'model';
            call('session/set_model', { sessionId, modelId: input.modelId });
          } else prompt();
        } else if (state === 'model') {
          prompt();
        } else if (state === 'prompt') {
          if (typeof result.stopReason !== 'string' || !result.stopReason) { fail('protocol_error'); return; }
          finish(undefined, result.stopReason);
        }
      };
      const prompt = () => {
        state = 'prompt';
        call('session/prompt', { sessionId, prompt: [{ type: 'text', text: input!.prompt }] });
      };
      const timer = setTimeout(() => fail('timeout'), this.options.deadlineMs ?? DEFAULT_DEADLINE);
      child.on('error', childError);
      child.on('close', childClose);
      child.stdin.on('error', stdinError);
      child.stdout.on('data', receive);
      // Do not include stderr or subprocess error text in diagnostics or responses.
      child.stderr.resume();
      input?.signal?.addEventListener('abort', abort, { once: true });
      if (input?.signal?.aborted) { abort(); return; }
      send({ id: 1, method: 'initialize', params: { protocolVersion: 1, clientCapabilities: { terminal: false, fs: { readTextFile: false, writeTextFile: false } }, clientInfo: { name: 'piton-chat', version: '1' } } });
    });
  }
}
