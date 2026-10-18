// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import Module, { type ManifoldToplevel } from "manifold-3d";
import { appendFeatures, emptyFeatureSource, readFeatures, replaceFeature, type PartFeature } from "../src/modeling/source";
import { evaluateFeatureSource } from "../src/modeling/evaluator";
import { assertFeatureEvaluation } from "../src/modeling/client";

let kernel: ManifoldToplevel;
beforeAll(async () => { kernel = await Module(); kernel.setup(); });
const outline: PartFeature = { kind: "rectangle", id: "outline", name: "Base", plane: "XY", width: 80, height: 50 };
const base: PartFeature = { kind: "extrude", id: "base", name: "Base solid", profileId: "outline", distance: 6 };
const pocket: PartFeature = { kind: "circle", id: "pocket", name: "Pocket", plane: "XY", diameter: 10 };
const cut: PartFeature = { kind: "extrude", id: "cut", name: "Pocket cut", profileId: "pocket", targetBodyId: "base", operation: "cut", x: 20, y: 20, z: 3, distance: 3 };
const boss: PartFeature = { kind: "rectangle", id: "bossProfile", name: "Boss", plane: "XY", width: 10, height: 10 };
const add: PartFeature = { kind: "extrude", id: "boss", name: "Boss solid", profileId: "bossProfile", targetBodyId: "base", operation: "add", x: 20, y: 20, z: 6, distance: 4 };
const source = (...features: PartFeature[]) => appendFeatures(emptyFeatureSource(), features);

describe("ordered named Part solids", () => {
  it("cuts a located blind pocket using real WASM geometry and preserves review truth", () => {
    const authored = source(outline, base, pocket, cut);
    expect(readFeatures(authored)).toEqual([outline, base, pocket, cut]);
    const mesh = evaluateFeatureSource(authored, kernel);
    expect(mesh.bounds).toEqual({ min: [0, 0, 0], max: [80, 50, 6] });
    expect(mesh.volumeMm3).toBeCloseTo(24000 - Math.PI * 25 * 3, 1);
    expect(mesh.checks.every(c => c.passed)).toBe(true);
    expect(mesh.fabricationRelease).toBe(false);
    expect(mesh.machineActuation).toBe(false);
    assertFeatureEvaluation(authored, mesh);
  });
  it("unions a boss on the top cap into one connected body", () => {
    const authored = source(outline, base, boss, add);
    const mesh = evaluateFeatureSource(authored, kernel);
    expect(mesh.bounds).toEqual({ min: [0, 0, 0], max: [80, 50, 10] });
    expect(mesh.volumeMm3).toBeCloseTo(24400, 3);
    assertFeatureEvaluation(authored, mesh);
  });
  it("rebuilds downstream stable IDs after a profile or base edit", () => {
    const original = source(outline, base, pocket, cut);
    const wider = replaceFeature(original, "outline", { ...outline, width: 90 });
    const thinner = replaceFeature(original, "base", { ...base, distance: 5 });
    expect(readFeatures(wider).map(f => f.id)).toEqual(readFeatures(original).map(f => f.id));
    expect(evaluateFeatureSource(wider, kernel).volumeMm3 - evaluateFeatureSource(original, kernel).volumeMm3).toBeCloseTo(3000, 2);
    expect(evaluateFeatureSource(thinner, kernel).volumeMm3).toBeLessThan(evaluateFeatureSource(original, kernel).volumeMm3);
  });
  it("rejects missing and forward profile/body references with offending ID", () => {
    expect(() => source(outline, base, { ...cut, profileId: "missing" })).toThrow(/missing/);
    expect(() => source(outline, base, { ...cut, targetBodyId: "missing" })).toThrow(/missing/);
    expect(() => source(outline, base, cut, pocket)).toThrow(/pocket/);
    expect(() => source(outline, pocket, { ...cut, targetBodyId: "future" }, base)).toThrow(/future/);
  });
  it("rejects nonintersecting cuts and disconnected additions", () => {
    expect(() => evaluateFeatureSource(source(outline, base, pocket, { ...cut, x: 200 }), kernel)).toThrow(/cut|intersect/i);
    expect(() => evaluateFeatureSource(source(outline, base, boss, { ...add, x: 200 }), kernel)).toThrow(/connect|disjoint|intersect/i);
  });
  it("keeps legacy canonical bytes on roundtrip", () => {
    const old = source(outline, base);
    expect(old.source).toBe('// Piton browser-typescript/v1; units=mm; restricted named-feature source\npart.rectangle({"id":"outline","name":"Base","plane":"XY","width":80,"height":50});\npart.extrude({"id":"base","name":"Base solid","profileId":"outline","distance":6});\n');
    expect(source(...readFeatures(old)).source).toBe(old.source);
  });
});
