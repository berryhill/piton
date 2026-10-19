import { useEffect, useRef, useState } from 'react';
import { ChatClient, type RuntimeSnapshot } from './client';

type Props = { client: ChatClient; onRuntimeResponse: () => void; authenticated: boolean };

export function RuntimeSettings({ client, onRuntimeResponse, authenticated }: Props) {
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot | null>(null);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [testResult, setTestResult] = useState('');
  const [loading, setLoading] = useState(authenticated);
  const controller = useRef<AbortController | null>(null);
  const locked = useRef(false);
  useEffect(() => {
    if (!authenticated) return;
    const request = new AbortController(); controller.current = request;
    setLoading(true);
    void client.runtime(request.signal).then(value => {
      if (request.signal.aborted) return;
      setSnapshot(value); setSelected(value.model); setLoading(false);
    }).catch(cause => {
      if (request.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : 'runtime_unavailable'); setLoading(false);
    });
    return () => { request.abort(); controller.current?.abort(); };
  }, [client, authenticated]);

  async function act(kind: 'save' | 'test') {
    if (locked.current || !snapshot || !authenticated) return;
    if (kind === 'save' && !snapshot.models.some(model => model.id === selected)) return;
    locked.current = true; setBusy(true); setError(''); setTestResult('');
    const request = new AbortController(); controller.current = request;
    try {
      if (kind === 'save') {
        const value = await client.saveRuntimeModel(selected, request.signal);
        if (request.signal.aborted) return;
        setSnapshot(value); setSelected(value.model);
      } else {
        const result = await client.testRuntime(request.signal);
        if (request.signal.aborted) return;
        setSnapshot(result.runtime);
        setTestResult(`${result.ok ? 'Test passed' : 'Test failed'}: ${result.message}`);
      }
      onRuntimeResponse();
    } catch (cause) {
      if (!request.signal.aborted) setError(cause instanceof Error ? cause.message : 'runtime_request_failed');
    } finally {
      if (!request.signal.aborted) setBusy(false);
      locked.current = false;
    }
  }

  return <div className="chat-runtime-settings">
    <p>Hermes ACP · nick-mercer (server-owned) · conversation-only. No tools or unrelated memory access.</p>
    {!authenticated ? <p role="alert">Authentication required to view or change agent runtime settings. Reconnect after signing in.</p> : loading ? <p role="status">Loading runtime settings…</p> : snapshot ? <>
      <p>Version: {snapshot.version || 'Not reported'} · Status: {snapshot.status} · Policy: {snapshot.policyVerified ? 'verified' : 'not verified'}</p>
      {snapshot.status === 'unconfigured' && <p>Hermes is unconfigured; no connection has been verified.</p>}
      {snapshot.reason && <p>Reason: {snapshot.reason}</p>}
      <label htmlFor="chat-runtime-model">Model</label>
      <select id="chat-runtime-model" value={selected} disabled={busy || !snapshot.models.length} onChange={event => { setSelected(event.target.value); setTestResult(''); }}>
        {!snapshot.models.some(model => model.id === selected) && <option value={selected} disabled>{selected || 'No supported model selected'}</option>}
        {snapshot.models.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}
      </select>
      <div className="chat-actions"><button type="button" disabled={busy || !snapshot.models.some(model => model.id === selected) || selected === snapshot.model} onClick={() => void act('save')}>Save model</button><button type="button" disabled={busy} onClick={() => void act('test')}>Test connection</button></div>
      {testResult && <p role="status">{testResult}</p>}
    </> : null}
    {error && <p className="chat-error" role="alert">{error}</p>}
  </div>;
}
