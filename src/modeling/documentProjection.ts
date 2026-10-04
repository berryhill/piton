import { isAuthoredPart, isFeaturePart, type PartDocument } from '../workspace';
import { readFeatures, type FeatureSource } from './source';
import type { LBracketParameters } from '../domain';
import type { SelectionReference } from '../chat/context';

export type DocumentTreeNode = { id:string; label:string; detail:string; representation:SelectionReference['representation']; children?:DocumentTreeNode[] };
export type DocumentProjection = { documentId:string; revisionId:string|null; sourceRevisionId:string|null; mode:'empty'|'committed'|'preview'|'historical'; nodes:DocumentTreeNode[] };
export type DocumentCandidate =
  | {kind:'features';documentId:string;baseRevisionId:string|null;id:string;authored:FeatureSource}
  | {kind:'parameters';documentId:string;baseRevisionId:string;id:string;parameters:Readonly<LBracketParameters>};

/** Read-only source projection; candidate identities never masquerade as saved revisions. */
export function projectDocumentTree(document:PartDocument, historicalId?:string, candidate?:DocumentCandidate):DocumentProjection {
  const sourceId=historicalId?document.revisionIds[historicalId]:document.part.currentRevisionId;
  if (historicalId&&!sourceId) throw new Error('stale_revision');
  const pointer=historicalId??Object.keys(document.revisionIds).find(id=>document.revisionIds[id]===sourceId)??null;
  const imported=isAuthoredPart(document.part);
  const ownedCandidate=!historicalId&&candidate?.documentId===document.id&&candidate.baseRevisionId===pointer&&
    (imported?candidate.kind==='parameters':candidate.kind==='features')?candidate:undefined;
  const mode=historicalId?'historical':ownedCandidate?'preview':sourceId?'committed':'empty';
  const reference=(id:string,label:string,detail:string,children?:DocumentTreeNode[]):DocumentTreeNode=>({id,label,detail,representation:'coordinate-reference',...(children?{children}:{})});
  const origin=reference('origin','Origin · reference','CAD origin (0, 0, 0) mm. Coordinate reference only; not an authored feature.',[
    reference('front','Front Plane · reference','CAD XZ plane (Y=0). Coordinate reference only; not an authored feature.'),
    reference('top','Top Plane · reference','CAD XY plane (Z=0), the physical grid plane. Coordinate reference only; not an authored feature.'),
    reference('right','Right Plane · reference','CAD YZ plane (X=0). Coordinate reference only; not an authored feature.'),
  ]);
  const revision=sourceId&&isFeaturePart(document.part)?document.part.revisions.find(r=>r.id===sourceId):undefined;
  const source=mode==='preview'&&ownedCandidate?.kind==='features'?ownedCandidate.authored:revision?.authored;
  const features=source?readFeatures(source):[];
  const named=features.map(f=>({id:`feature:${f.id}`,label:`${f.name} · ${f.kind}`,detail:`${f.kind} · named source feature ${f.id}. Review geometry only; no durable face or edge topology.`,representation:'feature' as const}));
  const bodies=features.some(f=>f.kind==='extrude'||f.kind==='revolve')?1:0;
  const parameters=isAuthoredPart(document.part)?(mode==='preview'&&ownedCandidate?.kind==='parameters'?ownedCandidate.parameters:document.part.revisions.find(r=>r.id===sourceId)?.parameters):undefined;
  const root:DocumentTreeNode={id:'document',label:`${document.name} · Part`,detail:mode==='empty'?'Empty Part document. No authored geometry, parameters or revisions.':`${mode==='preview'?'Uncommitted preview':mode==='historical'?'Historical revision':'Committed revision'} · ${imported?'Imported parameter-authority Part':'Named feature Part'}.`,representation:'document-summary',children:[
    origin,
    imported?{id:'parameters',label:`Parameters (${Object.keys(parameters??{}).length})`,detail:'Imported parameter authority; no named Sketch/Extrude history.',representation:'collection',children:Object.entries(parameters??{}).map(([key,value])=>({id:`parameter:${key}`,label:key,detail:`${key} · ${value} mm · ${mode==='preview'?'uncommitted candidate':'saved parameter'}`,representation:'parameter'}))}:
      {id:'features',label:`Features (${features.length})`,detail:features.length?'Named features parsed from the displayed source.':'No authored features yet. Use sketch and feature controls or Advanced source to preview.',representation:'collection',...(named.length?{children:named}:{})},
    {id:'bodies',label:`Solid Bodies (${imported&&sourceId?1:bodies})`,detail:imported?'Imported bracket review body, not named-feature history.':bodies?'One review body; not exact geometry.':'No solid bodies. This Part has no authored solid review mesh.',representation:'collection'},
  ]};
  return {documentId:document.id,revisionId:mode==='preview'?null:pointer,sourceRevisionId:mode==='preview'?ownedCandidate!.id:sourceId??null,mode,nodes:[root]};
}

export function findTreeNode(nodes:DocumentTreeNode[],id:string):DocumentTreeNode|undefined {
  for(const node of nodes){if(node.id===id)return node;const nested=findTreeNode(node.children??[],id);if(nested)return nested;}
}
export function validSelection(tree:DocumentProjection, ref:SelectionReference):boolean {
  const node=findTreeNode(tree.nodes,ref.nodeId);
  return ref.documentId===tree.documentId && !!node && node.representation===ref.representation && (node.representation==='coordinate-reference'||node.representation==='document-summary'||node.label===ref.label) &&
    (node.representation==='coordinate-reference'||node.representation==='document-summary' ? (ref.revisionId===null||ref.revisionId===tree.revisionId) : tree.mode!=='preview'&&ref.revisionId===tree.revisionId);
}
