import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ConversationPanel } from '../src/chat/ConversationPanel';
import { freezeContext, type SelectionReference } from '../src/chat/context';
import { ChatClient } from '../src/chat/client';
import type { WorkspaceProject } from '../src/workspace';

const project = (): WorkspaceProject => ({id:'11111111-1111-4111-8111-111111111111',name:'Test project',archived:false,updatedAt:'2026-01-01',documents:['Alpha','Beta'].map((name,i) => ({id:`22222222-2222-4222-8222-22222222222${i}`,name,part:{id:name,name,acceptedRevisionId:null,currentRevisionId:null,revisions:[]},revisionIds:{}}))});
const reference = (p: WorkspaceProject): SelectionReference => ({documentId:p.documents[0].id,revisionId:null,nodeId:'top',label:'Alpha · Top plane',representation:'coordinate-reference'});
afterEach(() => {cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
function transport() {
  const sent: Record<string,unknown>[] = [];let controller: ReadableStreamDefaultController<Uint8Array>;
  let messages: {role:string;content:string}[] = [], blocked = false;
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url).replace('/api/chat/','');
    const json = (value:unknown) => new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
    if (path === 'bootstrap') return json({authenticated:true,csrfToken:'test-csrf-noncredential'});
    if (path === 'projects') return json({ok:true});
    if (path === 'availability') return json({available:true,profile:'nick-mercer',capabilities:[],runtime:{model:'test transport',provider:'mock'}});
    if (path.startsWith('history?')) return json({messages,blocked,status:blocked?'interrupted':'idle'});
    if (path === 'conversation') {
      const value = JSON.parse(String(init?.body));sent.push(value);messages = [...messages,{role:'user',content:value.message}];
      return new Response(new ReadableStream<Uint8Array>({start(c){controller=c;}}),{headers:{'Content-Type':'text/event-stream'}});
    }
    if (path === 'stop') {blocked=true;controller.enqueue(new TextEncoder().encode('event: error\ndata: {"error":"interrupted"}\n\n'));controller.close();return json({stopped:true});}
    if (path === 'recover') {blocked=false;return json({recovered:true});}
    throw new Error(`unexpected test route ${path}`);
  });
  vi.stubGlobal('fetch',fetcher);
  return {sent,fetcher, emit(name:string,data:unknown){controller.enqueue(new TextEncoder().encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`));}, finish(text:string){messages=[...messages,{role:'assistant',content:text}];controller.enqueue(new TextEncoder().encode(`event: assistant.completed\ndata: ${JSON.stringify({content:text})}\n\nevent: done\ndata: {}\n\n`));controller.close();}};
}
async function ready() {await waitFor(() => expect(screen.getByRole('status',{name:'Agent connection status'})).toHaveTextContent('Connected'));}
async function send(message='Test prompt') {fireEvent.change(screen.getByRole('textbox',{name:'Message Nick'}),{target:{value:message}});fireEvent.click(screen.getByRole('button',{name:'Send'}));}
it('sends from a project with no active tab and reconciles streamed history without duplicate turns',async () => {
  const t=transport(),p=project();render(<ConversationPanel project={p} selection={[]}/>);await ready();await send();
  await waitFor(() => expect(t.sent).toHaveLength(1));
  expect(t.sent[0].documentId).toBeNull();expect(JSON.parse(String(t.sent[0].context)).activeDocument).toBeNull();
  await act(async () => {t.emit('run.started',{runId:'test-run'});t.emit('assistant.delta',{delta:'A test '});});
  expect(screen.getByRole('log')).toHaveTextContent('A test');
  await act(async () => t.finish('A test response'));
  await waitFor(() => expect(screen.getByRole('button',{name:'Reconnect'})).toBeEnabled());
  expect(within(screen.getByRole('log')).getAllByText('Test prompt')).toHaveLength(1);
  expect(within(screen.getByRole('log')).getAllByText('A test response')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button',{name:'Reconnect'}));await ready();expect(t.sent).toHaveLength(1);
  expect(t.fetcher.mock.calls.filter(([url]) => String(url).endsWith('conversation'))[0][1]?.headers).toMatchObject({'X-Piton-CSRF':'test-csrf-noncredential'});
});
it('freezes A and explicit attachments across rerender to B without remounting conversation',async () => {
  const t=transport(),p=project(),ref=reference(p);const view=render(<ConversationPanel project={p} documentId={p.documents[0].id} selection={[ref]}/>);await ready();
  fireEvent.click(screen.getByRole('button',{name:'Attach selected reference'}));await send();await waitFor(() => expect(t.sent).toHaveLength(1));
  view.rerender(<ConversationPanel project={p} documentId={p.documents[1].id} selection={[]}/>);
  const frozen=JSON.parse(String(t.sent[0].context));expect(frozen.activeDocument.documentId).toBe(p.documents[0].id);expect(frozen.attachments).toEqual([ref]);
  expect(screen.getByText('Last sent frozen context').parentElement).toHaveTextContent(p.documents[0].id);
  await act(async () => t.finish('Bound to Alpha'));expect(screen.getByRole('log')).toHaveTextContent('Bound to Alpha');
  expect(t.fetcher.mock.calls.filter(([url]) => String(url).endsWith('bootstrap'))).toHaveLength(1);
});
it('Stop calls the real stop route, keeps partial truth and requires explicit recovery',async () => {
  const t=transport();render(<ConversationPanel project={project()} selection={[]}/>);await ready();await send();await waitFor(() => expect(t.sent).toHaveLength(1));
  fireEvent.click(screen.getByRole('button',{name:'Stop'}));
  await waitFor(() => expect(screen.getByRole('button',{name:'Recover interrupted conversation'})).toBeEnabled());
  expect(screen.getByRole('button',{name:'Send'})).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'Recover interrupted conversation'}));await ready();expect(t.sent).toHaveLength(1);
});
it('surfaces unavailable authentication without fabricated responses',async () => {
  vi.stubGlobal('fetch',vi.fn(async () => new Response('{"error":"unauthorized"}',{status:401})));render(<ConversationPanel project={project()} selection={[]}/>);
  await screen.findByText('unauthorized');expect(screen.getByRole('button',{name:'Send'})).toBeDisabled();expect(screen.getByRole('log')).not.toHaveTextContent('Nick');
});
it('keeps removable attached references distinct from current highlights',async () => {
  transport();const p=project(),ref=reference(p);render(<ConversationPanel project={p} documentId={p.documents[0].id} selection={[ref]}/>);await ready();
  expect(screen.getByRole('list',{name:'Attached context'})).toBeEmptyDOMElement();fireEvent.click(screen.getByRole('button',{name:'Attach selected reference'}));
  fireEvent.click(screen.getByRole('button',{name:`Remove ${ref.label}`}));expect(screen.getByRole('list',{name:'Attached context'})).toBeEmptyDOMElement();
});
it('snapshots immutable bounded data and rejects wrong project, missing revision and fake topology',() => {
  const p=project(),ref=reference(p),context=freezeContext(p,p.documents[0].id,undefined,[ref],[ref]);
  ref.label='changed';p.documents[0].name='changed';expect(context.selection[0].label).toBe('Alpha · Top plane');expect(context.activeDocument?.name).toBe('Alpha');expect(Object.isFrozen(context.attachments[0])).toBe(true);
  expect(() => freezeContext(p,'foreign')).toThrow('scope_mismatch');expect(() => freezeContext(p,p.documents[0].id,'gone')).toThrow('stale_revision');
  expect(() => freezeContext(p,undefined,undefined,[{...ref,documentId:'foreign'}])).toThrow('scope_mismatch');
  expect(() => freezeContext(p,undefined,undefined,[{...ref,nodeId:'mesh-face-0'}])).toThrow('unsupported_reference');
  expect(() => freezeContext(p,undefined,undefined,Array(17).fill(ref))).toThrow('context_too_large');
  expect(context.buildId).toBeNull();expect(context.savedParameters).toBeNull();expect(context.constraints.material).toBeNull();
});
it('handles fragmented CRLF SSE frames and refuses a stream without completion',async () => {
  const frame='event: assistant.delta\r\ndata: {"delta":"hello"}\r\n\r\nevent: assistant.completed\r\ndata: {"content":"hello"}\r\n\r\n';
  vi.stubGlobal('fetch',vi.fn(async () => new Response(new ReadableStream({start(c){for(const byte of new TextEncoder().encode(frame))c.enqueue(new Uint8Array([byte]));c.close();}}),{headers:{'Content-Type':'text/event-stream'}})));
  const events: string[]=[];await new ChatClient().send({projectId:project().id,documentId:null,requestId:crypto.randomUUID(),message:'hi',context:'{}'},e => events.push(e.name),new AbortController().signal);
  expect(events).toEqual(['assistant.delta','assistant.completed']);
  vi.stubGlobal('fetch',vi.fn(async () => new Response('event: assistant.delta\ndata: {"delta":"partial"}\n\n',{headers:{'Content-Type':'text/event-stream'}})));
  await expect(new ChatClient().send({projectId:project().id,documentId:null,requestId:crypto.randomUUID(),message:'hi',context:'{}'},() => {},new AbortController().signal)).rejects.toThrow('stream_interrupted');
});
