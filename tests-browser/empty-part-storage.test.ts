import { expect, it } from "vitest";
import { SqliteOpfsProjectRepository, MemoryProjectRepository } from "../src/storage/repository";
import { WorkspaceApplication, isAuthoredPart, type WorkspaceState } from "../src/workspace";
import { CadApplication } from "../src/application";
import { DEFAULT_PARAMETERS } from "../src/domain";

const oldSchema = [
  `CREATE TABLE workspace_meta (id INTEGER PRIMARY KEY CHECK(id=1), schema_version INTEGER NOT NULL CHECK(schema_version=1), version INTEGER NOT NULL CHECK(version>=0)) STRICT`,
  `CREATE TABLE workspace_projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, archived INTEGER NOT NULL CHECK(archived IN (0,1)), updated_at TEXT NOT NULL) STRICT`,
  `CREATE TABLE workspace_documents (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES workspace_projects(id), name TEXT NOT NULL, source_id TEXT NOT NULL, accepted_revision_id TEXT NOT NULL, current_revision_id TEXT NOT NULL, legacy_json TEXT) STRICT`,
  `CREATE TABLE workspace_revisions (id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES workspace_documents(id), revision_id TEXT NOT NULL, revision_json TEXT NOT NULL, UNIQUE(document_id,revision_id)) STRICT`,
  `CREATE TABLE workspace_imports (digest TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES workspace_projects(id)) STRICT`,
  `CREATE TABLE workspace_receipts (id TEXT PRIMARY KEY, digest TEXT NOT NULL, revision_id TEXT NOT NULL REFERENCES workspace_revisions(id)) STRICT`,
];
const tables = ["workspace_projects", "workspace_documents", "workspace_revisions", "workspace_imports", "workspace_receipts"];
async function fixture() {
  const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  let failSql: RegExp | undefined;
  const open = () => {
    const repo = new SqliteOpfsProjectRepository();
    Object.assign(repo, { dbId: "test", promiser: async (request: {args: {sql: string; bind?: (string|number|null)[]}}) => {
      const {sql,bind=[]}=request.args;
      if(failSql?.test(sql)) throw new Error("injected migration failure");
      const stmt=db.prepare(sql);
      return {result:{resultRows:stmt.columns().length ? stmt.all(...bind) : (stmt.run(...bind),[])}};
    }});
    return repo;
  };
  oldSchema.forEach(sql=>db.exec(sql));
  // Explicit authored custody fixture, not Create Part.
  const legacy=new CadApplication(new MemoryProjectRepository());await legacy.open();
  const packet=await legacy.exportPortableCustody();
  let row: {version:number;json:string}|null=null;
  const memory=new WorkspaceApplication({readWorkspace:async()=>row,writeWorkspace:async(version,json)=>{row={version:version+1,json};}});
  const projectId=await memory.importCustody(packet);
  const doc=(await memory.read()).projects[0].documents[0];
  const proposal={projectId,documentId:doc.id,expectedRevisionId:Object.keys(doc.revisionIds)[0],idempotencyKey:crypto.randomUUID(),parameters:{...DEFAULT_PARAMETERS,leg_length_mm:101}};
  await memory.propose(proposal);await memory.commit(proposal);
  const state=await memory.read();
  db.prepare("INSERT INTO workspace_meta VALUES(1,1,?)").run(2);
  for(const p of state.projects) {
    db.prepare("INSERT INTO workspace_projects VALUES(?,?,?,?)").run(p.id,p.name,Number(p.archived),p.updatedAt);
    for(const d of p.documents) {
      db.prepare("INSERT INTO workspace_documents VALUES(?,?,?,?,?,?,?)").run(d.id,p.id,d.name,d.part.id,d.part.acceptedRevisionId,d.part.currentRevisionId,JSON.stringify(d.legacyCustody));
      for(const [id,rid] of Object.entries(d.revisionIds)) db.prepare("INSERT INTO workspace_revisions VALUES(?,?,?,?)").run(id,d.id,rid,JSON.stringify(d.part.revisions.find(r=>r.id===rid)));
    }
  }
  for(const [digest,id] of Object.entries(state.imports)) db.prepare("INSERT INTO workspace_imports VALUES(?,?)").run(digest,id);
  for(const [id,r] of Object.entries(state.receipts)) db.prepare("INSERT INTO workspace_receipts VALUES(?,?,?)").run(id,r.digest,r.revisionId);
  const snapshot=()=>Object.fromEntries(tables.map(t=>[t,db.prepare(`SELECT rowid,* FROM ${t} ORDER BY rowid`).all()]));
  return {db,open,state,projectId,snapshot,inject:(pattern?:RegExp)=>{failSql=pattern;}};
}

