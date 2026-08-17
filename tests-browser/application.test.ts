import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { CadApplication } from "../browser-src/application";
import { deriveGeometryBinding } from "../browser-src/geometry/binding";
import { MemoryProjectRepository } from "../browser-src/storage/repository";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("CadApplication browser authority boundary", () => {
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

    for (const browserAdapter of [appSource, viewportSource, workerClientSource]) {
      expect(browserAdapter).not.toMatch(/ProjectRepository|ProjectCustodyPort/);
      expect(browserAdapter).not.toMatch(/\.initialize\(|\.saveBuildStatus\(|repository\.commitCandidate\(/);
    }
    expect(appSource).toContain("CadApplication");
  });
});
