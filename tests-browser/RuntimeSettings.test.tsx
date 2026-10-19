import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RuntimeSettings } from '../src/chat/RuntimeSettings';
import { ConversationPanel } from '../src/chat/ConversationPanel';
import { ChatClient, type RuntimeSnapshot } from '../src/chat/client';
import type { WorkspaceProject } from '../src/workspace';

const snapshot = (override: Partial<RuntimeSnapshot> = {}): RuntimeSnapshot => ({ runtime: 'hermes', profile: 'nick-mercer', transport: 'acp', mode: 'conversation-only', status: 'unconfigured', model: '', models: [{ id: '', label: 'Server default' }, { id: 'local-model', label: 'Local model' }], policyVerified: false, version: '1.0', ...override });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const project = (id = '11111111-1111-4111-8111-111111111111'): WorkspaceProject => ({ id, name: 'Test', archived: false, updatedAt: '2026-01-01', documents: [] });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('lazily reads settings only after opening, displays fixed access boundary and missing authentication', async () => {
  const fetcher = vi.fn(async (url: string) => {
    if (url.endsWith('bootstrap')) return json({ authenticated: true, csrfToken: 'test-csrf' });
    if (url.endsWith('projects')) return json({ ok: true });
    if (url.endsWith('availability')) return json({ available: false, profile: 'nick-mercer', capabilities: [] });
    if (url.includes('history?')) return json({ messages: [], blocked: false, status: 'idle' });
    if (url.endsWith('runtime')) return json(snapshot());
    throw new Error(`unexpected route ${url}`);
  });
  vi.stubGlobal('fetch', fetcher);
  render(<ConversationPanel project={project()} selection={[]}/>);
  await waitFor(() => expect(screen.getByRole('status', { name: 'Agent connection status' })).toHaveTextContent('Agent unavailable'));
  expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/runtime'))).toBe(false);
  fireEvent.click(screen.getByText('Agent runtime settings'));
  expect(await screen.findByText(/Hermes ACP · nick-mercer \(server-owned\)/)).toHaveTextContent('No tools or unrelated memory access');
  expect(screen.getByText(/Hermes is unconfigured/)).toBeInTheDocument();
  expect(screen.getByText(/Policy: not verified/)).toBeInTheDocument();
  expect(screen.queryByLabelText(/credential|password|path|command/i)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save model' })).toBeDisabled();
  fireEvent.click(screen.getByText('Agent runtime settings'));
  await waitFor(() => expect(screen.queryByLabelText('Model')).not.toBeInTheDocument());
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/runtime'))).toHaveLength(1);
});

it('submits only server-listed model with CSRF, prevents duplicate save, and refreshes only on response', async () => {
  let finish!: (value: Response) => void;
  const pending = new Promise<Response>(resolve => { finish = resolve; });
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => url.endsWith('/runtime/settings') ? pending : json(snapshot()));
  vi.stubGlobal('fetch', fetcher);
  const callback = vi.fn(); render(<RuntimeSettings client={new ChatClient()} authenticated onRuntimeResponse={callback}/>);
  await screen.findByLabelText('Model');
  fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'local-model' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save model' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save model' }));
  expect(callback).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Test connection' })).toBeDisabled();
  const saves = fetcher.mock.calls.filter(([url]) => String(url).endsWith('/runtime/settings'));
  expect(saves).toHaveLength(1);
  expect(JSON.parse(String(saves[0][1]?.body))).toEqual({ model: 'local-model' });
  expect(saves[0][1]?.headers).toMatchObject({ 'Content-Type': 'application/json' });
  await act(async () => finish(json(snapshot({ model: 'local-model', status: 'ready', policyVerified: true }))));
  expect(callback).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/Test passed/)).not.toBeInTheDocument();
  expect(screen.getByText(/Status: ready · Policy: verified/)).toBeInTheDocument();
});

it('reports test success and failure only from actual reply; HTTP errors retain selection', async () => {
  let outcome = json({ ok: false, message: 'No bounded reply', runtime: snapshot({ status: 'failed' }) });
  let saveFails = true;
  const fetcher = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url.endsWith('/runtime/settings') && saveFails) return json({ error: 'not_available' }, 503);
    if (url.endsWith('/runtime/test')) return outcome;
    return json(snapshot());
  });
  vi.stubGlobal('fetch', fetcher);
  const callback = vi.fn(); render(<RuntimeSettings client={new ChatClient()} authenticated onRuntimeResponse={callback}/>);
  await screen.findByLabelText('Model');
  fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'local-model' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save model' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('not_available');
  expect(screen.getByLabelText('Model')).toHaveValue('local-model');
  expect(callback).not.toHaveBeenCalled();
  saveFails = false;
  fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
  expect(await screen.findByText('Test failed: No bounded reply')).toBeInTheDocument();
  expect(screen.getByLabelText('Model')).toHaveValue('local-model');
  expect(callback).toHaveBeenCalledTimes(1);
  outcome = json({ ok: true, message: 'Bounded reply received', runtime: snapshot({ status: 'ready', policyVerified: true }) });
  fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
  expect(await screen.findByText('Test passed: Bounded reply received')).toBeInTheDocument();
  expect(callback).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/runtime/test')).map(([, init]) => JSON.parse(String(init?.body)))).toEqual([{}, {}]);
});

it('does not fetch without authentication or apply a late response after unmount', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  const view = render(<RuntimeSettings client={new ChatClient()} authenticated={false} onRuntimeResponse={vi.fn()}/>);
  expect(screen.getByRole('alert')).toHaveTextContent('Authentication required');
  expect(fetcher).not.toHaveBeenCalled();
  view.unmount();
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>(resolve => { finish = resolve; });
  fetcher.mockImplementation(() => pending);
  const callback = vi.fn(); const second = render(<RuntimeSettings client={new ChatClient()} authenticated onRuntimeResponse={callback}/>);
  second.unmount();
  await act(async () => finish(json(snapshot())));
  expect(callback).not.toHaveBeenCalled();
});

it('aborts an in-flight test on unmount without reporting success or refreshing availability', async () => {
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>(resolve => { finish = resolve; });
  const fetcher = vi.fn(async (url: string) => url.endsWith('/runtime/test') ? pending : json(snapshot()));
  vi.stubGlobal('fetch', fetcher);
  const callback = vi.fn(); const view = render(<RuntimeSettings client={new ChatClient()} authenticated onRuntimeResponse={callback}/>);
  await screen.findByLabelText('Model');
  fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
  expect(screen.getByRole('button', { name: 'Test connection' })).toBeDisabled();
  view.unmount();
  await act(async () => finish(json({ ok: true, message: 'Reply received', runtime: snapshot({ status: 'ready' }) })));
  expect(callback).not.toHaveBeenCalled();
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/runtime/test'))).toHaveLength(1);
});
