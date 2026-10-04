import { useEffect, useRef, useState } from 'react';
import type { WorkspaceProject } from '../workspace';
import { ChatClient, type Availability, type ChatMessage } from './client';
import { freezeContext, type FrozenContext, type SelectionReference } from './context';
import './chat.css';

type Props = { project: WorkspaceProject; documentId?: string; revisionId?: string; selection: SelectionReference[]; selectionLabel?: string; selectionDetail?: string; projectionMode?: string; unavailableReason?: string; draft?: boolean; preview?: boolean };
export function ConversationPanel({ project, documentId, revisionId, selection, selectionLabel, selectionDetail, projectionMode, unavailableReason, draft = false, preview = false }: Props) {
  const client = useRef(new ChatClient()).current;
  const mounted = useRef(false), operation = useRef(false), connectionGeneration = useRef(0), stream = useRef<AbortController | null>(null);
  const [messages,setMessages] = useState<ChatMessage[]>([]), [prompt,setPrompt] = useState('');
  const [availability,setAvailability] = useState<Availability | null>(null), [status,setStatus] = useState('Connecting…');
  const [busy,setBusy] = useState(false), [blocked,setBlocked] = useState(false), [error,setError] = useState('');
  const [attachments,setAttachments] = useState<SelectionReference[]>([]), [sentContext,setSentContext] = useState<FrozenContext | null>(null);
  const [partial,setPartial] = useState(''), [runId,setRunId] = useState('');
  const [remoteRunning,setRemoteRunning] = useState(false);
  async function reconnect(signal?: AbortSignal) {
    const generation = ++connectionGeneration.current;
    setAvailability(null);setStatus('Connecting…'); setError('');
    try {
      const result = await client.connect(project.id, signal);
      if (!mounted.current || signal?.aborted || generation !== connectionGeneration.current) return;
      setAvailability(result.availability); setMessages(result.history.messages); setBlocked(result.history.blocked);setPartial('');
      const running = result.history.status === 'running'; setRemoteRunning(running);
      setStatus(running ? 'Run in progress — reconnect to refresh history' : result.history.blocked ? 'Recovery required' : result.availability.available ? 'Connected to Nick Mercer' : 'Agent unavailable');
    } catch (e) { if (mounted.current && !signal?.aborted && generation === connectionGeneration.current) {setAvailability(null);setStatus('Disconnected');setError(e instanceof Error ? e.message : 'connection_failed');} }
  }
  useEffect(() => {
    mounted.current = true; const controller = new AbortController(); void reconnect(controller.signal);
    return () => { mounted.current = false; controller.abort(); stream.current?.abort(); };
  }, [project.id, client]);
  async function send() {
    if (operation.current || !prompt.trim() || !availability?.available || blocked || remoteRunning) return;
    let context: FrozenContext;
    try { context = freezeContext(project, documentId, revisionId, selection, attachments, draft, preview); }
    catch (e) {setError(e instanceof Error ? e.message : 'invalid_context');return;}
    const message = prompt.trim(), controller = new AbortController();
    operation.current = true; connectionGeneration.current++; stream.current = controller; setBusy(true);setError('');setPartial('');setRunId('');setSentContext(context);setStatus('Sending…');
    setMessages(current => [...current,{role:'user',content:message}]);setPrompt('');
    let complete = false;
    try {
      await client.send({projectId:project.id,documentId:context.activeDocument?.documentId ?? null,message,context:JSON.stringify(context),requestId:crypto.randomUUID()}, event => {
        if (!mounted.current) return;
        if (event.name === 'run.started') {setRunId(String(event.data.runId ?? ''));setStatus('Nick is responding…');}
        if (event.name === 'assistant.delta' && typeof event.data.delta === 'string') {const delta = event.data.delta;setPartial(text => text + delta);}
        if (event.name === 'assistant.completed') {
          complete = true;setMessages(current => [...current,{role:'assistant',content:String(event.data.content)}]);setPartial('');setStatus('Reply complete');
        }
      },controller.signal);
    } catch (e) {
      if (mounted.current) {setError(e instanceof Error ? e.message : 'stream_failed');setStatus('Response interrupted — reconnect before retrying');setBlocked(true);}
    } finally {
      stream.current = null;
      if (mounted.current) {
        // Read authoritative transcript, never retry an ambiguous submission automatically.
        try { const history = await client.history(project.id); if (mounted.current) {setMessages(history.messages);setBlocked(history.blocked);setRemoteRunning(history.status === 'running');if (complete) setPartial('');} }
        catch { if (mounted.current) setBlocked(true); }
      }
      operation.current = false;if (mounted.current) setBusy(false);
    }
  }
  async function stop() {
    setError('');setStatus('Stopping…');
    try {
      const result = await client.stop(project.id);
      if (!mounted.current) return;
      setStatus(result.stopped ? 'Stop acknowledged; saved revisions are unchanged' : 'No running response');
      if (!busy) await reconnect();
    } catch (e) { if (mounted.current) {setError(e instanceof Error ? e.message : 'stop_failed');setStatus('Stop could not be confirmed');} }
  }
  async function recover() {
    if (operation.current) return; operation.current = true;setBusy(true);setError('');
    try {await client.recover(project.id);if (mounted.current) await reconnect();}
    catch (e) {if (mounted.current) setError(e instanceof Error ? e.message : 'recovery_failed');}
    finally {operation.current = false;if (mounted.current) setBusy(false);}
  }
  return <section className="piton-chat" aria-label="Project conversation">
    <header><h3>Nick Mercer</h3><span role="status" aria-label="Agent connection status">{status}</span></header>
    <p className="chat-scope">Project conversation · {project.name}<br/>{documentId ? `Current tab: ${project.documents.find(d => d.id === documentId)?.name}` : 'No active tab — project context only'}</p>
    <p className="chat-scope">Read-only conversation. No modeling or workstation tools granted.</p>
    {availability?.runtime && <details><summary>Runtime</summary><p>{availability.runtime.provider ?? 'Provider unreported'} · {availability.runtime.model ?? 'Model unreported'}</p><p>Capabilities: {availability.capabilities.join(', ') || 'None'}</p></details>}
    <div className="chat-transcript" role="log" aria-label="Conversation history" aria-live="polite">{messages.map((message,index) => <article key={index} className={`chat-turn chat-${message.role}`}><strong>{message.role === 'user' ? 'You' : 'Nick'}</strong><p>{message.content}</p></article>)}{partial && <article className="chat-turn"><strong>Nick · {busy ? 'streaming' : 'incomplete'}</strong><p>{partial}</p></article>}{!messages.length && !partial && <p>No conversation yet. Ask about this project, with or without an open Part.</p>}</div>
    <div className="chat-attachments"><section className="r7-tree-details" aria-label="Model selection details"><h4>Selected context</h4><p>{selectionLabel ? `${selectionLabel} · ${projectionMode ?? 'current'}` : selection.length ? selection.map(ref => ref.label).join(', ') : 'No selected reference in this projection.'}</p>{selectionDetail&&<p>{selectionDetail}</p>}{unavailableReason&&<p>{unavailableReason}</p>}</section>
      <button type="button" disabled={!selection.length || busy} onClick={() => setAttachments(current => [...current,...selection.filter(ref => !current.some(old => old.documentId === ref.documentId && old.nodeId === ref.nodeId))].slice(0,16))}>Attach selected reference</button>
      <ul aria-label="Attached context">{attachments.map((ref,index) => <li key={`${ref.documentId}:${ref.nodeId}`}>{ref.label}<button type="button" aria-label={`Remove ${ref.label}`} disabled={busy} onClick={() => setAttachments(current => current.filter((_,i) => i !== index))}>×</button></li>)}</ul>
      <p className="chat-scope">Highlights and explicit attachments are separate. References are coordinate context, not exact geometry.</p>
    </div>
    {sentContext && <details><summary>Last sent frozen context</summary><pre>{JSON.stringify(sentContext,null,2)}</pre>{runId && <p>Run: {runId}</p>}</details>}
    {error && <p className="chat-error" aria-live="polite">{error}</p>}
    <form onSubmit={event => {event.preventDefault();void send();}}><label>Message Nick<textarea aria-label="Message Nick" value={prompt} maxLength={8000} disabled={busy} onChange={event => setPrompt(event.target.value)} placeholder="Ask about this project…"/></label><div className="chat-actions"><button type="submit" disabled={busy || remoteRunning || blocked || !availability?.available || !prompt.trim()}>Send</button><button type="button" disabled={!busy && !remoteRunning} onClick={() => void stop()}>Stop</button><button type="button" disabled={busy} onClick={() => void reconnect()}>Reconnect</button></div></form>
    {blocked && <div><p>The previous response may be incomplete. Reconnect checks history without resending. Recovery starts a new runtime session with the saved conversation.</p><button disabled={busy || remoteRunning} onClick={() => void recover()}>Recover interrupted conversation</button></div>}
  </section>;
}
