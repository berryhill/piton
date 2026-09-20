import { expect, it } from "vitest";

async function sqliteWorkspace() {
  const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
  const { SqliteOpfsProjectRepository } = await import("../src/storage/repository");
  const db = new DatabaseSync(":memory:");
  const repo = new SqliteOpfsProjectRepository();
  Object.assign(repo, {
    dbId: "test",
    promiser: async (request: { args: { sql: string; bind?: (string | number | null)[] } }) => {
      const { sql, bind = [] } = request.args;
      const stmt = db.prepare(sql);
      return { result: { resultRows: stmt.columns().length ? stmt.all(...bind) : (stmt.run(...bind), []) } };
    },
  });
  await repo.migrateWorkspace();
  const { store } = await setup();
  await repo.writeWorkspace(0, store.row!.json);
  const row = (await repo.readWorkspace())!;
  const next = JSON.parse(row.json);
  next.projects[0].name = "Concurrent rename";
  return { db, repo, row, nextJson: JSON.stringify(next) };
}

it("serializes complete SQLite workspace read/read transactions", async () => {
  const { db, repo, row } = await sqliteWorkspace();
  try {
    expect(await Promise.all([repo.readWorkspace(), repo.readWorkspace(), repo.readWorkspace()])).toEqual([row, row, row]);
  } finally { db.close(); }
});

it("serializes SQLite workspace read/write in both admission orders", async () => {
  const { db, repo, row, nextJson } = await sqliteWorkspace();
  try {
    const [before] = await Promise.all([repo.readWorkspace(), repo.writeWorkspace(row.version, nextJson)]);
    expect(before).toEqual(row);
    const [after] = await Promise.all([repo.readWorkspace(), repo.writeWorkspace(row.version + 1, row.json)]);
    expect(after).toEqual({ version: row.version + 1, json: nextJson });
    const [, final] = await Promise.all([repo.writeWorkspace(row.version + 2, nextJson), repo.readWorkspace()]);
    expect(final).toEqual({ version: row.version + 3, json: nextJson });
  } finally { db.close(); }
});

it("serializes SQLite workspace write/write while retaining CAS and recovering after stale rejection", async () => {
  const { db, repo, row, nextJson } = await sqliteWorkspace();
  try {
    const results = await Promise.allSettled([
      repo.writeWorkspace(row.version, nextJson),
      repo.writeWorkspace(row.version, row.json),
      repo.readWorkspace(),
      repo.writeWorkspace(row.version + 1, row.json),
    ]);
    expect(results[0].status).toBe("fulfilled");
    expect(results[1]).toMatchObject({ status: "rejected", reason: expect.objectContaining({ message: "stale workspace; reload and retry" }) });
    expect(results[2]).toEqual({ status: "fulfilled", value: { version: row.version + 1, json: nextJson } });
    expect(results[3].status).toBe("fulfilled");
    expect(await repo.readWorkspace()).toEqual({ version: row.version + 2, json: row.json });
  } finally { db.close(); }
});

it("queues SQLite workspace migration with reads and writes without nested deadlocks", async () => {
  const { db, repo, row, nextJson } = await sqliteWorkspace();
  try {
    const [, before, , , after] = await Promise.all([
      repo.migrateWorkspace(), repo.readWorkspace(), repo.writeWorkspace(row.version, nextJson),
      repo.migrateWorkspace(), repo.readWorkspace(),
    ]);
    expect(before).toEqual(row);
    expect(after).toEqual({ version: row.version + 1, json: nextJson });
  } finally { db.close(); }
});

it("rolls back partial SQLite workspace writes before running queued operations", async () => {
  const { db, repo, row, nextJson } = await sqliteWorkspace();
  try {
    db.exec(`CREATE TRIGGER reject_workspace_rename BEFORE UPDATE ON workspace_documents
      WHEN (SELECT name FROM workspace_projects WHERE id=NEW.project_id)='Concurrent rename'
      BEGIN SELECT RAISE(ABORT, 'injected write failure'); END`);
    const results = await Promise.allSettled([
      repo.writeWorkspace(row.version, nextJson), repo.readWorkspace(), repo.writeWorkspace(row.version, row.json),
    ]);
    expect(results[0]).toMatchObject({ status: "rejected", reason: expect.objectContaining({ message: "injected write failure" }) });
    expect(results[1]).toEqual({ status: "fulfilled", value: row });
    expect(results[2].status).toBe("fulfilled");
    expect(await repo.readWorkspace()).toEqual({ version: row.version + 1, json: row.json });
  } finally { db.close(); }
});

