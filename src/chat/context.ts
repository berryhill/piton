import { isAuthoredPart, type WorkspaceProject } from '../workspace';
import { projectDocumentTree, validSelection } from '../modeling/documentProjection';

export type SelectionReference = {
  documentId: string; revisionId: string | null; nodeId: string; label: string;
  sourceRevisionId?: string | null;
  representation: 'coordinate-reference' | 'document-summary' | 'collection' | 'feature' | 'parameter';
};
export type FrozenContext = {
  schema: 'piton-chat-context/v1'; projectId: string; projectName: string;
  activeDocument: { documentId: string; name: string; revisionId: string | null; sourceRevisionId: string | null; historical: boolean; draft: boolean; preview: boolean } | null;
  selection: SelectionReference[]; attachments: SelectionReference[];
  coordinateFrame: 'CAD XYZ; Z-up; mm'; buildId: null; artifactId: null;
  documentCount: number; documents: {documentId:string;name:string;authored:boolean;revisionCount:number}[]; documentsTruncated:boolean;
  savedParameters: Record<string,number> | null; constraints: { material: null; tolerance: null; load: null; manufacturing: null };
};
/** Snapshot only observed state. In particular a UI reference plane is not exact topology. */
export function freezeContext(project: WorkspaceProject, documentId?: string, revisionId?: string, selection: SelectionReference[] = [], attachments: SelectionReference[] = [], draft = false, preview = false): FrozenContext {
  if (selection.length > 16 || attachments.length > 16) throw new Error('context_too_large');
  const document = documentId ? project.documents.find(d => d.id === documentId) : undefined;
  if (documentId && !document) throw new Error('scope_mismatch');
  const sourceRevisionId = document ? (revisionId ? document.revisionIds[revisionId] : document.part.currentRevisionId) : null;
  if (revisionId && !sourceRevisionId) throw new Error('stale_revision');
  const resourceRevision = revisionId ?? (document && Object.keys(document.revisionIds).find(id => document.revisionIds[id] === sourceRevisionId)) ?? null;
  for (const ref of [...selection, ...attachments]) {
    const owner = project.documents.find(d => d.id === ref.documentId);
    if (!owner) throw new Error('scope_mismatch');
    if (ref.revisionId && !owner.revisionIds[ref.revisionId]) throw new Error('stale_revision');
    if (!ref.revisionId && !['coordinate-reference','document-summary'].includes(ref.representation) && owner.part.currentRevisionId) throw new Error('stale_revision');
    // Saved semantic nodes are source/revision-bound; a triangle/face index is never
    // a durable reference. Detached attachments retain their own document revision.
    const tree = projectDocumentTree(owner, ref.revisionId ?? undefined);
    if (!validSelection(tree, ref)) throw new Error('unsupported_reference');
    if (selection.includes(ref) && ref.documentId !== documentId) throw new Error('scope_mismatch');
    if (selection.includes(ref) && ref.revisionId && ref.representation !== 'coordinate-reference' && ref.representation !== 'document-summary' && ref.revisionId !== resourceRevision) throw new Error('stale_revision');
    if (ref.sourceRevisionId !== undefined && ref.sourceRevisionId !== tree.sourceRevisionId) throw new Error('unsupported_reference');
  }
  const result: FrozenContext = {
    schema: 'piton-chat-context/v1', projectId: project.id, projectName: project.name,
    activeDocument: document ? { documentId: document.id, name: document.name, revisionId: resourceRevision, sourceRevisionId: sourceRevisionId ?? null, historical: !!revisionId, draft, preview } : null,
    selection, attachments, coordinateFrame: 'CAD XYZ; Z-up; mm', buildId: null, artifactId: null,
    documentCount: project.documents.length,
    documents: project.documents.slice(0,32).map(d => ({documentId:d.id,name:d.name,authored:d.part.currentRevisionId !== null,revisionCount:d.part.revisions.length})), documentsTruncated: project.documents.length > 32,
    savedParameters: document && isAuthoredPart(document.part) ? {...document.part.revisions.find(r => r.id === sourceRevisionId)!.parameters} : null,
    constraints: { material: null, tolerance: null, load: null, manufacturing: null },
  };
  if (selection.length > 16 || attachments.length > 16 || JSON.stringify(result).length > 16000) throw new Error('context_too_large');
  const copy = structuredClone(result);
  function freeze(value: object) { Object.freeze(value); for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child); }
  freeze(copy); return copy;
}
