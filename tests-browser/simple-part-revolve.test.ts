// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import Module, { type ManifoldToplevel } from "manifold-3d";
import { appendFeatures, emptyFeatureSource, readFeatures, replaceFeature, type PartFeature } from "../src/modeling/source";
import { evaluateFeatureSource } from "../src/modeling/evaluator";
import { WorkspaceApplication, isFeaturePart, type FeatureProposal, type WorkspaceStore } from "../src/workspace";

let kernel: ManifoldToplevel;
beforeAll(async () => { kernel = await Module(); kernel.setup(); });
const rectangle: PartFeature = { kind: "rectangle", id: "section", name: "Radial axial rectangle", plane: "XY", width: 10, height: 8 };
const revolve: PartFeature = { kind: "revolve", id: "body", name: "Full turn", profileId: "section", axis: "Z", angleDegrees: 360 };
const polygon: PartFeature = { kind: "polygon", id: "section", name: "Annular step", plane: "XY", vertices: [[2, -3], [6, -3], [6, 1], [4, 1], [4, 5], [2, 5]] };
const source = (profile: PartFeature = rectangle) => appendFeatures(emptyFeatureSource(), [profile, revolve]);

class Store implements WorkspaceStore {
  row: { version: number; json: string } | null = null;
  async readWorkspace() { return structuredClone(this.row); }
  async writeWorkspace(version: number, json: string) {
    if (version !== (this.row?.version ?? 0)) throw new Error("stale workspace");
    this.row = { version: version + 1, json };
  }
}

describe("bounded named Z-axis revolve", () => {
  it("round-trips radial/axial source and independently measures a real WASM cylinder", () => {
    const authored = source();
    expect(authored.source).toContain("part.revolve(");
    expect(readFeatures(authored)).toEqual([rectangle, revolve]);
    const mesh = evaluateFeatureSource(authored, kernel);
    expect(mesh.bounds).toEqual({ min: [-10, -10, 0], max: [10, 10, 8] });
    expect(Math.abs(mesh.volumeMm3 - Math.PI * 10 ** 2 * 8)).toBeLessThan(1);
    expect(mesh.vertices.length).toBeGreaterThan(0);
    expect(mesh.triangles.length).toBeGreaterThan(0);
    expect(mesh.checks.every(c => c.passed)).toBe(true);
    expect(mesh.claimScope).toBe("review-mesh-only");
    expect(mesh.reviewState).toBe("needs_human_review");
    expect(mesh.fabricationRelease).toBe(false);
    expect(mesh.machineActuation).toBe(false);
  });
  it("revolves an offset concave polygon with a bore and stepped radius", () => {
    const mesh = evaluateFeatureSource(source(polygon), kernel);
    expect(mesh.bounds).toEqual({ min: [-6, -6, -3], max: [6, 6, 5] });
    const analytic = Math.PI * ((6 ** 2 - 2 ** 2) * 4 + (4 ** 2 - 2 ** 2) * 4);
    expect(Math.abs(mesh.volumeMm3 - analytic)).toBeLessThan(1);
    expect(mesh.checks.every(c => c.passed)).toBe(true);
    const edited = replaceFeature(source(polygon), "body", { ...revolve, name: "Renamed turn" });
    expect(readFeatures(edited)[1].id).toBe("body");
  });
  it("rejects unsupported axes, partial turns, negative radii, ambiguous bodies and holes", () => {
    for (const mutation of [{ axis: "Y" }, { angleDegrees: 180 }, { angleDegrees: NaN }, { surprise: true }]) {
      expect(() => appendFeatures(emptyFeatureSource(), [rectangle, { ...revolve, ...mutation } as never])).toThrow();
    }
    expect(() => appendFeatures(emptyFeatureSource(), [revolve])).toThrow(/preceding profile/);
    expect(() => source({ ...polygon, vertices: [[-1, 0], [4, 0], [4, 4], [-1, 4]] } as PartFeature)).toThrow(/radius/);
    expect(() => source({ kind: "circle", id: "section", name: "Disk", plane: "XY", diameter: 8 })).toThrow(/Circular/);
    expect(() => appendFeatures(source(), [{ kind: "extrude", id: "other", name: "Other", profileId: "section", distance: 4 }])).toThrow(/one extrusion or revolve/);
    expect(() => appendFeatures(appendFeatures(emptyFeatureSource(), [rectangle, { kind: "extrude", id: "other", name: "Other", profileId: "section", distance: 4 }]), [revolve])).toThrow(/one extrusion or revolve/);
    expect(() => appendFeatures(source(), [{ kind: "hole", id: "bore", name: "Bore", bodyId: "body", x: 3, y: 3, diameter: 1, extent: "through" }])).toThrow(/revolved bodies/);
    expect(() => readFeatures({ ...source(), source: source().source.replace('"angleDegrees":360', '"angleDegrees":180') })).toThrow();
    expect(() => readFeatures({ ...source(), source: source().source + "globalThis.bad = 1;\n" })).toThrow();
  });
  it("requires preview then explicit commit and preserves last-good on failed or stale candidates", async () => {
    const store = new Store();
    const app = new WorkspaceApplication(store, async authored => evaluateFeatureSource(authored, kernel));
    const projectId = await app.createProject("Revolve");
    const documentId = await app.createPart(projectId, "Turned part");
    const proposal = (features: readonly PartFeature[], expectedRevisionId: string | null = null): FeatureProposal =>
      ({ projectId, documentId, expectedRevisionId, idempotencyKey: crypto.randomUUID(), units: "mm", features, ...(expectedRevisionId ? { operation: "replace" as const } : {}) });
    const first = proposal([rectangle, revolve]);
    await expect(app.commitFeatures(first)).rejects.toThrow(/preview/i);
    const preview = await app.proposeFeatures(first);
    expect((await app.read()).projects[0].documents[0].part.revisions).toHaveLength(0);
    const pointer = await app.commitFeatures(preview.proposal);
    const retained = (await app.read()).projects[0].documents[0].part;
    await expect(app.proposeFeatures(proposal([polygon, { ...revolve, angleDegrees: 180 } as never], pointer))).rejects.toThrow();
    await expect(app.proposeFeatures(proposal([polygon, revolve], crypto.randomUUID()))).rejects.toThrow(/Stale revision/);
    expect((await app.read()).projects[0].documents[0].part).toEqual(retained);
    const next = await app.proposeFeatures(proposal([polygon, revolve], pointer));
    expect(next.candidate.parentRevisionId).toBe(retained.currentRevisionId);
    expect((await app.read()).projects[0].documents[0].part).toEqual(retained);
    await app.commitFeatures(next.proposal);
    const part = (await app.read()).projects[0].documents[0].part;
    expect(isFeaturePart(part)).toBe(true);
    if (isFeaturePart(part)) {
      expect(part.revisions).toHaveLength(2);
      expect(part.revisions[0]).toEqual(retained.revisions[0]);
      expect(part.revisions[1].reviewState).toBe("needs_human_review");
    }
  });
});