it("migrates real v1 SQLite with FK enforcement, preserves every old row, and reopens empty/mixed backups",async()=>{
  const {db,open,state,projectId,snapshot}=await fixture();
  try {
    const before=snapshot(), repo=open();
    await repo.migrateWorkspace();
    expect(db.prepare("SELECT schema_version FROM workspace_meta").get()).toEqual({schema_version:2});
    expect(snapshot()).toEqual(before);
    expect(JSON.parse((await repo.readWorkspace())!.json)).toEqual(state);
    const app=new WorkspaceApplication(repo), oldPacket=await app.exportProject(projectId);
    const emptyId=await app.createPart(projectId,"Empty Part");
    const reopened=new WorkspaceApplication(open());
    const mixed=await reopened.read(), empty=mixed.projects[0].documents.find(d=>d.id===emptyId)!;
    expect(isAuthoredPart(empty.part)).toBe(false);
    expect(empty.part).toEqual({id:emptyId,name:"Empty Part",acceptedRevisionId:null,currentRevisionId:null,revisions:[]});
    expect(empty.revisionIds).toEqual({});expect(empty).not.toHaveProperty("legacyCustody");
    expect(db.prepare("SELECT accepted_revision_id,current_revision_id FROM workspace_documents WHERE id=?").get(emptyId)).toEqual({accepted_revision_id:null,current_revision_id:null});
    expect(db.prepare("SELECT rowid,* FROM workspace_revisions ORDER BY rowid").all()).toEqual(before.workspace_revisions);
    const packet=await reopened.exportProject(projectId);
    let copy: {version:number;json:string}|null=null;
    const other=new WorkspaceApplication({readWorkspace:async()=>copy,writeWorkspace:async(version,json)=>{copy={version:version+1,json};}});
    await other.importProject(packet);expect(await other.exportProject(projectId)).toEqual(packet);
    expect(packet.project.documents[0]).toEqual(oldPacket.project.documents[0]);
    // The old signed backup is still valid independently of the new mixed backup.
    let oldCopy: {version:number;json:string}|null=null;
    const oldApp=new WorkspaceApplication({readWorkspace:async()=>oldCopy,writeWorkspace:async(version,json)=>{oldCopy={version:version+1,json};}});
    await oldApp.importProject(oldPacket);expect(await oldApp.exportProject(projectId)).toEqual(oldPacket);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    await repo.migrateWorkspace();expect(await reopened.read()).toEqual(mixed);
    const row=(await repo.readWorkspace())!, invalid: WorkspaceState=JSON.parse(row.json);
    const authored=invalid.projects[0].documents[0];
    authored.part={id:authored.part.id,name:authored.name,acceptedRevisionId:null,currentRevisionId:null,revisions:[]};authored.revisionIds={};delete authored.legacyCustody;invalid.receipts={};
    await expect(repo.writeWorkspace(row.version,JSON.stringify(invalid))).rejects.toThrow("Immutable");
    expect(await repo.readWorkspace()).toEqual(row);
  } finally {db.close();}
});

it("persists an empty-only project across a real SQLite close/reopen and backup restore",async()=>{
  const {DatabaseSync}=process.getBuiltinModule("node:sqlite");
  const {mkdtempSync,rmSync}=process.getBuiltinModule("node:fs");
  const {tmpdir}=process.getBuiltinModule("node:os");
  const {join}=process.getBuiltinModule("node:path");
  const dir=mkdtempSync(join(tmpdir(),"piton-empty-"));
  let db=new DatabaseSync(join(dir,"workspace.sqlite"));
  const open=()=>{
    db.exec("PRAGMA foreign_keys=ON");
    const repo=new SqliteOpfsProjectRepository();
    Object.assign(repo,{dbId:"test",promiser:async(request:{args:{sql:string;bind?:(string|number|null)[]}})=>{
      const {sql,bind=[]}=request.args,stmt=db.prepare(sql);
      return {result:{resultRows:stmt.columns().length?stmt.all(...bind):(stmt.run(...bind),[])}};
    }});return repo;
  };
  try {
    let repo=open();await repo.migrateWorkspace();
    const app=new WorkspaceApplication(repo),id=await app.createProject("New project");
    const partId=await app.createPart(id,"New Part");await app.renamePart(id,partId,"Blank Part");
    const packet=await app.exportProject(id);
    expect(db.prepare("SELECT * FROM workspace_revisions").all()).toEqual([]);
    expect(()=>db.prepare("UPDATE workspace_documents SET current_revision_id='fake' WHERE id=?").run(partId)).toThrow();
    db.close();db=new DatabaseSync(join(dir,"workspace.sqlite"));
    repo=open();await repo.migrateWorkspace();
    const reopened=new WorkspaceApplication(repo);
    expect(await reopened.exportProject(id)).toEqual(packet);
    expect(await reopened.importProject(packet)).toBe(id);
    expect(packet.project.documents[0].part.currentRevisionId).toBeNull();
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {db.close();rmSync(dir,{recursive:true,force:true});}
});

it("refuses unrecognized inbound FK dependents without cascading away their rows",async()=>{
  const {db,open,state,snapshot}=await fixture();
  try {
    db.exec("CREATE TABLE external_custody(id TEXT PRIMARY KEY, document_id TEXT REFERENCES workspace_documents(id) ON DELETE CASCADE) STRICT");
    db.prepare("INSERT INTO external_custody VALUES('keep',?)").run(state.projects[0].documents[0].id);
    const before=snapshot(),external=db.prepare("SELECT * FROM external_custody").all();
    await expect(open().migrateWorkspace()).rejects.toThrow("Unsupported workspace migration foreign key");
    expect(snapshot()).toEqual(before);expect(db.prepare("SELECT * FROM external_custody").all()).toEqual(external);
    expect(db.prepare("SELECT schema_version FROM workspace_meta").get()).toEqual({schema_version:1});
  } finally {db.close();}
});

it("rolls back a v1 table replacement failure with original schema, custody and FK rows intact",async()=>{
  const {db,open,snapshot,inject}=await fixture();
  try {
    const before=snapshot();inject(/^ALTER TABLE/);
    await expect(open().migrateWorkspace()).rejects.toThrow("injected migration failure");
    expect(snapshot()).toEqual(before);
    expect(db.prepare("SELECT schema_version FROM workspace_meta").get()).toEqual({schema_version:1});
    expect(db.prepare("PRAGMA table_info(workspace_documents)").all().find(r=>r.name==="accepted_revision_id")?.notnull).toBe(1);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    inject();await open().migrateWorkspace();expect(snapshot()).toEqual(before);
  } finally {db.close();}
});
