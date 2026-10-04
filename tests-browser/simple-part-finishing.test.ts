// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import Module, { type ManifoldToplevel } from "manifold-3d";
import { appendFeatures, emptyFeatureSource, readFeatures, replaceFeature, type PartFeature } from "../src/modeling/source";
import { evaluateFeatureSource } from "../src/modeling/evaluator";
import { WorkspaceApplication, isFeaturePart, type FeatureProposal, type WorkspaceStore } from "../src/workspace";

let kernel: ManifoldToplevel;
beforeAll(async () => { kernel = await Module(); kernel.setup(); });
const profile: PartFeature = { kind: "rectangle", id: "outline", name: "Plate", plane: "XY", width: 30, height: 20 };
const body: PartFeature = { kind: "extrude", id: "body", name: "Thickness", profileId: "outline", distance: 4 };
const hole: PartFeature = { kind: "hole", id: "pilot", name: "Pilot", bodyId: "body", x: 10, y: 10, diameter: 2, extent: "through" };
const pattern: PartFeature = { kind: "linearPattern", id: "row", name: "Row", bodyId: "body", sourceHoleId: "pilot", count: 2, spacingX: 8, spacingY: 0 };
const fillet: PartFeature = { kind: "fillet", id: "finish", name: "Round corners", bodyId: "body", edgeSet: "verticalOuterPerimeter", radius: 3 } as PartFeature;
const chamfer: PartFeature = { kind: "chamfer", id: "finish", name: "Bevel corners", bodyId: "body", edgeSet: "verticalOuterPerimeter", distance: 3 } as PartFeature;
const base = () => appendFeatures(emptyFeatureSource(), [profile, body, hole, pattern]);
class Store implements WorkspaceStore {
  row: { version: number; json: string } | null = null;
  async readWorkspace() { return structuredClone(this.row); }
  async writeWorkspace(version: number, json: string) {
    if (version !== (this.row?.version ?? 0)) throw new Error("stale workspace");
    this.row = { version: version + 1, json };
  }
}

