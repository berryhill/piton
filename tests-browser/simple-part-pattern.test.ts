// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import Module, { type ManifoldToplevel } from "manifold-3d";
import { appendFeatures, emptyFeatureSource, readFeatures, removeFeature, replaceFeature, type PartFeature } from "../src/modeling/source";
import { evaluateFeatureSource } from "../src/modeling/evaluator";
import { WorkspaceApplication, isFeaturePart, type FeatureProposal, type WorkspaceStore } from "../src/workspace";

let kernel: ManifoldToplevel;
beforeAll(async () => { kernel = await Module(); kernel.setup(); });
const profile: PartFeature = { kind: "rectangle", id: "outline", name: "Plate", plane: "XY", width: 30, height: 20 };
const body: PartFeature = { kind: "extrude", id: "body", name: "Plate extrusion", profileId: "outline", distance: 4 };
const hole: PartFeature = { kind: "hole", id: "pilot", name: "Pilot", bodyId: "body", x: 5, y: 5, diameter: 2, extent: "through" };
const pattern = { kind: "linearPattern", id: "row", name: "Hole row", bodyId: "body", sourceHoleId: "pilot", count: 3, spacingX: 8, spacingY: 3 } as PartFeature;
const base = () => appendFeatures(emptyFeatureSource(), [profile, body, hole]);
const patterned = () => appendFeatures(base(), [pattern]);

class Store implements WorkspaceStore {
  row: { version: number; json: string } | null = null;
  async readWorkspace() { return structuredClone(this.row); }
  async writeWorkspace(version: number, json: string) {
    if (version !== (this.row?.version ?? 0)) throw new Error("stale workspace");
    this.row = { version: version + 1, json };
  }
}

