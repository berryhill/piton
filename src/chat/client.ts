export type ChatMessage = { role: 'user' | 'assistant'; content: string };
export type History = { messages: ChatMessage[]; blocked: boolean; status: string };
export type Availability = { available: boolean; profile: string; capabilities: string[]; runtime?: { model?: string; provider?: string } };
export type StreamEvent = { name: string; data: Record<string, unknown> };
export class ChatClient {
  private csrf = '';
  private async request(path: string, body?: unknown, signal?: AbortSignal) {
    const timeout = AbortSignal.timeout(path === 'conversation' ? 180_000 : 20_000);
    signal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await fetch(`/api/chat/${path}`, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', redirect: 'error', signal, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(this.csrf ? { 'X-Piton-CSRF': this.csrf } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!response.ok) {
      const value = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(value.error ?? `chat_http_${response.status}`);
    }
    return response;
  }
  async connect(projectId: string, signal?: AbortSignal) {
    const auth = await (await this.request('bootstrap', undefined, signal)).json() as { authenticated?: boolean; csrfToken?: string };
    if (!auth.authenticated || typeof auth.csrfToken !== 'string') throw new Error('authentication_required');
    this.csrf = auth.csrfToken;
    await this.request('projects', { projectId }, signal);
    const [availability, history] = await Promise.all([this.request('availability', undefined, signal).then(r => r.json()) as Promise<Availability>, this.history(projectId, signal)]);
    return { availability, history };
  }
  async history(projectId: string, signal?: AbortSignal): Promise<History> {
    const history = await (await this.request(`history?projectId=${encodeURIComponent(projectId)}`, undefined, signal)).json() as History;
    if (!Array.isArray(history.messages) || history.messages.some(m => !['user','assistant'].includes(m.role) || typeof m.content !== 'string')) throw new Error('invalid_history');
    return history;
  }
  async stop(projectId: string) { return (await this.request('stop', { projectId })).json() as Promise<{ stopped: boolean }>; }
  async recover(projectId: string) { await this.request('recover', { projectId }); }
  async send(input: {projectId: string; message: string; context: string; requestId: string; documentId: string | null}, event: (event: StreamEvent) => void, signal: AbortSignal) {
    const response = await this.request('conversation', input, signal);
    if (!response.headers.get('content-type')?.startsWith('text/event-stream') || !response.body) throw new Error('invalid_stream');
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let buffer = '', total = 0, completed = false;
    try {
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        total += chunk.value.byteLength; if (total > 1048576) throw new Error('stream_too_large');
        buffer = (buffer + decoder.decode(chunk.value, {stream:true})).replace(/\r\n/g, '\n');
        let boundary: number;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const lines = buffer.slice(0,boundary).split('\n'); buffer = buffer.slice(boundary+2);
          const name = lines.find(line => line.startsWith('event:'))?.slice(6).trim();
          const dataText = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
          if (!name || !dataText) continue;
          const data = JSON.parse(dataText) as Record<string, unknown>;
          if (name === 'error') throw new Error(typeof data.error === 'string' ? data.error : 'upstream_error');
          if (name === 'assistant.completed') { if (typeof data.content !== 'string') throw new Error('invalid_stream'); completed = true; }
          event({name,data});
        }
      }
      if (!completed) throw new Error('stream_interrupted');
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
}