describe("bounded vertical outer perimeter finishing", () => {
  it("rejects a hole that clears the analytic arc but breaks through an inscribed fillet chord", () => {
    const large: PartFeature = { ...profile, width: 1000, height: 1000 };
    const nearArc: PartFeature = { ...hole, x: 147.8376102021927, y: 139.3349110335285, diameter: 0.1 };
    const largeFillet: PartFeature = { ...fillet, radius: 490 } as PartFeature;
    expect(() => appendFeatures(emptyFeatureSource(), [large, body, nearArc, largeFillet])).toThrow(/wall thickness/);
  });
  it.each([fillet, chamfer])("produces a real $kind review mesh with independent volume and unchanged bounds, holes and safety", finish => {
    const authored = appendFeatures(base(), [finish]);
    expect(readFeatures(authored)).toEqual([profile, body, hole, pattern, finish]);
    const mesh = evaluateFeatureSource(authored, kernel);
    const r = 3;
    const expectedArea = finish.kind === "fillet" ? 30 * 20 - (4 - Math.PI) * r * r : 30 * 20 - 2 * r * r;
    const expected = (expectedArea - 2 * Math.PI) * 4;
    expect(Math.abs(mesh.volumeMm3 - expected)).toBeLessThan(0.02);
    expect(mesh.volumeMm3).toBeLessThan(evaluateFeatureSource(base(), kernel).volumeMm3 - 20);
    expect(mesh.bounds).toEqual({ min: [0, 0, 0], max: [30, 20, 4] });
    expect(mesh.checks.every(check => check.passed)).toBe(true);
    expect(mesh.claimScope).toBe("review-mesh-only");
    expect(mesh.reviewState).toBe("needs_human_review");
    expect(mesh.fabricationRelease).toBe(false);
    expect(mesh.machineActuation).toBe(false);
  });
  it.each([fillet, chamfer])("rejects invalid $kind inputs and invalidating edits", finish => {
    for (const value of [0, -1, NaN, Infinity, 10, 1001]) {
      const change = finish.kind === "fillet" ? { radius: value } : { distance: value };
      expect(() => appendFeatures(base(), [{ ...finish, ...change } as PartFeature])).toThrow();
    }
    for (const change of [{ edgeSet: "allEdges" }, { bodyId: "missing" }, { extra: true }])
      expect(() => appendFeatures(base(), [{ ...finish, ...change } as PartFeature])).toThrow();
    const finished = appendFeatures(base(), [finish]);
    expect(() => appendFeatures(finished, [fillet])).toThrow();
    expect(() => appendFeatures(finished, [{ ...hole, id: "later", x: 24 } as PartFeature])).toThrow();
    expect(() => appendFeatures(emptyFeatureSource(), [profile, finish, body])).toThrow();
    expect(() => replaceFeature(finished, "outline", { ...profile, width: 5 } as PartFeature)).toThrow();
    expect(readFeatures(finished)).toEqual([profile, body, hole, pattern, finish]);
  });
  it.each([fillet, chamfer])("rejects $kind cutting into a hole or breaking a wall even when the original plate passes", finish => {
    const cornerHole = { ...hole, x: 1.1, y: 1.1 } as PartFeature;
    const nearCorner = appendFeatures(emptyFeatureSource(), [profile, body, cornerHole]);
    expect(() => appendFeatures(nearCorner, [finish])).toThrow(/wall|hole/i);
    const finished = appendFeatures(base(), [finish]);
    expect(() => replaceFeature(finished, "pilot", { ...hole, x: 1.1, y: 1.1 } as PartFeature)).toThrow();
  });
  it.each([fillet, chamfer])("rejects $kind on circles, polygons and revolved bodies", finish => {
    const circle = { ...profile, kind: "circle", diameter: 30 } as PartFeature;
    const polygon = { ...profile, kind: "polygon", vertices: [[0, 0], [30, 0], [30, 20], [0, 20]] } as PartFeature;
    const revolve = { ...body, kind: "revolve", axis: "Z", angleDegrees: 360 } as PartFeature;
    expect(() => appendFeatures(emptyFeatureSource(), [circle, body, finish])).toThrow();
    expect(() => appendFeatures(emptyFeatureSource(), [polygon, body, finish])).toThrow();
    expect(() => appendFeatures(emptyFeatureSource(), [profile, revolve, finish])).toThrow();
  });
  it("requires preview before explicit immutable commit and preserves last-good on failed/stale candidates", async () => {
    const app = new WorkspaceApplication(new Store(), async source => evaluateFeatureSource(source, kernel));
    const projectId = await app.createProject("Finishing");
    const documentId = await app.createPart(projectId, "Plate");
    const proposal = (features: readonly PartFeature[], expectedRevisionId: string | null): FeatureProposal =>
      ({ projectId, documentId, expectedRevisionId, idempotencyKey: crypto.randomUUID(), units: "mm", features });
    const first = await app.proposeFeatures(proposal([profile, body, hole], null));
    const pointer = await app.commitFeatures(first.proposal);
    const incumbent = (await app.read()).projects[0].documents[0].part;
    const candidate = proposal([fillet], pointer);
    await expect(app.commitFeatures(candidate)).rejects.toThrow(/preview/i);
    await expect(app.proposeFeatures(proposal([{ ...fillet, radius: 10 } as PartFeature], pointer))).rejects.toThrow();
    expect((await app.read()).projects[0].documents[0].part).toEqual(incumbent);
    const preview = await app.proposeFeatures(candidate);
    expect((await app.read()).projects[0].documents[0].part).toEqual(incumbent);
    await expect(app.proposeFeatures(proposal([fillet], crypto.randomUUID()))).rejects.toThrow(/Stale revision/);
    await app.commitFeatures(preview.proposal);
    const committed = (await app.read()).projects[0].documents[0].part;
    expect(isFeaturePart(committed)).toBe(true);
    if (isFeaturePart(committed)) {
      expect(committed.revisions).toHaveLength(2);
      expect(committed.revisions[0]).toEqual(incumbent.revisions[0]);
      expect(readFeatures(committed.revisions[1].authored).at(-1)).toEqual(fillet);
      expect(committed.revisions[1].reviewState).toBe("needs_human_review");
      expect(committed.revisions[1].fabricationRelease).toBe(false);
      expect(committed.revisions[1].machineActuation).toBe(false);
    }
    await expect(app.proposeFeatures(proposal([chamfer], pointer))).rejects.toThrow(/Stale revision/);
    expect((await app.read()).projects[0].documents[0].part).toEqual(committed);
  });
});
