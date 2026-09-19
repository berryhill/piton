import { DEFAULT_PARAMETERS, assertProjectIntegrity, assertPortableCustodyPacket, canonicalPortableCustodyJson, makeRevision, sha256Hex, validateLBracketParameters, type BrowserProject, type DesignRevision, type LBracketParameters, type PortableCustodyPacket } from "./domain";

export interface PartDocument { id: string; name: string; part: BrowserProject; revisionIds: Record<string, string>; legacyCustody?: PortableCustodyPacket; }
export interface WorkspaceProject { id: string; name: string; archived: boolean; updatedAt: string; documents: PartDocument[]; }
export interface WorkspaceState { projects: WorkspaceProject[]; imports: Record<string, string>; receipts: Record<string, { digest: string; revisionId: string }>; }
export interface WorkspaceStore { readWorkspace(): Promise<{version: number; json: string} | null>; writeWorkspace(version: number, json: string): Promise<void>; }
export interface PartProposal { projectId: string; documentId: string; expectedRevisionId: string; idempotencyKey: string; parameters: LBracketParameters; }
export type WorkspaceErrorCode = "invalid_resource" | "scope_mismatch" | "stale_revision" | "idempotency_conflict" | "preview_required";
export class WorkspaceError extends Error {
  constructor(readonly code: WorkspaceErrorCode, message: string) { super(message); this.name = "WorkspaceError"; }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function resourceId(id: string): void { if (typeof id !== "string" || !uuid.test(id)) throw new WorkspaceError("invalid_resource", "Malformed resource ID"); }
function name(value: string): string { if (typeof value !== "string" || !value.trim() || value.trim().length > 100) throw new Error("Name must contain 1–100 characters"); return value.trim(); }
export function resolvePart(state: WorkspaceState, projectId: string, documentId: string): {project: WorkspaceProject; document: PartDocument} {
  resourceId(projectId); resourceId(documentId);
  const project = state.projects.find(p => p.id === projectId);
  const document = project?.documents.find(d => d.id === documentId);
  if (!project || !document) throw new WorkspaceError("scope_mismatch", "Project/document not found in this browser, or scope mismatch. Recover by importing a saved custody file.");
  return {project, document};
}
export function parseProposal(input: unknown): PartProposal {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid proposal");
  const p = input as PartProposal;
  if (Object.keys(p).sort().join() !== ["projectId", "documentId", "expectedRevisionId", "idempotencyKey", "parameters"].sort().join()) throw new Error("Invalid proposal keys");
  for (const key of [p.projectId, p.documentId, p.expectedRevisionId, p.idempotencyKey]) resourceId(key);
  if (!p.parameters || Object.keys(p.parameters).sort().join() !== Object.keys(DEFAULT_PARAMETERS).sort().join()) throw new Error("Invalid parameter keys");
  const error = validateLBracketParameters(p.parameters); if (error) throw new Error(error);
  return structuredClone(p);
}
export function canonicalWorkspaceJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalWorkspaceJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalWorkspaceJson((value as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(value);
}
function keys(value: unknown, required: string[], optional: string[] = []): void {
  if (!value || typeof value !== "object" || Array.isArray(value) || required.some(k => !Object.hasOwn(value,k)) || Object.keys(value).some(k => !required.includes(k) && !optional.includes(k))) throw new Error("Invalid workspace record keys");
}
export function assertWorkspaceState(value: unknown): asserts value is WorkspaceState {
  keys(value,["projects","imports","receipts"]);
  const s=value as WorkspaceState;
  if (!Array.isArray(s.projects)) throw new Error("Invalid workspace projects");
  const ids=new Set<string>(); const revisionIds=new Set<string>();
  const unique=(id:string) => { resourceId(id); if(ids.has(id)) throw new Error("Duplicate resource ID"); ids.add(id); };
  for(const p of s.projects) {
    keys(p,["id","name","archived","updatedAt","documents"]); unique(p.id);
    if(name(p.name)!==p.name || typeof p.archived!=="boolean" || typeof p.updatedAt!=="string" || !Number.isFinite(Date.parse(p.updatedAt)) || !Array.isArray(p.documents)) throw new Error("Invalid project metadata");
    for(const d of p.documents) {
      keys(d,["id","name","part","revisionIds"],["legacyCustody"]); unique(d.id);
      keys(d.part,["id","name","acceptedRevisionId","currentRevisionId","revisions"]);
      if(name(d.name)!==d.name || d.part.name!==d.name || typeof d.part.id!=="string" || !d.part.id || !Array.isArray(d.part.revisions)) throw new Error("Invalid document metadata");
      assertProjectIntegrity(d.part);
      if(!d.revisionIds || typeof d.revisionIds!=="object" || Array.isArray(d.revisionIds)) throw new Error("Invalid revision map");
      const mapped=new Set<string>();
      for(const [id, revision] of Object.entries(d.revisionIds)) { unique(id); revisionIds.add(id); if(typeof revision!=="string" || mapped.has(revision) || !d.part.revisions.some(r=>r.id===revision)) throw new Error("Invalid revision map"); mapped.add(revision); }
      if(mapped.size!==d.part.revisions.length) throw new Error("Incomplete revision map");
      if(d.legacyCustody) { assertPortableCustodyPacket(d.legacyCustody); if(d.legacyCustody.project.id!==d.part.id || d.legacyCustody.revisions.some(r=>!d.part.revisions.some(existing=>canonicalWorkspaceJson(existing)===canonicalWorkspaceJson(r)))) throw new Error("Legacy custody mismatch"); }
    }
  }
  for(const field of [s.imports,s.receipts]) if(!field || typeof field!=="object" || Array.isArray(field)) throw new Error("Invalid workspace index");
  for(const [digest,id] of Object.entries(s.imports)) if(!/^sha256-[0-9a-f]{64}$/.test(digest) || !s.projects.some(p=>p.id===id)) throw new Error("Invalid import index");
  for(const [id,r] of Object.entries(s.receipts)) { resourceId(id); keys(r,["digest","revisionId"]); if(typeof r.digest!=="string" || !/^[0-9a-f]{64}$/.test(r.digest) || !revisionIds.has(r.revisionId)) throw new Error("Invalid receipt"); }
}
export function assertWorkspaceTransition(before: WorkspaceState, after: WorkspaceState): void {
  assertWorkspaceState(after);
  for(const p of before.projects) {
    const next=after.projects.find(n=>n.id===p.id); if(!next) throw new Error("Project removal forbidden");
    for(const d of p.documents) {
      const n=next.documents.find(n=>n.id===d.id);
      if(!n || n.part.id!==d.part.id || n.part.acceptedRevisionId!==d.part.acceptedRevisionId || canonicalWorkspaceJson(n.legacyCustody??null)!==canonicalWorkspaceJson(d.legacyCustody??null)) throw new Error("Immutable document custody");
      for(const r of d.part.revisions) if(!n.part.revisions.some(nr=>canonicalWorkspaceJson(nr)===canonicalWorkspaceJson(r))) throw new Error("Immutable revision history");
      for(const [id,r] of Object.entries(d.revisionIds)) if(n.revisionIds[id]!==r) throw new Error("Immutable revision identity");
    }
  }
  for(const field of ["imports","receipts"] as const) for(const [id,v] of Object.entries(before[field])) if(canonicalWorkspaceJson(after[field][id])!==canonicalWorkspaceJson(v)) throw new Error("Immutable workspace index");
}
export class WorkspaceApplication {
  #store: WorkspaceStore;
  #previews = new Map<string, DesignRevision>();
  #listeners = new Set<() => void>();
  /** Observes successful persisted mutations on this shared application instance. */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }
  constructor(store: WorkspaceStore) { this.#store = store; }
  private async load() { const row = await this.#store.readWorkspace(); const state: WorkspaceState = row ? JSON.parse(row.json) : {projects: [], imports: {}, receipts: {}}; assertWorkspaceState(state); if(row && (!Number.isSafeInteger(row.version) || row.version < 1)) throw new Error("Invalid workspace version"); return {version: row?.version ?? 0, state}; }
  async read() { return (await this.load()).state; }
  private async mutate<T>(fn: (state: WorkspaceState) => T): Promise<T> { const {version, state} = await this.load(); const before=structuredClone(state); const result = fn(state); assertWorkspaceTransition(before,state); await this.#store.writeWorkspace(version, JSON.stringify(state));
    // Observer failures must not turn a persisted command into an apparent failure.
    for (const listener of this.#listeners) { try { listener(); } catch { /* isolated observer */ } }
    return result; }
  async createProject(label: string) { return this.mutate(s => { const p: WorkspaceProject = {id: crypto.randomUUID(), name: name(label), archived: false, updatedAt: new Date().toISOString(), documents: []}; s.projects.push(p); return p.id; }); }
  async renameProject(id: string, label: string) { return this.mutate(s => { const p = this.project(s,id); p.name = name(label); p.updatedAt = new Date().toISOString(); }); }
  async archiveProject(id: string, archived: boolean) { return this.mutate(s => { if(typeof archived!=="boolean") throw new Error("Invalid archive state"); const p=this.project(s,id); p.archived = archived; p.updatedAt=new Date().toISOString(); }); }
  private project(s: WorkspaceState,id: string) { resourceId(id); const p = s.projects.find(p => p.id === id); if (!p) throw new Error("Project not found in this browser. Import a saved custody file to recover."); return p; }
  async createPart(projectId: string,label: string) { return this.mutate(s => { const p = this.project(s,projectId); if (p.archived) throw new Error("Archived project is read-only"); const id = crypto.randomUUID(); const revision = makeRevision(null, {...DEFAULT_PARAMETERS}, new Date().toISOString()); const d: PartDocument = {id, name:name(label), part:{id, name:name(label), acceptedRevisionId:revision.id,currentRevisionId:revision.id,revisions:[revision]},revisionIds:{[crypto.randomUUID()]:revision.id}}; p.documents.push(d); p.updatedAt = new Date().toISOString(); return id; }); }
  async renamePart(projectId: string,documentId: string,label: string) { return this.mutate(s => { const {project,document} = resolvePart(s,projectId,documentId); if(project.archived) throw new Error("Archived project is read-only"); document.name=name(label); document.part.name=document.name; project.updatedAt=new Date().toISOString(); }); }
  async propose(input: unknown): Promise<{proposal: PartProposal; candidate: DesignRevision}> {
    const proposal = parseProposal(input); const {project,document} = resolvePart(await this.read(),proposal.projectId,proposal.documentId);
    if(project.archived) throw new Error("Archived project is read-only");
    if(document.revisionIds[proposal.expectedRevisionId] !== document.part.currentRevisionId) throw new WorkspaceError("stale_revision", "Stale revision; reload and propose again");
    const digest=sha256Hex(canonicalWorkspaceJson(proposal));
    const candidate=this.#previews.get(digest)??makeRevision(document.part.currentRevisionId,proposal.parameters,new Date().toISOString());
    if (!this.#previews.has(digest) && this.#previews.size >= 128) this.#previews.delete(this.#previews.keys().next().value!);
    this.#previews.set(digest,candidate); return {proposal,candidate:structuredClone(candidate)};
  }
  async commit(input: unknown): Promise<string> {
    const proposal = parseProposal(input); const digest = sha256Hex(canonicalWorkspaceJson(proposal));
    return this.mutate(s => {
      const {project,document} = resolvePart(s,proposal.projectId,proposal.documentId);
      const previous = s.receipts[proposal.idempotencyKey]; if(previous) { if(previous.digest !== digest) throw new WorkspaceError("idempotency_conflict", "Idempotency conflict"); return previous.revisionId; }
      if(project.archived) throw new Error("Archived project is read-only");
      if(document.revisionIds[proposal.expectedRevisionId] !== document.part.currentRevisionId) throw new WorkspaceError("stale_revision", "Stale revision; reload and propose again");
      const revision = this.#previews.get(digest);
      if (!revision) throw new WorkspaceError("preview_required", "Proposal preview required in this session before commit");
      const id = crypto.randomUUID();
      document.part.revisions.push(revision); document.part.currentRevisionId=revision.id; document.revisionIds[id]=revision.id;
      project.updatedAt=new Date().toISOString(); s.receipts[proposal.idempotencyKey]={digest,revisionId:id}; return id;
    });
  }
  async exportProject(projectId: string) {
    const project=structuredClone(this.project(await this.read(),projectId));
    const packet={format:"piton-workspace-project/v1" as const,project};
    return {...packet,fingerprint:`sha256-${sha256Hex(canonicalWorkspaceJson(packet))}`};
  }
  async importProject(input: unknown): Promise<string> {
    keys(input,["format","project","fingerprint"]);
    const envelope=input as {format:string;project:WorkspaceProject;fingerprint:string};
    const {fingerprint,...packet}=envelope;
    if(packet.format!=="piton-workspace-project/v1" || fingerprint!==`sha256-${sha256Hex(canonicalWorkspaceJson(packet))}`) throw new Error("Project export fingerprint mismatch");
    const project=structuredClone(packet.project);
    assertWorkspaceState({projects:[project],imports:{},receipts:{}});
    return this.mutate(s=>{
      const existing=s.projects.find(p=>p.id===project.id);
      if(existing) { if(canonicalWorkspaceJson(existing)!==canonicalWorkspaceJson(project)) throw new Error("Project identity collision"); return existing.id; }
      s.projects.push(project); return project.id;
    });
  }
  async exportPart(projectId: string, documentId: string) {
    const {document} = resolvePart(await this.read(),projectId,documentId);
    const part = document.part;
    const packet: PortableCustodyPacket = {format:"piton-custody/v1",schema_version:4,project:{id:part.id,name:document.name,accepted_revision_id:part.acceptedRevisionId,current_revision_id:part.currentRevisionId},revisions:part.revisions,build_status:null,lifecycle_projection:document.legacyCustody?.lifecycle_projection??[],environment_digest:"browser-typescript/v1",exported_at:new Date().toISOString()};
    assertPortableCustodyPacket(packet);
    return {...packet,fingerprint:`sha256-${sha256Hex(canonicalPortableCustodyJson(packet))}`};
  }
  async importCustody(input: unknown) {
    const envelope = input as Record<string,unknown>; if (!envelope || typeof envelope !== "object") throw new Error("Invalid custody file");
    const {fingerprint,...packet}=envelope; assertPortableCustodyPacket(packet);
    const digest=`sha256-${sha256Hex(canonicalPortableCustodyJson(packet))}`;
    if(fingerprint !== digest) throw new Error("Custody fingerprint mismatch");
    const sourceDigest=`sha256-${sha256Hex(canonicalWorkspaceJson({...packet,exported_at:""}))}`;
    return this.mutate(s => { if(s.imports[sourceDigest] || s.imports[digest]) return s.imports[sourceDigest] || s.imports[digest];
      const existing=s.projects.find(p=>p.documents.some(d=>d.legacyCustody && canonicalWorkspaceJson({...d.legacyCustody,exported_at:""})===canonicalWorkspaceJson({...packet,exported_at:""})));
      if(existing) { s.imports[sourceDigest]=existing.id; return existing.id; }
      const id=crypto.randomUUID(), documentId=crypto.randomUUID();
      const part: BrowserProject={id:packet.project.id,name:packet.project.name,acceptedRevisionId:packet.project.accepted_revision_id,currentRevisionId:packet.project.current_revision_id,revisions:packet.revisions}; assertProjectIntegrity(part);
      s.projects.push({id,name:name(packet.project.name),archived:false,updatedAt:new Date().toISOString(),documents:[{id:documentId,name:part.name,part,legacyCustody:packet,revisionIds:Object.fromEntries(part.revisions.map(r=>[crypto.randomUUID(),r.id]))}]}); s.imports[sourceDigest]=id; return id;
    });
  }
}
export type WorkspaceRoute = {projectId?: string; documentId?: string; revisionId?: string};
export function parseWorkspaceRoute(path: string): WorkspaceRoute {
  if(path === "/projects") return {};
  const match = /^\/projects\/([^/]+)(?:\/documents\/([^/]+)(?:\/revisions\/([^/]+))?)?$/.exec(path);
  if(!match) throw new Error("Unknown workspace route");
  for(const id of match.slice(1)) if(id) resourceId(id);
  return {projectId:match[1],documentId:match[2],revisionId:match[3]};
}
