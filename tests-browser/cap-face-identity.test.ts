// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import Module, { type ManifoldToplevel } from "manifold-3d";
import { enumerateSurvivingCaps } from "../src/modeling/capFaces";
import { evaluateFeatureSource } from "../src/modeling/evaluator";
import { appendFeatures, emptyFeatureSource, type PartFeature, type ProfileFeature } from "../src/modeling/source";

let kernel: ManifoldToplevel;
beforeAll(async () => { kernel = await Module(); kernel.setup(); });
const outline: ProfileFeature = { kind: "rectangle", id: "outline", name: "Outline", plane: "XY", width: 20, height: 20 };
const base: PartFeature = { kind: "extrude", id: "base", name: "Base", profileId: "outline", distance: 6 };
const extension: ProfileFeature = { ...outline, id: "extensionProfile", name: "Extension" };
const add: PartFeature = { kind: "extrude", id: "extension", name: "Extension solid", profileId: "extensionProfile", targetBodyId: "base", operation: "add", distance: 6, x: 20 };
const support: ProfileFeature = { kind: "rectangle", id: "support", name: "Supported boss", plane: "XY", width: 2, height: 2, origin: [25, 5], support: { kind: "extrusionCap", featureId: "base", side: "end" } };
const boss: PartFeature = { kind: "extrude", id: "boss", name: "Boss", profileId: "support", targetBodyId: "extension", operation: "add", distance: 2 };
const source = (...features: PartFeature[]) => appendFeatures(emptyFeatureSource(), features);
const evaluate = (...features: PartFeature[]) => evaluateFeatureSource(source(...features), kernel);

