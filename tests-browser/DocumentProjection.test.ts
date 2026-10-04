import { expect, it } from 'vitest';
import { appendFeatures, emptyFeatureSource } from '../src/modeling/source';
import { makeFeatureRevision } from '../src/modeling/revisions';
import { projectDocumentTree, validSelection } from '../src/modeling/documentProjection';
import type { PartDocument } from '../src/workspace';
import { DEFAULT_PARAMETERS, makeRevision } from '../src/domain';

const id = '11111111-1111-4111-8111-111111111111';
const saved = '22222222-2222-4222-8222-222222222222';

const feature = (name: string) => appendFeatures(emptyFeatureSource(), [
  {kind:'rectangle',id:name,name:'Outline',plane:'XY',width:80,height:50},
  {kind:'extrude',id:'plate',name:'Plate',profileId:name,distance:6},
]);
const revision = makeFeatureRevision(null,feature('outline'),'2026-01-01T00:00:00Z');
const document = (): PartDocument => ({id,name:'Alpha',revisionIds:{[saved]:revision.id},part:{kind:'feature-part',id,name:'Alpha',acceptedRevisionId:revision.id,currentRevisionId:revision.id,revisions:[revision]}});

it('projects committed source IDs and truthful collections without mesh topology', () => {
  const tree=projectDocumentTree(document());
  expect(tree.mode).toBe('committed');
  expect(tree.nodes.map(n=>n.id)).toEqual(['document']);
  expect(tree.nodes[0].children?.map(n=>n.id)).toEqual(['origin','features','bodies']);
  expect(tree.nodes[0].children?.[1].children?.map(n=>n.id)).toEqual(['feature:outline','feature:plate']);
  expect(tree.nodes[0].children?.[1].label).toBe('Features (2)');
  expect(tree.nodes[0].children?.[2].label).toBe('Solid Bodies (1)');
  expect(tree.revisionId).toBe(saved);
  expect(validSelection(tree,{documentId:id,revisionId:saved,nodeId:'feature:outline',label:'Outline · rectangle',representation:'feature'})).toBe(true);
  expect(validSelection(tree,{documentId:id,revisionId:null,nodeId:'feature:outline',label:'Outline',representation:'feature'})).toBe(false);
});

it('separates proposed feature counts from committed, and binds history to its source', () => {
  const doc=document();
  const proposed=appendFeatures(feature('outline'),[{kind:'hole',id:'mount',name:'Mount',bodyId:'plate',x:15,y:15,diameter:5,extent:'through'}]);
  const preview=projectDocumentTree(doc,undefined,{kind:'features',documentId:id,baseRevisionId:saved,id:'candidate',authored:proposed});
  expect(preview.mode).toBe('preview');
  expect(preview.nodes[0].children?.[1].label).toBe('Features (3)');
  expect(projectDocumentTree(doc).nodes[0].children?.[1].label).toBe('Features (2)');
  expect(validSelection(preview,{documentId:id,revisionId:saved,nodeId:'feature:outline',label:'Outline',representation:'feature'})).toBe(false);
  expect(projectDocumentTree(doc,saved,{kind:'features',documentId:id,baseRevisionId:saved,id:'candidate',authored:proposed}).mode).toBe('historical');
});

it('projects imported saved, candidate and historical parameter values without invented feature history', () => {
  const first=makeRevision(null,{...DEFAULT_PARAMETERS},'2026-01-01T00:00:00Z');
  const second=makeRevision(first.id,{...DEFAULT_PARAMETERS,leg_length_mm:90},'2026-01-02T00:00:00Z');
  const doc:PartDocument={id,name:'Bracket',revisionIds:{[saved]:first.id,latest:second.id},part:{id,name:'Bracket',acceptedRevisionId:second.id,currentRevisionId:second.id,revisions:[first,second]}};
  const current=projectDocumentTree(doc);
  expect(current.nodes[0].children?.[1].label).toBe('Parameters (6)');
  expect(current.nodes[0].children?.[1].children?.[0].detail).toContain('90 mm');
  const candidate=projectDocumentTree(doc,undefined,{kind:'parameters',documentId:id,baseRevisionId:'latest',id:'candidate',parameters:{...second.parameters,leg_length_mm:110}});
  expect(candidate.mode).toBe('preview');
  expect(candidate.nodes[0].children?.[1].children?.[0].detail).toContain('110 mm');
  expect(candidate.nodes[0].children?.[1].label).toBe('Parameters (6)');
  expect(candidate.nodes[0].children?.map(n=>n.id)).toEqual(['origin','parameters','bodies']);
  expect(validSelection(candidate,{documentId:id,revisionId:null,nodeId:'parameter:leg_length_mm',label:'leg_length_mm',representation:'parameter'})).toBe(false);
  const history=projectDocumentTree(doc,saved);
  expect(history.mode).toBe('historical');
  expect(history.nodes[0].children?.[1].children?.[0].detail).toContain(`${first.parameters.leg_length_mm} mm`);
  expect(history.revisionId).toBe(saved);
  expect(projectDocumentTree(doc).nodes[0].children?.[1].children?.[0].detail).toContain('90 mm');
});
