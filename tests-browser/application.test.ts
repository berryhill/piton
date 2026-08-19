import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { CadApplication } from "../browser-src/application";
import { deriveGeometryBinding } from "../browser-src/geometry/binding";
import { MemoryProjectRepository } from "../browser-src/storage/repository";
import { AgentCadAdapter } from "../browser-src/agentAdapter";

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

  it("does not expose a portable-custody boundary from the application service", () => {
    const appSource = source("../browser-src/application.ts");
    const appFile = source("../browser-src/App.tsx");

    expect(appSource).not.toMatch(/PortableCustodyPacket|exportPortableCustody|reopenPortableCustody|parsePortableCustody/);
    expect(appSource).not.toMatch(/import .* from "\.\/portable"/);
    expect(appFile).not.toMatch(/exportPortableCustody|exportCustody|reopenPortableCustody|portable-custody\+json|piton-custody\.json|Portable custody exported/);
  });
});
