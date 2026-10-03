// @vitest-environment node
import Module, { type ManifoldToplevel } from "manifold-3d";
import { beforeAll, expect, it } from "vitest";
import { SqliteOpfsProjectRepository } from "../src/storage/repository";
import { WorkspaceApplication, isFeaturePart } from "../src/workspace";
import { evaluateFeatureSource } from "../src/modeling/evaluator";
import type { PartFeature } from "../src/modeling/source";
import { seedProject } from "../src/domain";

let kernel: ManifoldToplevel;
beforeAll(async () => { kernel = await Module(); kernel.setup(); });

it("round-trips feature revisions, empty and legacy Parts through real SQLite and project backup", async () => {
  const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  const open = () => {
    const repo = new SqliteOpfsProjectRepository();
    Object.assign(repo, { dbId: "test", promiser: async (request: { args: { sql: string; bind?: (string | number | null)[] } }) => {
      const { sql, bind = [] } = request.args;
      const stmt = db.prepare(sql);
      return { result: { resultRows: stmt.columns().length ? stmt.all(...bind) : (stmt.run(...bind), []) } };
    } });
    return repo;
  };
  try {
    const repo = open(); await repo.migrateWorkspace();
    const app = new WorkspaceApplication(repo, async source => evaluateFeatureSource(source, kernel));
    const projectId = await app.createProject("Storage");
    const documentId = await app.createPart(projectId, "Plate");
    const emptyId = await app.createPart(projectId, "Empty");
    const legacy = seedProject();
    const legacyDocumentId = crypto.randomUUID();
    const legacyRevisionId = crypto.randomUUID();
    const initial = (await repo.readWorkspace())!;
    const withLegacy = JSON.parse(initial.json);
    withLegacy.projects[0].documents.push({ id: legacyDocumentId, name: legacy.name, part: legacy, revisionIds: { [legacyRevisionId]: legacy.currentRevisionId } });
    await repo.writeWorkspace(initial.version, JSON.stringify(withLegacy));
    const features: PartFeature[] = [
      { kind: "rectangle", id: "outline", name: "Outline", plane: "XY", width: 80, height: 50 },
      { kind: "extrude", id: "plate", name: "Thickness", profileId: "outline", distance: 6 },
    ];
    const first = { projectId, documentId, expectedRevisionId: null, idempotencyKey: crypto.randomUUID(), units: "mm" as const, features };
    const preview = await app.proposeFeatures(first);
    expect(preview.geometry.bounds.max).toEqual([80, 50, 6]);
    const firstPointer = await app.commitFeatures(first);
    const firstRead = await app.read();
    const original = firstRead.projects[0].documents.find(d => d.id === documentId)!.part;
    expect(isFeaturePart(original)).toBe(true);
    if (!isFeaturePart(original)) throw new Error("expected feature Part");
    expect(original.revisions).toHaveLength(1);
    const updated = features.map(f => f.id === "outline" ? { ...f, width: 90 } as PartFeature : f);
    const second = { ...first, expectedRevisionId: firstPointer, idempotencyKey: crypto.randomUUID(), features: updated, operation: "replace" as const };
    expect((await app.proposeFeatures(second)).geometry.bounds.max).toEqual([90, 50, 6]);
    const secondPointer = await app.commitFeatures(second);
    await expect(app.proposeFeatures({ ...second, expectedRevisionId: firstPointer, idempotencyKey: crypto.randomUUID() })).rejects.toThrow(/Stale revision/);
    const reopened = new WorkspaceApplication(open());
    const state = await reopened.read();
    const part = state.projects[0].documents.find(d => d.id === documentId)!.part;
    expect(isFeaturePart(part)).toBe(true);
    if (!isFeaturePart(part)) throw new Error("expected feature Part");
    expect(part.acceptedRevisionId).toBe(original.acceptedRevisionId);
    expect(part.currentRevisionId).toBe(part.revisions[1].id);
    expect(part.revisions[0]).toEqual(original.revisions[0]);
    expect(state.projects[0].documents.find(d => d.id === emptyId)!.part).toEqual({ id: emptyId, name: "Empty", acceptedRevisionId: null, currentRevisionId: null, revisions: [] });
    expect(state.projects[0].documents.find(d => d.id === legacyDocumentId)!.part).toEqual(legacy);
    expect(db.prepare("SELECT count(*) AS count FROM workspace_revisions").get()).toEqual({ count: 3 });
    const revisionRow = db.prepare("SELECT revision_json FROM workspace_revisions WHERE revision_id=?").get(part.revisions[1].id) as { revision_json: string };
    // A mixed feature/bracket history must be rejected, not silently coerced.
    db.prepare("UPDATE workspace_revisions SET revision_json=? WHERE revision_id=?").run(JSON.stringify({ ...legacy.revisions[0], id: part.revisions[1].id }), part.revisions[1].id);
    await expect(reopened.read()).rejects.toThrow();
    db.prepare("UPDATE workspace_revisions SET revision_json=? WHERE revision_id=?").run(revisionRow.revision_json, part.revisions[1].id);
    expect((await reopened.read()).projects[0].documents).toHaveLength(3);
    const packet = await reopened.exportProject(projectId);
    const other = new DatabaseSync(":memory:");
    try {
      other.exec("PRAGMA foreign_keys=ON");
      const restored = new SqliteOpfsProjectRepository();
      Object.assign(restored, { dbId: "restore", promiser: async (request: { args: { sql: string; bind?: (string | number | null)[] } }) => {
        const { sql, bind = [] } = request.args;
        const stmt = other.prepare(sql);
        return { result: { resultRows: stmt.columns().length ? stmt.all(...bind) : (stmt.run(...bind), []) } };
      } });
      await restored.migrateWorkspace();
      const imported = new WorkspaceApplication(restored);
      expect(await imported.importProject(packet)).toBe(projectId);
      expect(await imported.exportProject(projectId)).toEqual(packet);
      expect(await app.commitFeatures(second)).toBe(secondPointer);
    } finally { other.close(); }
  } finally { db.close(); }
});