describe("named linear pattern of a preceding circular through-hole", () => {
  it("retains one source operation and subtracts repeats at explicit XY offsets in real WASM", () => {
    const authored = patterned();
    expect(authored.source).toContain("part.linearPattern(");
    expect(readFeatures(authored)).toEqual([profile, body, hole, pattern]);
    const result = evaluateFeatureSource(authored, kernel);
    expect(result.bounds).toEqual({ min: [0, 0, 0], max: [30, 20, 4] });
    const analytic = (30 * 20 - 3 * Math.PI) * 4;
    expect(Math.abs(result.volumeMm3 - analytic)).toBeLessThan(0.01);
    expect(result.volumeMm3).toBeLessThan(evaluateFeatureSource(base(), kernel).volumeMm3 - 20);
    expect(result.checks.every(c => c.passed)).toBe(true);
    expect(result.claimScope).toBe("review-mesh-only");
    expect(result.reviewState).toBe("needs_human_review");
    expect(result.fabricationRelease).toBe(false);
    expect(result.machineActuation).toBe(false);
  });
  it("accepts 2 and 16 instances and non-axis-aligned spacing", () => {
    for (const count of [2, 16]) {
      const circle: PartFeature = { kind: "circle", id: "outline", name: "Disk", plane: "XY", diameter: 100 };
      const centerHole = { ...hole, x: -25, y: -10 } as PartFeature;
      const row = { ...pattern, count, spacingX: 3, spacingY: 1 } as PartFeature;
      const result = evaluateFeatureSource(appendFeatures(emptyFeatureSource(), [circle, body, centerHole, row]), kernel);
      // The large disk is a 256-sided review mesh, not an exact circle.
      expect(Math.abs(result.volumeMm3 - (Math.PI * 50 ** 2 - count * Math.PI) * 4)).toBeLessThan(4);
      expect(result.checks.every(c => c.passed)).toBe(true);
    }
  });
  it.each([
    ["zero spacing", { spacingX: 0, spacingY: 0 }],
    ["nonfinite", { spacingX: Infinity }],
    ["out of range", { spacingY: 1001 }],
    ["fractional count", { count: 2.5 }],
    ["too few", { count: 1 }],
    ["too many", { count: 17 }],
    ["wrong hole", { sourceHoleId: "missing" }],
    ["wrong body", { bodyId: "missing" }],
    ["duplicate ID", { id: "pilot" }],
    ["wall violation", { spacingX: 13 }],
    ["repeat overlap", { spacingX: 1, spacingY: 0 }],
    ["unexpected parameter", { surprise: true }],
  ])("rejects %s atomically", (_label, mutation) => {
    const authored = base();
    expect(() => appendFeatures(authored, [{ ...pattern, ...mutation } as PartFeature])).toThrow();
    expect(readFeatures(authored)).toEqual([profile, body, hole]);
  });
  it("rejects forward, non-hole, revolved and polygon references, and invalidating edits/removal", () => {
    expect(() => appendFeatures(emptyFeatureSource(), [profile, body, pattern, hole])).toThrow();
    expect(() => appendFeatures(base(), [{ ...pattern, sourceHoleId: "body" } as PartFeature])).toThrow();
    const revolved = appendFeatures(emptyFeatureSource(), [profile, { kind: "revolve", id: "body", name: "Turn", profileId: "outline", axis: "Z", angleDegrees: 360 }]);
    expect(() => appendFeatures(revolved, [pattern])).toThrow();
    const polygon: PartFeature = { kind: "polygon", id: "outline", name: "Contour", plane: "XY", vertices: [[0, 0], [30, 0], [30, 20], [0, 20]] };
    expect(() => appendFeatures(emptyFeatureSource(), [polygon, body, hole, pattern])).toThrow();
    expect(() => replaceFeature(patterned(), "pilot", { ...hole, diameter: 9 } as PartFeature)).toThrow();
    expect(() => removeFeature(patterned(), "pilot")).toThrow();
    expect(() => appendFeatures(patterned(), [{ ...hole, id: "later", x: 21, y: 11 } as PartFeature])).toThrow(/overlap|touch/i);
  });
  it("rejects noncanonical or executable source instead of evaluating it", () => {
    const authored = patterned();
    expect(() => readFeatures({ ...authored, source: authored.source.replace('"count":3', '"count":3,"count":3') })).toThrow();
    expect(() => readFeatures({ ...authored, source: authored.source + "globalThis.bad = true;\n" })).toThrow();
  });
  it("requires real preview and explicit immutable commit; rejects stale/failed candidates without replacing last-good", async () => {
    const store = new Store();
    const app = new WorkspaceApplication(store, async source => evaluateFeatureSource(source, kernel));
    const projectId = await app.createProject("Patterns");
    const documentId = await app.createPart(projectId, "Plate");
    const proposal = (features: readonly PartFeature[], expectedRevisionId: string | null, operation?: "replace"): FeatureProposal =>
      ({ projectId, documentId, expectedRevisionId, idempotencyKey: crypto.randomUUID(), units: "mm", features, ...(operation ? { operation } : {}) });
    const first = proposal([profile, body, hole], null);
    const firstPreview = await app.proposeFeatures(first);
    const pointer = await app.commitFeatures(firstPreview.proposal);
    const incumbent = (await app.read()).projects[0].documents[0].part;
    const candidate = proposal([pattern], pointer);
    await expect(app.commitFeatures(candidate)).rejects.toThrow(/preview/i);
    await expect(app.proposeFeatures(proposal([{ ...pattern, spacingX: 13 } as PartFeature], pointer))).rejects.toThrow();
    expect((await app.read()).projects[0].documents[0].part).toEqual(incumbent);
    const preview = await app.proposeFeatures(candidate);
    expect((await app.read()).projects[0].documents[0].part).toEqual(incumbent);
    await expect(app.proposeFeatures(proposal([pattern], crypto.randomUUID()))).rejects.toThrow(/Stale revision/);
    await app.commitFeatures(preview.proposal);
    const committed = (await app.read()).projects[0].documents[0].part;
    expect(isFeaturePart(committed)).toBe(true);
    if (isFeaturePart(committed)) {
      expect(committed.revisions).toHaveLength(2);
      expect(committed.revisions[0]).toEqual(incumbent.revisions[0]);
      expect(readFeatures(committed.revisions[1].authored)[3]).toEqual(pattern);
      expect(committed.revisions[1].reviewState).toBe("needs_human_review");
      expect(committed.revisions[1].fabricationRelease).toBe(false);
      expect(committed.revisions[1].machineActuation).toBe(false);
    }
    await expect(app.commitFeatures(preview.proposal)).resolves.toBeDefined();
    await expect(app.proposeFeatures(proposal([pattern], pointer))).rejects.toThrow(/Stale revision/);
    expect((await app.read()).projects[0].documents[0].part).toEqual(committed);
  });
});
