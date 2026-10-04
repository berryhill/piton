import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ConversationPanel } from '../src/chat/ConversationPanel';
import { freezeContext, type SelectionReference } from '../src/chat/context';
import { DEFAULT_PARAMETERS, makeRevision } from '../src/domain';
import type { WorkspaceProject } from '../src/workspace';
import { appendFeatures, emptyFeatureSource } from '../src/modeling/source';
import { makeFeatureRevision } from '../src/modeling/revisions';

const id='11111111-1111-4111-8111-111111111111', docId='22222222-2222-4222-8222-222222222222', old='33333333-3333-4333-8333-333333333333', current='44444444-4444-4444-8444-444444444444';
const imported=():WorkspaceProject=>{
  const first=makeRevision(null,{...DEFAULT_PARAMETERS},'2026-01-01T00:00:00Z');
  const second=makeRevision(first.id,{...DEFAULT_PARAMETERS,leg_length_mm:90},'2026-01-02T00:00:00Z');
  return {id,name:'Project',archived:false,updatedAt:'2026-01-02',documents:[{id:docId,name:'Bracket',revisionIds:{[old]:first.id,[current]:second.id},part:{id:docId,name:'Bracket',acceptedRevisionId:second.id,currentRevisionId:second.id,revisions:[first,second]}}]};
};
const parameter=(pointer:string):SelectionReference=>({documentId:docId,revisionId:pointer,nodeId:'parameter:leg_length_mm',label:'leg_length_mm',representation:'parameter'});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
it('freezes only source-owned semantic references, rejecting forged kinds, labels and revision pointers',()=>{
  const p=imported(),ref=parameter(old);
  expect(freezeContext(p,docId,old,[ref]).selection).toEqual([ref]);
  expect(freezeContext(p,docId,undefined,[],[ref]).attachments).toEqual([ref]);
  expect(()=>freezeContext(p,docId,undefined,[ref])).toThrow('stale_revision');
  expect(()=>freezeContext(p,docId,undefined,[{...ref,revisionId:current,representation:'feature'}])).toThrow('unsupported_reference');
  expect(()=>freezeContext(p,docId,undefined,[{...ref,revisionId:current,nodeId:'feature:extrude'}])).toThrow('unsupported_reference');
  expect(()=>freezeContext(p,docId,undefined,[{...ref,revisionId:current,label:'Forged'}])).toThrow('unsupported_reference');
  expect(()=>freezeContext(p,docId,undefined,[{...ref,revisionId:'candidate'}])).toThrow('stale_revision');
  expect(()=>freezeContext(p,docId,undefined,[{...ref,revisionId:current,nodeId:'mesh-triangle-0'}])).toThrow('unsupported_reference');
});
it('keeps detached attachments immutable when the active selection changes',()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response('{"error":"unavailable"}',{status:503,headers:{'Content-Type':'application/json'}})));
  const p=imported(),ref=parameter(current);
  const view=render(<ConversationPanel project={p} documentId={docId} selection={[ref]} selectionDetail="leg_length_mm · 90 mm" projectionMode="committed"/>);
  expect(screen.getAllByText('Selected context')).toHaveLength(1);
  expect(screen.getByRole('region',{name:'Model selection details'})).toHaveTextContent('90 mm');
  fireEvent.click(screen.getByRole('button',{name:'Attach selected reference'}));
  view.rerender(<ConversationPanel project={p} documentId={docId} selection={[]} selectionDetail="leg_length_mm · 95 mm" projectionMode="preview" unavailableReason="Uncommitted parameter reference unavailable until commit."/>);
  expect(screen.getByRole('list',{name:'Attached context'})).toHaveTextContent('leg_length_mm');
  expect(screen.getByRole('button',{name:'Attach selected reference'})).toBeDisabled();
  expect(screen.getByRole('region',{name:'Model selection details'})).toHaveTextContent('Uncommitted parameter reference unavailable until commit.');
  expect(freezeContext(p,docId,undefined,[],[ref]).attachments).toEqual([ref]);
});
it('rejects a saved feature from another document even with matching revision and feature ID',()=>{
  const p=imported(),source=appendFeatures(emptyFeatureSource(),[{kind:'rectangle',id:'outline',name:'Outline',plane:'XY',width:40,height:20},{kind:'extrude',id:'plate',name:'Plate',profileId:'outline',distance:6}]);
  const revision=makeFeatureRevision(null,source,'2026-01-01T00:00:00Z');
  p.documents.push({id:'55555555-5555-4555-8555-555555555555',name:'Feature',revisionIds:{[current]:revision.id},part:{kind:'feature-part',id:'55555555-5555-4555-8555-555555555555',name:'Feature',acceptedRevisionId:revision.id,currentRevisionId:revision.id,revisions:[revision]}});
  const ref:SelectionReference={documentId:docId,revisionId:current,nodeId:'feature:outline',representation:'feature',label:'Outline · rectangle'};
  expect(()=>freezeContext(p,docId,undefined,[ref])).toThrow('unsupported_reference');
});