it("binds preview identity to commit and canonicalizes reordered proposals",async()=>{
 const {app,proposal,projectId,documentId}=await setup();const preview=await app.propose(proposal);
 await new Promise(r=>setTimeout(r,5)); const reordered=Object.fromEntries(Object.entries(proposal).reverse());
 const id=await app.commit(reordered);expect(await app.commit({...proposal,parameters:Object.fromEntries(Object.entries(proposal.parameters).reverse())})).toBe(id);
 expect(resolvePart(await app.read(),projectId,documentId).document.part.revisions.at(-1)).toEqual(preview.candidate);
});
it("rejects coercible IDs and corrupt registry metadata/maps",async()=>{
 const {app,store,proposal}=await setup();await expect(app.commit({...proposal,expectedRevisionId:[proposal.expectedRevisionId]})).rejects.toThrow("Malformed");
 const original=JSON.parse(store.row!.json);
 for(const corrupt of [(s:any)=>s.projects.push(s.projects[0]),(s:any)=>s.projects[0].archived="false",(s:any)=>s.projects[0].documents[0].revisionIds={},(s:any)=>s.receipts[crypto.randomUUID()]={digest:"a".repeat(64),revisionId:crypto.randomUUID()}]) {
  const s=structuredClone(original);corrupt(s);store.row!.json=JSON.stringify(s);await expect(app.read()).rejects.toThrow();
 }
});
it("project exports preserve URL IDs and reject collisions atomically",async()=>{
 const {app,projectId,documentId,proposal}=await setup();await app.commit(proposal);const packet=await app.exportProject(projectId);
 const other=new WorkspaceApplication(new Store());expect(await other.importProject(packet)).toBe(projectId);expect(await other.importProject(packet)).toBe(projectId);
 expect(resolvePart(await other.read(),projectId,documentId).document).toEqual(packet.project.documents[0]);
 await other.renameProject(projectId,"Changed");const before=await other.read();await expect(other.importProject(packet)).rejects.toThrow("collision");expect(await other.read()).toEqual(before);
});
it("deduplicates legacy reexports across export timestamps",async()=>{
 const legacy=new CadApplication(new MemoryProjectRepository());await legacy.open();const first=await legacy.exportPortableCustody();await new Promise(r=>setTimeout(r,5));const second=await legacy.exportPortableCustody();
 const app=new WorkspaceApplication(new Store());expect(await app.importCustody(first)).toBe(await app.importCustody(second));expect((await app.read()).projects).toHaveLength(1);
});
it("normalizes SQLite custody, migrates legacy singleton, enforces CAS and immutable history",async()=>{
 const {DatabaseSync}=process.getBuiltinModule("node:sqlite");const {SqliteOpfsProjectRepository}=await import("../src/storage/repository");const db=new DatabaseSync(":memory:");
 const repo=new SqliteOpfsProjectRepository();Object.assign(repo,{dbId:"test",promiser:async(request:any)=>{const {sql,bind=[]}=request.args;const stmt=db.prepare(sql);return {result:{resultRows:stmt.columns().length?stmt.all(...bind):(stmt.run(...bind),[])}};}});
 const {store}=await setup();db.exec("CREATE TABLE workspace_registry(id INTEGER PRIMARY KEY, version INTEGER, json TEXT)");db.prepare("INSERT INTO workspace_registry VALUES(1,?,?)").run(store.row!.version,store.row!.json);
 await repo.migrateWorkspace();expect(JSON.parse((await repo.readWorkspace())!.json)).toEqual(JSON.parse(store.row!.json));expect((await repo.readWorkspace())!.version).toBe(store.row!.version);expect(db.prepare("SELECT name FROM sqlite_schema WHERE name='workspace_registry'").all()).toHaveLength(0);
 const app=new WorkspaceApplication(repo);const before=await repo.readWorkspace();const state=await app.read();const p=state.projects[0],d=p.documents[0];
 const change={projectId:p.id,documentId:d.id,expectedRevisionId:Object.keys(d.revisionIds)[0],idempotencyKey:crypto.randomUUID(),parameters:{...DEFAULT_PARAMETERS,leg_length_mm:120}};
 await app.propose(change); await app.commit(change);
 await expect(repo.writeWorkspace(before!.version,before!.json)).rejects.toThrow("stale");
 const current=await repo.readWorkspace();const bad=JSON.parse(current!.json);bad.projects[0].documents[0].part.revisions.reverse();bad.projects[0].documents[0].part.acceptedRevisionId=bad.projects[0].documents[0].part.currentRevisionId;
 await expect(repo.writeWorkspace(current!.version,JSON.stringify(bad))).rejects.toThrow();expect(await repo.readWorkspace()).toEqual(current);
 expect(db.prepare("SELECT * FROM workspace_revisions").all()).toHaveLength(2);await repo.migrateWorkspace();expect(await repo.readWorkspace()).toEqual(current);db.close();
});

