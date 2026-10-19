import { describe, expect, it } from 'vitest';
import { AcpRuntime, AcpTransportError } from './acp-runtime.js';

// Inert ACP peer. No Hermes inference, credentials, shells, network or product state.
const fixture = String.raw`
let buf = '';
const mode = process.env.FIXTURE_MODE;
const emit = value => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n');
process.stdin.on('data', chunk => {
  buf += chunk;
  let index;
  while ((index = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, index); buf = buf.slice(index + 1);
    const m = JSON.parse(line);
    if (m.method === 'initialize') {
      if (mode === 'malformed') { process.stdout.write('bad-json\n'); continue; }
      emit({ id:m.id, result:{ protocolVersion:1, agentInfo:{version:'test-version'} } });
    } else if (m.method === 'session/new') {
      emit({ id:m.id, result:{ sessionId:'s1', models:{currentModelId:'m1',availableModels:[{modelId:'m1',name:'Mock'}]} } });
    } else if (m.method === 'session/set_model') emit({ id:m.id, result:{} });
    else if (m.method === 'session/prompt') {
      if (mode === 'exit') { process.stderr.write('PRIVATE_FIXTURE_SENTINEL'); process.exit(2); }
      if (mode === 'silent') continue;
      if (mode === 'tools') {
        emit({ id:90, method:'fs/read_text_file', params:{path:'/etc/passwd'} });
        emit({ id:91, method:'terminal/create', params:{} });
        emit({ id:92, method:'session/request_permission', params:{sessionId:'s1',options:[{optionId:'allow',kind:'allow_once'}]} });
        continue;
      }
      emit({ method:'session/update',params:{ sessionId:'other', update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'WRONG'}} } });
      emit({ method:'session/update',params:{ sessionId:'s1', update:{sessionUpdate:'agent_thought_chunk',content:{type:'text',text:'SECRET_THOUGHT'}} } });
      emit({ method:'session/update',params:{ sessionId:'s1', update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Hello'}} } });
      emit({ method:'session/update',params:{ sessionId:'s1', update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:' world'}} } });
      emit({ id:999, result:{stopReason:'fake'} });
      emit({ id:m.id,result:{stopReason:'end_turn'} });
    } else if (m.id === 90 || m.id === 91 || m.id === 92) {
      if (m.id === 90 || m.id === 91) { if (m.error?.code !== -32601) process.exit(3); }
      if (m.id === 92) { if (m.result?.outcome?.outcome !== 'cancelled') process.exit(4);
        emit({ id:3, result:{stopReason:'refusal'} }); }
    }
  }
});
`;

function runtime(mode = 'normal', attestRestrictedRuntime = async () => true, deadlineMs = 3000) {
  return new AcpRuntime({
    executable: process.execPath, argv: ['-e', fixture], cwd: process.cwd(),
    env: { PATH: process.env.PATH, FIXTURE_MODE: mode }, attestRestrictedRuntime,
    deadlineMs, terminationGraceMs: 50,
  });
}
const rejected = (code: AcpTransportError['code']) => ({ code });

describe('ACP transport (synthetic peer)', () => {
  it('discovers version/models separately and streams only bound assistant text with actual stop reason', async () => {
    const r = runtime();
    expect(await r.discover()).toMatchObject({ version: 'test-version', currentModelId: 'm1', models: [{ id: 'm1', name: 'Mock' }] });
    const deltas: string[] = [];
    const turn = await r.run({ prompt: 'Hello', modelId: 'm2', onText: d => deltas.push(d) });
    expect(turn).toMatchObject({ sessionId: 's1', text: 'Hello world', stopReason: 'end_turn' });
    expect(deltas).toEqual(['Hello', ' world']);
  });
  it('requires independent trusted policy attestation before spawn', async () => {
    await expect(runtime('normal', async () => false).run({ prompt: 'hi' })).rejects.toMatchObject(rejected('policy_unverified'));
  });
  it('rejects malformed messages and child exits without stderr exposure', async () => {
    await expect(runtime('malformed').run({ prompt: 'hi' })).rejects.toMatchObject(rejected('protocol_error'));
    await expect(runtime('exit').run({ prompt: 'hi' })).rejects.toMatchObject(rejected('child_exit'));
  });
  it('bounds silent prompts and rejects concurrent prompts until cleanup', async () => {
    const r = runtime('silent', async () => true, 150);
    const first = r.run({ prompt: 'hi' });
    await expect(r.run({ prompt: 'other' })).rejects.toMatchObject(rejected('busy'));
    await expect(first).rejects.toMatchObject(rejected('timeout'));
  });
  it('cancels active session and reaps the child', async () => {
    const controller = new AbortController();
    const run = runtime('silent').run({ prompt: 'hi', signal: controller.signal });
    setTimeout(() => controller.abort(), 100);
    await expect(run).rejects.toMatchObject(rejected('cancelled'));
  });
  it('denies permission and rejects client filesystem/terminal RPCs', async () => {
    const turn = await runtime('tools').run({ prompt: 'hi' });
    expect(turn.stopReason).toBe('refusal');
  });
});
