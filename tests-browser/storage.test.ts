import { describe, expect, it, vi } from "vitest";
import { CURRENT_SCHEMA_VERSION, migrationStatements } from "../browser-src/storage/schema";
import { MemoryProjectRepository, waitForSqliteWorker } from "../browser-src/storage/repository";
import { deriveGeometryBinding } from "../browser-src/geometry/binding";

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
    expect(CURRENT_SCHEMA_VERSION).toBe(2);
    expect(migrations.join("\n")).toContain("CREATE TABLE IF NOT EXISTS revisions");
    expect(migrations.join("\n")).toContain("current_revision_id");
    expect(migrations.join("\n")).toContain("fabrication_release INTEGER NOT NULL CHECK (fabrication_release = 0)");
    expect(migrations.join("\n")).toContain("base_revision_id TEXT NOT NULL");
    expect(migrations.join("\n")).toContain("preview_digest TEXT NOT NULL");
    const upgrade = migrationStatements(1).join("\n");
    expect(upgrade).toContain("DROP TABLE build_status");
    expect(upgrade).toContain("PRAGMA user_version = 2");
  });

  it("fails closed rather than opening a database from a newer schema", () => {
    expect(() => migrationStatements(CURRENT_SCHEMA_VERSION + 1)).toThrow(
      "SQLite schema version 3 is newer than supported version 2",
    );
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