describe("named cap footprint identity on WASM mesh", () => {
  it("does not claim adjoining or straddling coplanar triangles as base:end", () => {
    const authored = source(outline, base, extension, add);
    const mesh = evaluateFeatureSource(authored, kernel);
    const cap = enumerateSurvivingCaps(authored, mesh).find(c => c.featureId === "base" && c.side === "end");
    expect(cap).toBeDefined();
    expect(cap!.triangleIndices.length).toBeGreaterThan(0);
    for (const ordinal of cap!.triangleIndices) {
      const xs = mesh.triangles.slice(ordinal * 3, ordinal * 3 + 3).map(index => mesh.vertices[index * 3]);
      expect(Math.max(...xs)).toBeLessThanOrEqual(20.00001);
    }
    expect(() => evaluate(outline, base, extension, add, support, boss)).toThrow(/support.*base.*(outside|cap)/i);
  });
  it("accepts contained rectangle, circle and polygon supports and rejects a boundary crossing", () => {
    const contained: ProfileFeature[] = [
      { ...support, origin: [5, 5] },
      { kind: "circle", id: "support", name: "Circle", plane: "XY", diameter: 2, origin: [10, 10], support: support.support },
      { kind: "polygon", id: "support", name: "Polygon", plane: "XY", vertices: [[4, 4], [6, 4], [5, 6]], support: support.support },
    ];
    for (const profile of contained) {
      expect(evaluate(outline, base, profile, { ...boss, targetBodyId: "base" }).bounds.max[2]).toBe(8);
    }
    expect(() => evaluate(outline, base, { ...support, origin: [19, 5] }, { ...boss, targetBodyId: "base" }))
      .toThrow(/footprint outside/);
  });
  it("checks the translated consuming footprint and normal contact, not raw sketch coordinates", () => {
    const pocket: ProfileFeature = { kind: "circle", id: "pocket", name: "Pocket", plane: "XY", diameter: 4,
      support: { kind: "extrusionCap", featureId: "base", side: "end" } };
    const cut: PartFeature = { kind: "extrude", id: "cut", name: "Cut", profileId: "pocket", targetBodyId: "base",
      operation: "cut", direction: "reverse", distance: 2, x: 10, y: 10 };
    expect(evaluate(outline, base, pocket, cut).volumeMm3).toBeLessThan(evaluate(outline, base).volumeMm3);
    // The raw rectangle is inside, but its consuming placement is not.
    const inside: ProfileFeature = { ...support, origin: [5, 5] };
    expect(() => evaluate(outline, base, inside, { ...boss, targetBodyId: "base", x: 20 })).toThrow(/footprint outside/);
    expect(() => evaluate(outline, base, pocket, { ...cut, x: 24 })).toThrow(/footprint outside/);
    expect(() => evaluate(outline, base, inside, { ...boss, targetBodyId: "base", z: 3 })).toThrow(/extrusion displaced/);
    expect(() => evaluate(outline, base, inside, { ...boss, targetBodyId: "base", z: -3 })).toThrow(/extrusion displaced/);
    expect(() => evaluate(outline, base, pocket, { ...cut, z: -3 })).toThrow(/extrusion displaced/);
  });
  it("admits an edge-open cut only where its placed material overlaps the named cap", () => {
    const pocket: ProfileFeature = { kind: "circle", id: "pocket", name: "Edge pocket", plane: "XY", diameter: 4,
      support: { kind: "extrusionCap", featureId: "base", side: "end" } };
    const cut: PartFeature = { kind: "extrude", id: "cut", name: "Cut", profileId: "pocket", targetBodyId: "base",
      operation: "cut", direction: "reverse", distance: 2 };
    expect(evaluate(outline, base, pocket, cut).volumeMm3).toBeLessThan(evaluate(outline, base).volumeMm3);
    expect(() => evaluate(outline, base, pocket, { ...cut, x: 24 })).toThrow(/footprint outside/);
    // Material on an adjoining extension cannot support a cut naming base:end.
    expect(() => evaluate(outline, base, extension, add, pocket, { ...cut, targetBodyId: "extension", x: 25, y: 5 }))
      .toThrow(/footprint outside/);
  });
  it("does not count an annular cutter's void as cap intersection", () => {
    const small: ProfileFeature = { ...outline, origin: [9, 9], width: 2, height: 2 };
    const annulus: ProfileFeature = { kind: "circle", id: "ring", name: "Ring cutter", plane: "XY", diameter: 12,
      innerDiameter: 8, origin: [10, 10], support: { kind: "extrusionCap", featureId: "base", side: "end" } };
    const cut: PartFeature = { kind: "extrude", id: "cut", name: "Cut", profileId: "ring", targetBodyId: "base",
      operation: "cut", direction: "reverse", distance: 2 };
    expect(() => evaluate(small, base, annulus, cut)).toThrow(/holed cutter cap overlap cannot be proven/);
    // The bounded admission cannot certify holed cutter material even on a
    // broad cap, so it must not grant a false positive from its outer ring.
    expect(() => evaluate(outline, base, annulus, cut)).toThrow(/holed cutter cap overlap cannot be proven/);
  });
  it("rejects support crossing a concave notch or a surviving cap hole", () => {
    const concave: ProfileFeature = { kind: "polygon", id: "outline", name: "Concave base", plane: "XY",
      vertices: [[0, 0], [20, 0], [20, 8], [8, 8], [8, 20], [0, 20]] };
    expect(() => evaluate(concave, base, { ...support, origin: [7, 7] }, { ...boss, targetBodyId: "base" }))
      .toThrow(/footprint outside/);
    const hole: ProfileFeature = { kind: "circle", id: "hole", name: "Hole", plane: "XY", diameter: 4, origin: [10, 10] };
    const cut: PartFeature = { kind: "extrude", id: "cut", name: "Through cut", profileId: "hole", targetBodyId: "base", operation: "cut", endCondition: "throughAll", direction: "symmetric", distance: 1 };
    expect(() => evaluate(outline, base, hole, cut, { ...support, origin: [9, 9] }, { ...boss, targetBodyId: "cut" }))
      .toThrow(/footprint outside/);
  });
  it("keeps named circle and XZ cap supports in their parent frame", () => {
    const round: ProfileFeature = { kind: "circle", id: "outline", name: "Round base", plane: "XY", diameter: 20 };
    const roundCap: ProfileFeature = { ...support, origin: [-1, -1] };
    expect(evaluate(round, base, roundCap, { ...boss, targetBodyId: "base" }).bounds.max[2]).toBe(8);
    expect(() => evaluate(round, base, { ...support, origin: [9, 0] }, { ...boss, targetBodyId: "base" })).toThrow(/footprint outside/);
    const xz: ProfileFeature = { ...outline, plane: "XZ" };
    const xzCap: ProfileFeature = { ...support, plane: "XZ", origin: [5, 5] };
    expect(evaluate(xz, base, xzCap, { ...boss, targetBodyId: "base" }).bounds.min[1]).toBe(-8);
    const reverse: PartFeature = { ...base, direction: "reverse" };
    const start: ProfileFeature = { ...support, origin: [-7, 5], support: { kind: "extrusionCap", featureId: "base", side: "start" } };
    expect(evaluate(outline, reverse, start, { ...boss, targetBodyId: "base" }).bounds.min[2]).toBe(-8);
  });
});
