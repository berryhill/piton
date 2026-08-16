import { describe, expect, it, vi } from "vitest";
import { CURRENT_SCHEMA_VERSION, LIFECYCLE_TABLES, migrationStatements } from "../browser-src/storage/schema";
import { MemoryProjectRepository, migrateSqliteDatabase, waitForSqliteWorker } from "../browser-src/storage/repository";
import type { Worker1Promiser } from "@sqlite.org/sqlite-wasm";
import { deriveGeometryBinding } from "../browser-src/geometry/binding";
import type { BuildAttempt, ChangeProposal, EvidenceClosure, FabricationRelease } from "../browser-src/lifecycle";
import { assertLifecycleRecord } from "../browser-src/lifecycle";

describe("browser SQLite schema", () => {
  it("rejects visible SQLite worker startup errors without a real worker", async () => {
    const failure = waitForSqliteWorker(({ onerror }) => {
      onerror(new Error("worker bootstrap exploded"));
    }, 100);
    await expect(failure).rejects.toThrow("SQLite worker startup failed: worker bootstrap exploded");
  });

  it("times out a silent SQLite worker startup deterministically", async () => {
    vi.useFakeTimers();
    const startup = waitForSqliteWorker(() => undefined, 25);
    const rejected = expect(startup).rejects.toThrow("SQLite worker startup timed out after 25 ms");
    await vi.advanceTimersByTimeAsync(25);
    await rejected;
    vi.useRealTimers();
  });
  it("defines ordered idempotent migrations for immutable revisions and explicit head", () => {
    const migrations = migrationStatements(0);
    expect(CURRENT_SCHEMA_VERSION).toBe(3);
    expect(migrations.join("\n")).toContain("CREATE TABLE IF NOT EXISTS revisions");
    expect(migrations.join("\n")).toContain("current_revision_id");
    expect(migrations.join("\n")).toContain("fabrication_release INTEGER NOT NULL CHECK (fabrication_release = 0)");
    expect(migrations.join("\n")).toContain("base_revision_id TEXT NOT NULL");
    expect(migrations.join("\n")).toContain("preview_digest TEXT NOT NULL");
    const upgrade = migrationStatements(1).join("\n");
    expect(upgrade).toContain("DROP TABLE build_status");
    expect(upgrade).toContain("PRAGMA user_version = 2");
    const lifecycleUpgrade = migrationStatements(2).join("\n");
    expect(lifecycleUpgrade).toContain("CREATE TABLE change_proposals");
    expect(lifecycleUpgrade).toContain("CREATE TABLE proposal_dispositions");
    expect(lifecycleUpgrade).toContain("CREATE TABLE build_attempts");
    expect(lifecycleUpgrade).toContain("CREATE TABLE evidence_closures");
    expect(lifecycleUpgrade).toContain("CREATE TABLE channel_pointers");
    expect(lifecycleUpgrade).toContain("CREATE TABLE approval_records");
    expect(lifecycleUpgrade).toContain("CREATE TABLE draft_exports");
    expect(lifecycleUpgrade).toContain("CREATE TABLE fabrication_releases");
    expect(lifecycleUpgrade).toContain("CREATE TABLE released_package_projections");
    expect(lifecycleUpgrade).toContain("PRAGMA user_version = 3");
    expect(LIFECYCLE_TABLES).toEqual([
      "change_proposals", "proposal_dispositions", "revisions", "build_attempts",
      "evidence_closures", "channel_pointers", "approval_records", "draft_exports",
      "fabrication_releases", "released_package_projections",
    ]);
  });

  it("fails closed rather than opening a database from a newer schema", () => {
    expect(() => migrationStatements(CURRENT_SCHEMA_VERSION + 1)).toThrow(
      "SQLite schema version 4 is newer than supported version 3",
    );
  });

  it("rolls back the complete migration when one ordered statement fails", async () => {
    const statements: string[] = [];
    const promiser = (async (request: { args?: { sql?: string } }) => {
      const sql = request.args?.sql ?? "";
      statements.push(sql);
      if (sql === "PRAGMA user_version") return { result: { resultRows: [{ user_version: 2 }] } };
      if (sql.startsWith("CREATE TABLE proposal_dispositions")) throw new Error("injected migration failure");
      return { result: { resultRows: [] } };
    }) as unknown as Worker1Promiser;

    await expect(migrateSqliteDatabase(promiser, "fixture-db")).rejects.toThrow("injected migration failure");
    expect(statements[1]).toBe("BEGIN IMMEDIATE");
    expect(statements.at(-1)).toBe("ROLLBACK");
    expect(statements).not.toContain("COMMIT");
    expect(statements).not.toContain("PRAGMA user_version = 3");
  });

  it("keeps release-shaped lifecycle records pinned to false root truth", () => {
    const forged = {
      kind: "fabrication_release",
      id: "release-1",
      projectId: "piton-seeded-l-bracket",
      revisionId: "rev-1",
      approvalRecordId: "approval-1",
      draftExportId: "export-1",
      fabricationRelease: true,
      machineActuation: false,
      createdAt: "2026-08-16T00:00:00.000Z",
    } as unknown as FabricationRelease;
    expect(() => assertLifecycleRecord(forged)).toThrow("lifecycle root truth is invalid");
  });

  it("appends exact lifecycle facts and rejects duplicate, cross-project, and stale pointer writes", async () => {
    const repository = new MemoryProjectRepository();
    const project = await repository.initialize();
    const revisionId = project.currentRevisionId;
    const hex = (character: string) => character.repeat(64);
    const proposal: ChangeProposal = {
      kind: "change_proposal", id: `proposal-${hex("1")}`, projectId: project.id,
      baseRevisionId: revisionId, command: { type: "set-leg-length", value: 90 },
      createdAt: "2026-08-16T00:00:00.000Z",
    };
    await repository.appendLifecycleRecord(proposal);
    await expect(repository.appendLifecycleRecord(proposal)).rejects.toThrow("duplicate lifecycle identity");
    await expect(repository.appendLifecycleRecord({ ...proposal, id: `proposal-${hex("2")}`, projectId: "other" })).rejects.toThrow(
      "lifecycle project authority mismatch",
    );

    const attempt: BuildAttempt = {
      kind: "build_attempt", id: `attempt-${hex("3")}`, projectId: project.id, revisionId,
      recipeDigest: hex("a"), state: "succeeded", createdAt: "2026-08-16T00:01:00.000Z",
    };
    await repository.appendLifecycleRecord(attempt);
    const evidence: EvidenceClosure = {
      kind: "evidence_closure", id: `evidence-${hex("4")}`, projectId: project.id, revisionId,
      buildAttemptId: attempt.id, requirementIds: ["AC-01"], artifactDigests: [hex("b")],
      createdAt: "2026-08-16T00:02:00.000Z",
    };
    await repository.appendLifecycleRecord(evidence);
    await repository.moveChannel({
      kind: "channel_pointer", projectId: project.id, channel: "candidate", revisionId,
      version: 1, updatedAt: "2026-08-16T00:03:00.000Z",
    }, 0);
    await expect(repository.moveChannel({
      kind: "channel_pointer", projectId: project.id, channel: "candidate", revisionId,
      version: 2, updatedAt: "2026-08-16T00:04:00.000Z",
    }, 0)).rejects.toThrow("stale channel pointer");
    expect(await repository.loadLifecycleRecords(project.id)).toHaveLength(4);
  });

  it("rolls back an invalid evidence write without replacing durable facts", async () => {
    const repository = new MemoryProjectRepository();
    const project = await repository.initialize();
    const hex = (character: string) => character.repeat(64);
    await expect(repository.appendLifecycleRecord({
      kind: "evidence_closure", id: `evidence-${hex("5")}`, projectId: project.id,
      revisionId: project.currentRevisionId, buildAttemptId: `attempt-${hex("6")}`,
      requirementIds: ["AC-01"], artifactDigests: [hex("c")], createdAt: "2026-08-16T00:00:00.000Z",
    })).rejects.toThrow("evidence build attempt reference is missing");
    expect(await repository.loadLifecycleRecords(project.id)).toEqual([]);
    expect((await repository.load())?.currentRevisionId).toBe(project.currentRevisionId);
  });

  it("round-trips preview status separately from immutable revision custody", async () => {
    const repository = new MemoryProjectRepository();
    const project = await repository.initialize();
    const base = project.revisions.find((revision) => revision.id === project.currentRevisionId)!;
    const status = {
      projectId: project.id,
      requestId: 7,
      binding: deriveGeometryBinding(base, { ...base.parameters, leg_length_mm: 90 }),
      state: "ready" as const,
      message: "Review mesh ready · CAD Z-min 0 on grid",
    };

    await repository.saveBuildStatus(status);

    expect(await repository.loadBuildStatus(status.projectId)).toEqual(status);
  });

  it("rejects a build status bound to a stale authority revision", async () => {
    const repository = new MemoryProjectRepository();
    const seeded = await repository.initialize();
    const base = seeded.revisions[0];
    const staleStatus = {
      projectId: seeded.id,
      requestId: 1,
      binding: deriveGeometryBinding(base, base.parameters),
      state: "ready" as const,
      message: "old mesh",
    };
    await repository.commitCandidate(seeded.currentRevisionId, { type: "set-leg-length", value: 90 });

    await expect(repository.saveBuildStatus(staleStatus)).rejects.toThrow("build status base revision is stale");
  });

  it("derives commits inside repository authority and rejects a stale writer", async () => {
    const repository = new MemoryProjectRepository();
    const seeded = await repository.initialize();
    const first = await repository.commitCandidate(seeded.currentRevisionId, { type: "set-leg-length", value: 90 });

    expect(first.revisions).toHaveLength(2);
    expect(first.revisions[1].parentRevisionId).toBe(seeded.currentRevisionId);
    expect(first.revisions[1].parameters.leg_length_mm).toBe(90);
    await expect(repository.commitCandidate(seeded.currentRevisionId, { type: "set-leg-length", value: 92 })).rejects.toThrow("stale current revision");
  });

  it("allows exactly one winner when two writers race from the same head", async () => {
    const repository = new MemoryProjectRepository();
    const seeded = await repository.initialize();
    const results = await Promise.allSettled([
      repository.commitCandidate(seeded.currentRevisionId, { type: "set-leg-length", value: 90 }),
      repository.commitCandidate(seeded.currentRevisionId, { type: "set-leg-length", value: 92 }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect((await repository.load())?.revisions).toHaveLength(2);
  });

  it("rejects an unbounded command at the authority boundary", async () => {
    const repository = new MemoryProjectRepository();
    const seeded = await repository.initialize();
    await expect(repository.commitCandidate(seeded.currentRevisionId, { type: "set-leg-length", value: 999 })).rejects.toThrow(
      "leg_length_mm must be between 40 and 160 mm",
    );
  });
});