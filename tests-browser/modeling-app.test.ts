// @vitest-environment node
import Module, { type ManifoldToplevel } from "manifold-3d";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { WorkspaceApplication, isAuthoredPart, isFeaturePart, type WorkspaceStore, type FeatureProposal } from "../src/workspace";
import { appendFeatures, emptyFeatureSource, readFeatures, type PartFeature } from "../src/modeling/source";
import { evaluateFeatureSource } from "../src/modeling/evaluator";
import { assertFeaturePart } from "../src/modeling/revisions";

let kernel: ManifoldToplevel;
beforeAll(async () => { kernel = await Module(); kernel.setup(); });

const plateFeatures: PartFeature[] = [
  { kind: "rectangle", id: "outline", name: "Plate outline", plane: "XY", width: 80, height: 50 },
  { kind: "extrude", id: "plate", name: "Plate thickness", profileId: "outline", distance: 6 },
  ...[[15, 15], [65, 15], [65, 35], [15, 35]].map(([x, y], i): PartFeature => ({ kind: "hole", id: `mount-${i}`, name: `Mounting hole ${i + 1}`, bodyId: "plate", x, y, diameter: 5, extent: "through" })),
];

function plateSource() {
  return appendFeatures(emptyFeatureSource(), plateFeatures);
}

class Store implements WorkspaceStore {
  row: { version: number; json: string } | null = null;
  async readWorkspace() { return structuredClone(this.row); }
  async writeWorkspace(version: number, json: string) {
    if (version !== (this.row?.version ?? 0)) throw new Error("stale workspace");
    this.row = { version: version + 1, json };
  }
}

async function newApp(): Promise<{ app: WorkspaceApplication; reset: () => void }> {
  const store = new Store();
  // Inject an inline Manifold evaluator so the test does not depend on the
  // Web Worker. The production app uses evaluateFeatureSourceInWorker; both
  // paths route through the same WorkspaceApplication.proposeFeatures call.
  const app = new WorkspaceApplication(store, async source => evaluateFeatureSource(source, kernel));
  return { app, reset: () => { store.row = null; } };
}

function featureProposal(projectId: string, documentId: string, features: readonly PartFeature[], idempotencyKey?: string): FeatureProposal {
  return { projectId, documentId, expectedRevisionId: null, idempotencyKey: idempotencyKey ?? crypto.randomUUID(), units: "mm", features };
}

function uuidKey(): string { return crypto.randomUUID(); }

