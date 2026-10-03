// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import Module, { type ManifoldToplevel } from "manifold-3d";
import { appendFeatures, emptyFeatureSource, readFeatures, replaceFeature, type PartFeature } from "../src/modeling/source";
import { evaluateFeatureSource } from "../src/modeling/evaluator";

let kernel: ManifoldToplevel;
beforeAll(async () => { kernel = await Module(); kernel.setup(); });

const outline = (vertices: unknown): PartFeature => ({ kind: "polygon", id: "outline", name: "Notched outline", plane: "XY", vertices } as PartFeature);
const extrude: PartFeature = { kind: "extrude", id: "body", name: "Body", profileId: "outline", distance: 4 };
const notch = [[-2, -1], [4, -1], [4, 1], [1, 1], [1, 3], [-2, 3]];
const source = (vertices: unknown = notch) => appendFeatures(emptyFeatureSource(), [outline(vertices), extrude]);

// A real Line contour, not a bounding rectangle: area is 6*2 + 3*2.
describe("bounded XY polygon Line profile", () => {
  it("round-trips canonical named source and extrudes the actual concave contour along +Z", () => {
    const authored = source();
    expect(authored.source).toContain("part.polygon(");
    expect(readFeatures(authored)).toEqual([outline(notch), extrude]);
    const result = evaluateFeatureSource(authored, kernel);
    expect(result.bounds).toEqual({ min: [-2, -1, 0], max: [4, 3, 4] });
    expect(result.volumeMm3).toBeCloseTo(72, 5);
    expect(result.checks.every(check => check.passed)).toBe(true);
    expect(result.claimScope).toBe("review-mesh-only");
    expect(result.reviewState).toBe("needs_human_review");
    expect(result.fabricationRelease).toBe(false);
    expect(result.machineActuation).toBe(false);
  });
  it("accepts three vertices and 32 vertices and retains stable identity on replacement", () => {
    const triangle = [[0, 0], [3, 0], [0, 2]];
    expect(evaluateFeatureSource(source(triangle), kernel).volumeMm3).toBeCloseTo(12, 5);
    const vertices = Array.from({ length: 32 }, (_, i) => [20 * Math.cos(i * 2 * Math.PI / 32), 20 * Math.sin(i * 2 * Math.PI / 32)]);
    expect(readFeatures(source(vertices))[0]).toEqual(outline(vertices));
    expect(evaluateFeatureSource(source(vertices), kernel).volumeMm3).toBeGreaterThan(0);
    expect(readFeatures(replaceFeature(source(triangle), "outline", outline(notch)))[0]).toEqual(outline(notch));
  });
  it.each([
    ["too few", [[0, 0], [1, 0]]],
    ["too many", Array.from({ length: 33 }, (_, i) => [20 * Math.cos(i * 2 * Math.PI / 33), 20 * Math.sin(i * 2 * Math.PI / 33)])],
    ["not pairs", [[0, 0, 0], [2, 0], [0, 2]]],
    ["nonfinite", [[0, 0], [2, 0], [0, Infinity]]],
    ["out of bounds", [[0, 0], [1001, 0], [0, 2]]],
    ["zero edge", [[0, 0], [2, 0], [2, 0], [0, 2]]],
    ["repeated vertex", [[0, 0], [3, 0], [3, 3], [0, 3], [3, 0]]],
    ["closed duplicate endpoint", [[0, 0], [2, 0], [0, 2], [0, 0]]],
    ["collinear zero area", [[0, 0], [1, 0], [2, 0]]],
    ["clockwise", [[0, 0], [0, 2], [2, 0]]],
    ["crossing", [[0, 0], [3, 3], [0, 3], [3, 0]]],
    ["crossing with positive winding", [[0, 0], [4, 0], [0, 4], [4, 4], [2, -1]]],
    ["touching nonadjacent edge", [[0, 0], [4, 0], [4, 4], [2, 4], [2, 0], [0, 4]]],
  ])("rejects %s before source custody", (_case, vertices) => {
    expect(() => source(vertices)).toThrow();
  });
  it("rejects unsupported plane, unknown fields, arbitrary text, second profile and polygon holes", () => {
    expect(() => appendFeatures(emptyFeatureSource(), [{ ...outline(notch), plane: "XZ" } as never])).toThrow();
    expect(() => appendFeatures(emptyFeatureSource(), [{ ...outline(notch), bogus: 1 } as never])).toThrow();
    const authored = source();
    expect(() => readFeatures({ ...authored, source: authored.source + "globalThis.bad = true;\n" })).toThrow();
    expect(() => readFeatures({ ...authored, source: authored.source.replace("part.polygon(", "part.polygon(\"vertices\":[] ,") })).toThrow();
    expect(() => appendFeatures(authored, [{ ...outline(notch), id: "second" }])).toThrow(/one profile/);
    expect(() => appendFeatures(authored, [{ kind: "hole", id: "hole", name: "Hole", bodyId: "body", x: 0, y: 0, diameter: 1, extent: "through" }])).toThrow(/Polygon holes/);
  });
});