import { WorkspaceApplication, assertWorkspaceState, assertWorkspaceTransition, parseWorkspaceRoute, resolvePart, type WorkspaceStore, type PartProposal } from "../src/workspace";
import { DEFAULT_PARAMETERS } from "../src/domain";
import { CadApplication } from "../src/application";
import { MemoryProjectRepository } from "../src/storage/repository";
class Store implements WorkspaceStore {
  row: {version:number;json:string}|null=null;
  async readWorkspace(){return structuredClone(this.row);}
  async writeWorkspace(version:number,json:string){if(version!==(this.row?.version??0))throw new Error("stale workspace");this.row={version:version+1,json};}
}
async function setup(){const store=new Store();const app=new WorkspaceApplication(store);const legacy=new CadApplication(new MemoryProjectRepository());await legacy.open();const projectId=await app.importCustody(await legacy.exportPortableCustody());const documentId=(await app.read()).projects[0].documents[0].id;const state=await app.read();const d=resolvePart(state,projectId,documentId).document;const proposal:PartProposal={projectId,documentId,expectedRevisionId:Object.keys(d.revisionIds)[0],idempotencyKey:crypto.randomUUID(),parameters:{...DEFAULT_PARAMETERS,leg_length_mm:100}};await app.propose(proposal);return {store,app,projectId,documentId,proposal};}

it("creates genuinely empty Parts, reopens and backs up mixed projects without changing imported custody", async () => {
 const {app,store,projectId,documentId}=await setup();
 const original=resolvePart(await app.read(),projectId,documentId).document;
 const emptyId=await app.createPart(projectId,"Empty Part");
 const reopened=new WorkspaceApplication(store);
 const empty=resolvePart(await reopened.read(),projectId,emptyId).document;
 expect(empty).toEqual({id:emptyId,name:"Empty Part",part:{id:emptyId,name:"Empty Part",acceptedRevisionId:null,currentRevisionId:null,revisions:[]},revisionIds:{}});
 const proposal={projectId,documentId:emptyId,expectedRevisionId:crypto.randomUUID(),idempotencyKey:crypto.randomUUID(),parameters:DEFAULT_PARAMETERS};
 await expect(app.propose(proposal)).rejects.toThrow("empty Part");
 await expect(app.commit(proposal)).rejects.toThrow("empty Part");
 await expect(app.exportPart(projectId,emptyId)).rejects.toThrow("empty Part");
 const packet=await app.exportProject(projectId); const other=new WorkspaceApplication(new Store());
 await other.importProject(packet);expect(await other.exportProject(projectId)).toEqual(packet);
 expect(resolvePart(await other.read(),projectId,documentId).document).toEqual(original);
 for(const mutate of [(d:any)=>d.part.currentRevisionId="bad",(d:any)=>d.part.acceptedRevisionId="bad",(d:any)=>d.legacyCustody=original.legacyCustody,(d:any)=>d.revisionIds[crypto.randomUUID()]="bad"]) {
  const s=await app.read();mutate(resolvePart(s,projectId,emptyId).document);expect(()=>assertWorkspaceState(s)).toThrow();
 }
 const before=await app.read(), after=structuredClone(before);const d=resolvePart(after,projectId,documentId).document;
 d.part={...d.part,acceptedRevisionId:null,currentRevisionId:null,revisions:[]};d.revisionIds={};delete d.legacyCustody;
 expect(()=>assertWorkspaceTransition(before,after)).toThrow();
});

