import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startAcpService, type AcpService, type AcpServiceOptions } from './acp-service.js';

const peer = String.raw`
let pending = '';
const emit = m => process.stdout.write(JSON.stringify({jsonrpc:'2.0',...m})+'\n');
process.stdin.on('data', c => {
 pending += c;
 let n;
 while ((n=pending.indexOf('\n'))>=0) {
  const m=JSON.parse(pending.slice(0,n)); pending=pending.slice(n+1);
  if(m.method==='initialize') emit({id:m.id,result:{protocolVersion:1,agentInfo:{version:'fixture'}}});
  if(m.method==='session/new') {
   const p={version:1,mode:'conversation-only',sessionId:'peer-session',tools:[],memory:false,contextFiles:false,plugins:false,modelingWrites:false};
   if(process.env.MODE==='bad-policy') p.memory=true;
   emit({id:m.id,result:{sessionId:'peer-session',_meta:process.env.MODE==='no-policy'?{}:{conversationPolicy:p},models:{currentModelId:'model-a',availableModels:[{modelId:'model-a',name:'A'},{modelId:'model-b',name:'B'}]}}});
  }
  if(m.method==='session/set_model') emit({id:m.id,result:{}});
  if(m.method==='session/prompt') {
   if(process.env.MODE==='silent') continue;
   if(process.env.MODE==='empty') {emit({id:m.id,result:{stopReason:'max_tokens'}});continue;}
   const text=m.params.prompt[0].text;
   emit({method:'session/update',params:{sessionId:'peer-session',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text}}}});
   emit({id:m.id,result:{stopReason:'end_turn'}});
  }
 }
});`;
const live: { service: AcpService; dir: string }[] = [];
afterEach(async () => { for (const { service, dir } of live.splice(0)) { await service.shutdown(); await rm(dir, { recursive: true, force: true }); } });
async function setup(mode = 'normal', attest = async () => true) {
  const dir = await mkdtemp(join(tmpdir(), 'piton-acp-test-'));
  const options: AcpServiceOptions = { executable: process.execPath, argv: ['-e', peer], cwd: process.cwd(),
    env: { PATH: process.env.PATH, MODE: mode }, attestRestrictedRuntime: attest,
    stateDirectory: dir, defaultModel: 'model-a', models: [{ id: 'model-a', label: 'A' }, { id: 'model-b', label: 'B' }], deadlineMs: 400 };
  const service = await startAcpService(options); live.push({ service, dir });
  const request = (path: string, payload?: unknown, token = service.env.API_SERVER_KEY) => fetch(service.env.PITON_HERMES_UPSTREAM + '/p/nick-mercer' + path, {
    method: payload === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  return { service, dir, request };
}
async function session(request: Awaited<ReturnType<typeof setup>>['request']) {
  const r = await request('/api/sessions', {});
  expect(r.status).toBe(200);
  return ((await r.json()) as { session: { id: string } }).session.id;
}
describe('private ACP normalization with inert peer', () => {
  it('authorizes requests, discovers actual metadata and normalizes completed turn', async () => {
    const f = await setup();
    expect((await f.request('/v1/models', undefined, 'wrong')).status).toBe(401);
    expect((await f.request('/v1/models')).status).toBe(200);
    const id = await session(f.request);
    const result = await f.request(`/api/sessions/${id}/chat/stream`, { input: 'first' });
    const text = await result.text();
    expect(text).toContain('event: assistant.delta');
    expect(text).toContain(`"session_id":"${id}"`);
    expect(text).toContain('"completed":true');
    expect(text).toContain('"content":"first"');
    const other = await session(f.request);
    const next = await (await f.request(`/api/sessions/${id}/chat/stream`, { input: 'second' })).text();
    expect(next).toContain('first');
    expect(next).toContain('second');
    const isolated = await (await f.request(`/api/sessions/${other}/chat/stream`, { input: 'other' })).text();
    expect(isolated).not.toContain('first');
    expect((await f.request('/api/sessions/unknown/chat/stream', { input: 'x' })).status).toBe(404);
    expect((await f.request(`/api/sessions/${id}/chat/stream`, { extra: 'x', input: 'x' })).status).toBe(400);
  });
  it('fails closed on missing or false metadata and failed source attestation', async () => {
    for (const mode of ['no-policy', 'bad-policy']) {
      const f = await setup(mode);
      expect(await f.service.verifyIsolation()).toBe(false);
      expect((await f.request('/api/sessions', {})).status).toBe(503);
    }
    const f = await setup('normal', async () => false);
    expect(await f.service.verifyIsolation()).toBe(false);
    expect((await f.request('/v1/models')).status).toBe(503);
    let sourceVerified = true;
    const cached = await setup('normal', async () => sourceVerified);
    expect(await cached.service.verifyIsolation()).toBe(true);
    sourceVerified = false;
    expect(await cached.service.verifyIsolation()).toBe(false);
    expect((await cached.request('/v1/models')).status).toBe(503);
  });
  it('rejects incomplete output, cancels on disconnect and invalidates on model change', async () => {
    const f = await setup('empty');
    const id = await session(f.request);
    const text = await (await f.request(`/api/sessions/${id}/chat/stream`, { input: 'x' })).text();
    expect(text).not.toContain('assistant.completed');
    expect(text).toContain('event: error');
    await expect(f.service.management.save('absent')).rejects.toThrow('unknown_model');
    await f.service.management.save('model-b');
    expect((await f.request(`/api/sessions/${id}/chat/stream`, { input: 'x' })).status).toBe(404);
    expect(JSON.parse(await readFile(join(f.dir, 'acp-model.json'), 'utf8'))).toEqual({ model: 'model-b' });
    expect((await stat(join(f.dir, 'acp-model.json'))).mode & 0o777).toBe(0o600);
    const silent = await setup('silent');
    const sid = await session(silent.request);
    const controller = new AbortController();
    const call = fetch(silent.service.env.PITON_HERMES_UPSTREAM + `/p/nick-mercer/api/sessions/${sid}/chat/stream`, {
      method: 'POST', headers: { authorization: `Bearer ${silent.service.env.API_SERVER_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ input: 'wait' }), signal: controller.signal,
    });
    const response = await call; controller.abort();
    await response.body?.cancel().catch(() => {});
    expect((await silent.service.management.snapshot()) as { status: string }).toHaveProperty('status');
  });
});
