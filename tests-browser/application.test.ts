import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { CadApplication } from "../browser-src/application";
import { deriveGeometryBinding } from "../browser-src/geometry/binding";
import { MemoryProjectRepository } from "../browser-src/storage/repository";
import { AgentCadAdapter } from "../browser-src/agentAdapter";
import {
  PORTABLE_CUSTODY_FORMAT,
  type PortableCustodyEnvelope,
  type PortableCustodyPacket,
} from "../browser-src/domain";
import { CURRENT_SCHEMA_VERSION } from "../browser-src/storage/schema";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("CadApplication browser authority boundary", () => {
  it("admits UI and agent requests through one closed idempotent executor", async () => {
    const repository = new MemoryProjectRepository();
    const application = new CadApplication(repository);
    const opened = await application.open();
    const request = {
      format: "piton-command/v1",
      projectId: opened.project.id,
      expectedCurrentRevisionId: opened.project.currentRevisionId,
      idempotencyKey: "ui-commit-0001",
      command: { type: "set-leg-length", quantity: { value: 92, unit: "mm" } },
    } as const;

    const first = await application.executeCommand(request);
    const replay = await new AgentCadAdapter(application).execute(request);

    expect(replay).toEqual(first);
    expect((await application.loadProject()).revisions).toHaveLength(2);
    await expect(new AgentCadAdapter(application).execute({
      ...request,
      command: { type: "set-leg-length", quantity: { value: 93, unit: "mm" } },
    })).rejects.toThrow("idempotency key conflicts with another request");
  });

  it("coalesces concurrent equivalent requests into one receipt and one revision", async () => {
    const application = new CadApplication(new MemoryProjectRepository());
    const opened = await application.open();
    const request = {
      format: "piton-command/v1", projectId: opened.project.id,
      expectedCurrentRevisionId: opened.project.currentRevisionId, idempotencyKey: "concurrent-commit-0001",
      command: { type: "set-leg-length", quantity: { value: 96, unit: "mm" } },
    } as const;
    const [uiReceipt, agentReceipt] = await Promise.all([
      application.executeCommand(request),
      new AgentCadAdapter(application).execute(request),
    ]);
    expect(agentReceipt).toEqual(uiReceipt);
    expect((await application.loadProject()).revisions).toHaveLength(2);
  });

  it("fails malformed, cross-project, authority-shaped, and stale requests before mutation", async () => {
    const repository = new MemoryProjectRepository();
    const application = new CadApplication(repository);
    const opened = await application.open();
    const request = {
      format: "piton-command/v1",
      projectId: opened.project.id,
      expectedCurrentRevisionId: opened.project.currentRevisionId,
      idempotencyKey: "agent-commit-0001",
      command: { type: "set-leg-length", quantity: { value: 90, unit: "mm" } },
    } as const;
    await expect(application.executeCommand({ ...request, projectId: "other-project" })).rejects.toThrow("project identity mismatch");
    await expect(application.executeCommand({ ...request, fabricationRelease: true } as never)).rejects.toThrow("invalid command envelope");
    await application.executeCommand(request);
    await expect(application.executeCommand({ ...request, idempotencyKey: "stale-commit-0001" })).rejects.toThrow("stale current revision");
    expect((await application.loadProject()).revisions).toHaveLength(2);
  });

  it("owns initialization, candidate commits, reload, and durable preview status", async () => {
    const repository = new MemoryProjectRepository();
    const initialize = vi.spyOn(repository, "initialize");
    const commitCandidate = vi.spyOn(repository, "commitCandidate");
    const saveBuildStatus = vi.spyOn(repository, "saveBuildStatus");
    const application = new CadApplication(repository);

    const opened = await application.open();
    const committed = await application.commitCandidate(opened.project.currentRevisionId, {
      type: "set-leg-length",
      value: 92,
    });
    const current = committed.revisions.find((revision) => revision.id === committed.currentRevisionId)!;
    const status = {
      projectId: committed.id,
      requestId: 9,
      binding: deriveGeometryBinding(current, current.parameters),
      state: "ready" as const,
      message: "review mesh ready",
    };
    await application.recordBuildStatus(status);

    expect(initialize).toHaveBeenCalledOnce();
    expect(commitCandidate).toHaveBeenCalledWith(opened.project.currentRevisionId, {
      type: "set-leg-length",
      value: 92,
    });
    expect(saveBuildStatus).toHaveBeenCalledWith(status);
    expect(await application.loadProject()).toEqual(committed);
  });

  it("keeps writable storage ports out of React and geometry adapters", () => {
    const appSource = source("../browser-src/App.tsx");
    const viewportSource = source("../browser-src/components/Viewport.tsx");
    const workerClientSource = source("../browser-src/geometry/workerClient.ts");
    const agentSource = source("../browser-src/agentAdapter.ts");

    for (const browserAdapter of [appSource, viewportSource, workerClientSource, agentSource]) {
      expect(browserAdapter).not.toMatch(/ProjectRepository|ProjectCustodyPort/);
      expect(browserAdapter).not.toMatch(/\.initialize\(|\.saveBuildStatus\(|repository\.commitCandidate\(/);
    }
    expect(appSource).toContain("CadApplication");
  });

  it("returns a self-describing portable custody envelope from CadApplication", async () => {
    const repository = new MemoryProjectRepository();
    const application = new CadApplication(repository);
    const opened = await application.open();
    await application.executeCommand({
      format: "piton-command/v1",
      projectId: opened.project.id,
      expectedCurrentRevisionId: opened.project.currentRevisionId,
      idempotencyKey: "portable-export-0001",
      command: { type: "set-leg-length", quantity: { value: 92, unit: "mm" } },
    } as const);
    const authoritative = await application.loadProject();

    const envelope = await application.exportPortableCustody();
    const envelopeKeys = Object.keys(envelope).sort();
    expect(envelopeKeys).toEqual([
      "build_status", "environment_digest", "exported_at", "fingerprint",
      "format", "lifecycle_projection", "project", "revisions", "schema_version",
    ]);
    expect(envelope.format).toBe(PORTABLE_CUSTODY_FORMAT);
    expect(envelope.schema_version).toBe(CURRENT_SCHEMA_VERSION);
    expect(envelope.fingerprint).toMatch(/^sha256-[0-9a-f]{64}$/);
    expect(envelope.environment_digest).toMatch(/^sha256-[0-9a-f]{64}$/);
    expect(envelope.project.current_revision_id).toBe(authoritative.currentRevisionId);
    expect(envelope.revisions.map((revision) => revision.id)).toEqual(authoritative.revisions.map((revision) => revision.id));
    expect(envelope.revisions.every((revision) =>
      revision.fabricationRelease === false && revision.machineActuation === false
      && revision.reviewState === "needs_human_review" && revision.releaseState === "unreleased",
    )).toBe(true);
  });

  it("reopens portable custody with strict validation and never mutates the in-memory project on failure", async () => {
    const repository = new MemoryProjectRepository();
    const application = new CadApplication(repository);
    const opened = await application.open();
    const envelope = await application.exportPortableCustody();

    const restored = await application.reopenPortableCustody(envelope, envelope.fingerprint);
    expect(restored.project.currentRevisionId).toBe(envelope.project.current_revision_id);
    expect(restored.project.revisions.map((revision) => revision.id)).toEqual(envelope.revisions.map((revision) => revision.id));

    await expect(application.reopenPortableCustody({ format: "wrong-format" }, "sha256-forged")).rejects.toThrow(/portable custody/);
    await expect(application.reopenPortableCustody(envelope, "sha256-tampered")).rejects.toThrow(/portable custody fingerprint mismatch/);

    const stillOriginal = await application.loadProject();
    expect(stillOriginal.currentRevisionId).toBe(opened.project.currentRevisionId);
  });

  it("round-trips portable custody through MemoryProjectRepository with immutable revision digests", async () => {
    const sourceRepo = new MemoryProjectRepository();
    const sourceApp = new CadApplication(sourceRepo);
    const sourceOpened = await sourceApp.open();
    await sourceApp.executeCommand({
      format: "piton-command/v1",
      projectId: sourceOpened.project.id,
      expectedCurrentRevisionId: sourceOpened.project.currentRevisionId,
      idempotencyKey: "portable-roundtrip-0001",
      command: { type: "set-leg-length", quantity: { value: 110, unit: "mm" } },
    } as const);
    const sourceAfter = await sourceApp.loadProject();
    const envelope = await sourceApp.exportPortableCustody();

    const targetRepo = new MemoryProjectRepository();
    const targetApp = new CadApplication(targetRepo);
    await targetApp.open();
    const restored = await targetApp.reopenPortableCustody(envelope, envelope.fingerprint);
    const targetAfter = await targetApp.loadProject();

    expect(restored.project).toEqual(sourceAfter);
    expect(targetAfter).toEqual(sourceAfter);
    expect(restored.project.revisions.map((revision) => revision.id)).toEqual(sourceAfter.revisions.map((revision) => revision.id));
  });

  it("keeps memory custody unchanged when late lifecycle validation rejects import", async () => {
    const repository = new MemoryProjectRepository();
    const application = new CadApplication(repository);
    const opened = await application.open();
    const envelope = await application.exportPortableCustody();
    const { fingerprint: _oldFingerprint, ...packet } = {
      ...envelope,
      lifecycle_projection: [{
        kind: "fabrication_release",
        id: `release-${"1".repeat(64)}`,
        projectId: opened.project.id,
        revisionId: opened.project.currentRevisionId,
        approvalRecordId: `approval-${"2".repeat(64)}`,
        draftExportId: `export-${"3".repeat(64)}`,
        fabricationRelease: true,
        machineActuation: false,
        createdAt: "2026-08-20T00:00:00.000Z",
      }],
    };
    const fingerprint = await repository.portableCustodyFingerprint(packet);

    await expect(application.reopenPortableCustody({ ...packet, fingerprint }, fingerprint)).rejects.toThrow(
      "lifecycle root truth is invalid",
    );
    expect(await application.loadProject()).toEqual(opened.project);
  });

  it("keeps the portable custody authority inside the closed CadApplication surface", () => {
    const appSource = source("../browser-src/application.ts");
    const appFile = source("../browser-src/App.tsx");
    const viewportSource = source("../browser-src/components/Viewport.tsx");
    const workerClientSource = source("../browser-src/geometry/workerClient.ts");
    const agentSource = source("../browser-src/agentAdapter.ts");

    expect(appSource).toMatch(/exportPortableCustody/);
    expect(appSource).toMatch(/reopenPortableCustody/);
    expect(appFile).toMatch(/exportPortableCustody/);
    expect(appFile).toMatch(/reopenPortableCustody/);
    expect(viewportSource).not.toMatch(/PortableCustodyPacket|exportPortableCustody|reopenPortableCustody/);
    expect(workerClientSource).not.toMatch(/PortableCustodyPacket|exportPortableCustody|reopenPortableCustody/);
    expect(agentSource).not.toMatch(/PortableCustodyPacket|exportPortableCustody|reopenPortableCustody/);
  });
});