it("requires the same proposal preview after restart before authoring", async () => {
 const {store,proposal}=await setup(); const reopened=new WorkspaceApplication(store);
 await expect(reopened.commit(proposal)).rejects.toThrow("preview required");
 const preview=await reopened.propose(proposal); await reopened.commit(proposal);
 expect((await reopened.read()).projects[0].documents[0].part.currentRevisionId).toBe(preview.candidate.id);
});
it("creates empty registry; persists stable project, Part and revision identities across renames and reopen",async()=>{
 const {app,store,projectId,documentId}=await setup();const second=await app.createProject("Other");await app.createPart(second,"Other bracket");await app.renameProject(projectId,"Renamed");await app.renamePart(projectId,documentId,"New Part name");const s=await new WorkspaceApplication(store).read();expect(s.projects).toHaveLength(2);expect(resolvePart(s,projectId,documentId).document.name).toBe("New Part name");expect(()=>resolvePart(s,second,documentId)).toThrow("scope mismatch");
});
it("previews without authoring, explicitly commits all parameters, rejects stale changes, replays identical keys",async()=>{
 const {app,proposal,projectId,documentId}=await setup();const original=await app.read();proposal.parameters={leg_length_mm:110,leg_width_mm:55,base_length_mm:140,base_thickness_mm:9,leg_thickness_mm:10,hole_diameter_mm:7};const preview=await app.propose(proposal);expect(await app.read()).toEqual(original);expect(preview.candidate.parameters).toEqual(proposal.parameters);const id=await app.commit(proposal);expect(await app.commit(proposal)).toBe(id);await expect(app.commit({...proposal,idempotencyKey:crypto.randomUUID()})).rejects.toThrow("Stale");await expect(app.commit({...proposal,parameters:{...proposal.parameters,leg_length_mm:120}})).rejects.toThrow("Idempotency");const d=resolvePart(await app.read(),projectId,documentId).document;expect(d.part.revisions).toHaveLength(2);expect(d.part.revisions[0]).toEqual(original.projects[0].documents[0].part.revisions[0]);expect(d.part.revisions[1]).toMatchObject({fabricationRelease:false,machineActuation:false,reviewState:"needs_human_review"});
});
it("rejects invalid quantities, safety injection and archived writes without replacing accepted state",async()=>{
 const {app,proposal,projectId}=await setup();const before=await app.read();await expect(app.propose({...proposal,parameters:{...proposal.parameters,hole_diameter_mm:99}})).rejects.toThrow();await expect(app.commit({...proposal,fabricationRelease:true})).rejects.toThrow();expect(await app.read()).toEqual(before);await app.archiveProject(projectId,true);await expect(app.commit(proposal)).rejects.toThrow("read-only");await app.archiveProject(projectId,false);await app.commit(proposal);
});
it("preserves legacy history and custody while safely importing the identical packet repeatedly",async()=>{
 const legacy=new CadApplication(new MemoryProjectRepository());await legacy.open();await legacy.commitCandidate((await legacy.loadProject()).currentRevisionId,{type:"set-leg-length",value:120});const packet=await legacy.exportPortableCustody();const app=new WorkspaceApplication(new Store());const id=await app.importCustody(packet);expect(await app.importCustody(packet)).toBe(id);const s=await app.read();expect(s.projects).toHaveLength(1);expect(s.projects[0].documents[0].part.revisions).toEqual(packet.revisions);expect(s.projects[0].documents[0].legacyCustody?.lifecycle_projection).toEqual(packet.lifecycle_projection);
});
it("exports valid Part custody that reimports into an isolated registry",async()=>{const {app,projectId,documentId}=await setup();const packet=await app.exportPart(projectId,documentId);const other=new WorkspaceApplication(new Store());await other.importCustody(packet);expect((await other.read()).projects[0].documents[0].part.revisions).toEqual(packet.revisions);});
it("validates every route segment and never substitutes a default document",()=>{expect(parseWorkspaceRoute("/projects")).toEqual({});for(const path of ["/projects/not-id","/projects/../../","/unknown","/projects/00000000-0000-4000-8000-000000000000/documents/wrong"])expect(()=>parseWorkspaceRoute(path)).toThrow();});