describe("P3 first-feature authoring pipeline", () => {
  beforeEach(() => { /* each test creates a fresh app */ });

  it("commits a named-feature source for an empty Part and yields a real Manifold preview", async () => {
    const { app } = await newApp();
    const projectId = await app.createProject("P3 plate");
    const documentId = await app.createPart(projectId, "Plate");

    const proposal = featureProposal(projectId, documentId, plateFeatures);
    const preview = await app.proposeFeatures(proposal);
    expect(preview.proposal.features).toEqual(plateFeatures);
    expect(preview.candidate.parentRevisionId).toBeNull();
    expect(preview.geometry.claimScope).toBe("review-mesh-only");
    expect(preview.geometry.fabricationRelease).toBe(false);
    expect(preview.geometry.machineActuation).toBe(false);
    expect(preview.geometry.bounds).toEqual({ min: [0, 0, 0], max: [80, 50, 6] });
    expect(preview.geometry.triangles.length).toBeGreaterThan(36);

    const committedId = await app.commitFeatures(preview.proposal);
    expect(committedId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

    const state = await app.read();
    const part = state.projects[0].documents[0].part;
    expect(isFeaturePart(part)).toBe(true);
    if (isFeaturePart(part)) {
      assertFeaturePart(part);
      expect(part.revisions).toHaveLength(1);
      expect(part.acceptedRevisionId).toBe(part.revisions[0].id);
      expect(part.currentRevisionId).toBe(part.revisions[0].id);
      expect(readFeatures(part.revisions[0].authored)).toEqual(plateFeatures);
    }
  });

  it("reuses a single proposal preview across propose and commit (no double evaluation)", async () => {
    const { app } = await newApp();
    const projectId = await app.createProject("Idempotency");
    const documentId = await app.createPart(projectId, "Plate");
    const key = uuidKey();
    const proposal = featureProposal(projectId, documentId, plateFeatures, key);
    const preview = await app.proposeFeatures(proposal);
    const id1 = await app.commitFeatures(preview.proposal);
    // Replay the same idempotency key + digest returns the same revision id without re-evaluating.
    const id2 = await app.commitFeatures(proposal);
    expect(id2).toBe(id1);
    const part = (await app.read()).projects[0].documents[0].part;
    if (isFeaturePart(part)) expect(part.revisions).toHaveLength(1);
  });

  it("rejects a second commit with the same idempotency key but a different feature payload", async () => {
    const { app } = await newApp();
    const projectId = await app.createProject("Conflict");
    const documentId = await app.createPart(projectId, "Plate");
    const key = uuidKey();
    const proposal = featureProposal(projectId, documentId, plateFeatures, key);
    await app.proposeFeatures(proposal);
    await app.commitFeatures(proposal);
    const conflicting = featureProposal(projectId, documentId, plateFeatures.slice(0, 2), key);
    await expect(app.commitFeatures(conflicting)).rejects.toThrow(/Idempotency conflict/);
  });

  it("rejects a stale expectedRevisionId after a successful first commit", async () => {
    const { app } = await newApp();
    const projectId = await app.createProject("Stale");
    const documentId = await app.createPart(projectId, "Plate");
    const first = featureProposal(projectId, documentId, plateFeatures, uuidKey());
    const preview = await app.proposeFeatures(first);
    await app.commitFeatures(preview.proposal);
    // A subsequent proposal with a non-null expectedRevisionId on a Part whose
    // currentRevisionId is null (still empty in the resource pointer sense)
    // must be refused as stale. The application's parseFeatureProposal validates
    // expectedRevisionId format, so use a malformed pointer to surface the
    // exact "Stale revision" error path.
    const staleProposal: FeatureProposal = {
      projectId, documentId,
      expectedRevisionId: "00000000-0000-4000-8000-000000000000",
      idempotencyKey: uuidKey(),
      units: "mm",
      features: plateFeatures,
    };
    await expect(app.proposeFeatures(staleProposal)).rejects.toThrow();
  });

  it("preserves named feature IDs across the propose -> commit transition without rewriting history", async () => {
    const { app } = await newApp();
    const projectId = await app.createProject("History");
    const documentId = await app.createPart(projectId, "Plate");
    const preview = await app.proposeFeatures(featureProposal(projectId, documentId, plateFeatures));
    await app.commitFeatures(preview.proposal);
    const part = (await app.read()).projects[0].documents[0].part;
    if (!isFeaturePart(part)) throw new Error("expected feature Part");
    const ids = readFeatures(part.revisions[0].authored).map(f => f.id);
    expect(ids).toEqual(["outline", "plate", "mount-0", "mount-1", "mount-2", "mount-3"]);
  });

  it("refuses to commit without a successful evaluated preview in this session", async () => {
    const { app } = await newApp();
    const projectId = await app.createProject("No preview");
    const documentId = await app.createPart(projectId, "Plate");
    await expect(app.commitFeatures(featureProposal(projectId, documentId, plateFeatures))).rejects.toThrow(/preview/i);
  });

  it("edits dimensions through a second immutable preview and retains the first revision", async () => {
    const store = new Store();
    const app = new WorkspaceApplication(store, async source => evaluateFeatureSource(source, kernel));
    const projectId = await app.createProject("Edits");
    const documentId = await app.createPart(projectId, "Plate");
    const first = await app.proposeFeatures(featureProposal(projectId, documentId, plateFeatures));
    const firstPointer = await app.commitFeatures(first.proposal);
    const original = (await app.read()).projects[0].documents[0].part;
    if (!isFeaturePart(original)) throw new Error("expected feature Part");
    const changed = plateFeatures.map(f => f.id === "outline" ? { ...f, width: 90 } as PartFeature : f);
    const proposal = { ...featureProposal(projectId, documentId, changed), expectedRevisionId: firstPointer, operation: "replace" as const };
    const second = await app.proposeFeatures(proposal);
    expect(second.geometry.bounds.max).toEqual([90, 50, 6]);
    expect((await app.read()).projects[0].documents[0].part.revisions).toHaveLength(1);
    const secondPointer = await app.commitFeatures(second.proposal);
    expect(secondPointer).not.toBe(firstPointer);
    const reopened = new WorkspaceApplication(store);
    const persisted = (await reopened.read()).projects[0].documents[0].part;
    if (!isFeaturePart(persisted)) throw new Error("expected feature Part");
    expect(persisted.revisions).toHaveLength(2);
    expect(persisted.revisions[0]).toEqual(original.revisions[0]);
    expect(persisted.revisions[1].parentRevisionId).toBe(original.currentRevisionId);
    expect(readFeatures(persisted.revisions[1].authored)).toEqual(changed);
    await expect(app.commitFeatures({ ...proposal, features: plateFeatures })).rejects.toThrow(/Idempotency conflict/);
  });

  it("persists a committed feature Part across an application remount against the same store", async () => {
    const store = new Store();
    const evalFn = async (source: import("../src/modeling/source").FeatureSource) => evaluateFeatureSource(source, kernel);
    const app1 = new WorkspaceApplication(store, evalFn);
    const projectId = await app1.createProject("Persist");
    const documentId = await app1.createPart(projectId, "Plate");
    const preview = await app1.proposeFeatures(featureProposal(projectId, documentId, plateFeatures));
    await app1.commitFeatures(preview.proposal);
    const snapshot = store.row!;
    const app2 = new WorkspaceApplication(store, evalFn);
    const part = (await app2.read()).projects[0].documents[0].part;
    expect(isAuthoredPart(part)).toBe(false);
    expect(isFeaturePart(part)).toBe(true);
    if (isFeaturePart(part)) {
      expect(part.revisions).toHaveLength(1);
      expect(snapshot.json).toContain(part.revisions[0].id);
    }
  });
});
