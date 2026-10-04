// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import Module, { type ManifoldToplevel } from "manifold-3d";
import { appendFeatures, emptyFeatureSource, featureSourceDigest, readFeatures, removeFeature, replaceFeature, type PartFeature } from "../src/modeling/source";
import { evaluateFeatureSource } from "../src/modeling/evaluator";

let kernel: ManifoldToplevel;
beforeAll(async () => { kernel = await Module(); kernel.setup(); });
const plateFeatures: PartFeature[] = [
  { kind: "rectangle", id: "outline", name: "Plate outline", plane: "XY", width: 80, height: 50 },
  { kind: "extrude", id: "plate", name: "Plate thickness", profileId: "outline", distance: 6 },
  ...[[10, 10], [70, 10], [70, 40], [10, 40]].map(([x, y], i): PartFeature => ({ kind: "hole", id: `mount-${i}`, name: `Mounting hole ${i + 1}`, bodyId: "plate", x, y, diameter: 5, extent: "through" })),
];
const plate = () => appendFeatures(emptyFeatureSource(), plateFeatures);
describe("canonical named-feature source", () => {
  it("starts empty without any seeded geometry", () => {
    expect(readFeatures(emptyFeatureSource())).toEqual([]);
    expect(() => evaluateFeatureSource(emptyFeatureSource(), kernel)).toThrow(/extrusion/);
  });
  it("sequential manual and batched adapter commands yield identical source", () => {
    const sequential = plateFeatures.reduce((s, f) => appendFeatures(s, [f]), emptyFeatureSource());
    expect(sequential).toEqual(plate());
    expect(featureSourceDigest(sequential)).toEqual(featureSourceDigest(plate()));
    expect(readFeatures(JSON.parse(JSON.stringify(sequential)))).toEqual(plateFeatures);
    expect(Object.isFrozen(readFeatures(sequential)[0])).toBe(true);
  });
  it("rejects arbitrary code and duplicate JSON keys instead of evaluating text", () => {
    const source = plate();
    expect(() => readFeatures({ ...source, source: source.source + 'globalThis.bad = true;\n' })).toThrow();
    expect(() => readFeatures({ ...source, source: source.source.replace('"width":80', '"width":2,"width":80') })).toThrow(/Noncanonical/);
  });
  it.each([0, -1, NaN, Infinity, 1001])("rejects invalid dimensions %s", width => {
    expect(() => appendFeatures(emptyFeatureSource(), [{ ...plateFeatures[0], width } as PartFeature])).toThrow();
  });
  it("rejects unknown fields, units, plane, features and duplicate IDs", () => {
    expect(() => readFeatures({ ...plate(), units: "in" } as never)).toThrow();
    expect(() => appendFeatures(emptyFeatureSource(), [{ ...plateFeatures[0], surprise: true } as never])).toThrow();
    expect(() => appendFeatures(emptyFeatureSource(), [{ ...plateFeatures[0], plane: "XZ" } as never])).toThrow();
    expect(() => appendFeatures(plate(), [{ kind: "fillet", id: "bad", name: "Unsupported edge set", bodyId: "plate", edgeSet: "allEdges", radius: 2 } as never])).toThrow(/vertical outer perimeter/);
    expect(() => appendFeatures(plate(), [{ ...plateFeatures[2] }])).toThrow(/Duplicate/);
  });
  it("fails on missing dependencies, overlapping holes and edge breakout", () => {
    expect(() => appendFeatures(emptyFeatureSource(), [plateFeatures[1]])).toThrow(/preceding profile/);
    expect(() => removeFeature(plate(), "outline")).toThrow(/preceding profile/);
    expect(() => appendFeatures(plate(), [{ ...plateFeatures[2], id: "overlap" }])).toThrow(/overlap/);
    expect(() => appendFeatures(plate(), [{ ...plateFeatures[2], id: "edge", x: 1 } as PartFeature])).toThrow(/inside/);
  });
});
describe("actual Manifold WASM evaluation (no geometry mocks)", () => {
  it("builds named mounting plate with four holes and independently verifies mesh", () => {
    const result = evaluateFeatureSource(plate(), kernel);
    expect(result.bounds).toEqual({ min: [0, 0, 0], max: [80, 50, 6] });
    const expected = 80 * 50 * 6 - 4 * Math.PI * 2.5 ** 2 * 6;
    expect(Math.abs(result.volumeMm3 - expected) / expected).toBeLessThan(0.001);
    expect(result.triangles.length).toBeGreaterThan(36);
    expect(result.checks.every(c => c.passed)).toBe(true);
    expect(result.claimScope).toBe("review-mesh-only");
    expect(result.fabricationRelease).toBe(false);
    expect(result.machineActuation).toBe(false);
  });
  it("extrudes a circular profile and dimensioned off-center hole", () => {
    const source = appendFeatures(emptyFeatureSource(), [
      { kind: "circle", id: "disk-profile", name: "Disk", plane: "XY", diameter: 40 },
      { kind: "extrude", id: "disk", name: "Disk body", profileId: "disk-profile", distance: 3 },
      { kind: "hole", id: "bore", name: "Offset bore", bodyId: "disk", x: 5, y: 0, diameter: 8, extent: "through" },
    ]);
    const result = evaluateFeatureSource(source, kernel);
    expect(result.bounds).toEqual({ min: [-20, -20, 0], max: [20, 20, 3] });
    expect(Math.abs(result.volumeMm3 - Math.PI * (20 ** 2 - 4 ** 2) * 3) / result.volumeMm3).toBeLessThan(0.001);
  });
  it("regenerates edited dimensions without mutating prior source or feature IDs", () => {
    const before = plate();
    const after = replaceFeature(before, "plate", { kind: "extrude", id: "plate", name: "Thicker plate", profileId: "outline", distance: 9 });
    const first = evaluateFeatureSource(before, kernel);
    const second = evaluateFeatureSource(after, kernel);
    expect(second.volumeMm3 / first.volumeMm3).toBeCloseTo(1.5, 5);
    expect(second.bounds.max[2]).toBe(9);
    expect(readFeatures(before)[1].name).toBe("Plate thickness");
    expect(readFeatures(after).map(f => f.id)).toEqual(readFeatures(before).map(f => f.id));
    expect(() => replaceFeature(before, "outline", { kind: "rectangle", id: "outline", name: "Too small", plane: "XY", width: 20, height: 20 })).toThrow();
    expect(evaluateFeatureSource(before, kernel).volumeMm3).toBe(first.volumeMm3);
  });
});
