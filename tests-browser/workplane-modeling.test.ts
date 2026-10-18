// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import Module, { type ManifoldToplevel } from "manifold-3d";
import { appendFeatures, emptyFeatureSource, readFeatures, replaceFeature, type PartFeature, type ProfileFeature } from "../src/modeling/source";
import { evaluateFeatureSource } from "../src/modeling/evaluator";
import { assertFeatureEvaluation } from "../src/modeling/client";
import { resolveWorkplane } from "../src/modeling/workplanes";

let kernel: ManifoldToplevel;
beforeAll(async () => { kernel = await Module(); kernel.setup(); });
const rect = (plane: "XY" | "XZ" | "YZ"): ProfileFeature => ({ kind: "rectangle", id: "profile", name: "Outline", plane, width: 80, height: 50 });
const base: PartFeature = { kind: "extrude", id: "base", name: "Base", profileId: "profile", distance: 6 };
const authored = (...features: PartFeature[]) => appendFeatures(emptyFeatureSource(), features);
const mesh = (...features: PartFeature[]) => evaluateFeatureSource(authored(...features), kernel);

describe("bounded workplane solids", () => {
  it.each([
    ["XY", [0, 0, 0], [80, 50, 6]],
    ["XZ", [0, -6, 0], [80, 0, 50]],
    ["YZ", [0, 0, 0], [6, 80, 50]],
  ] as const)("measures %s principal frame from actual vertices", (plane, min, max) => {
    const result = mesh(rect(plane), base);
    expect(result.bounds).toEqual({ min, max });
    expect(result.volumeMm3).toBeCloseTo(24000, 5);
    expect(result.checks.every(check => check.passed)).toBe(true);
    assertFeatureEvaluation(authored(rect(plane), base), result);
  });
  it("resolves offset frames and reversed/symmetric extents", () => {
    expect(resolveWorkplane({ ...rect("XZ"), offset: 4 }, [rect("XZ")]).origin).toEqual([0, -4, 0]);
    expect(mesh({ ...rect("XY"), offset: 4 }, { ...base, direction: "reverse" }).bounds).toEqual({ min: [0, 0, -2], max: [80, 50, 4] });
    expect(mesh(rect("XY"), { ...base, direction: "symmetric" }).bounds).toEqual({ min: [0, 0, -3], max: [80, 50, 3] });
  });
  it("cuts a blind pocket on a named end cap", () => {
    const pocket: PartFeature = { kind: "circle", id: "pocket", name: "Pocket", plane: "XY", support: { kind: "extrusionCap", featureId: "base", side: "end" }, diameter: 10 };
    const cut: PartFeature = { kind: "extrude", id: "cut", name: "Cut", profileId: "pocket", targetBodyId: "base", operation: "cut", direction: "reverse", distance: 3, x: 20, y: 20 };
    const result = mesh(rect("XY"), base, pocket, cut);
    expect(result.bounds).toEqual({ min: [0, 0, 0], max: [80, 50, 6] });
    expect(result.volumeMm3).toBeCloseTo(24000 - Math.PI * 25 * 3, 1);
    expect(resolveWorkplane(pocket, [rect("XY"), base]).origin).toEqual([0, 0, 6]);
  });
  it("cuts through all actual target bounds instead of a fixed cutter length", () => {
    const hole: PartFeature = { kind: "circle", id: "hole", name: "Hole", plane: "XY", diameter: 10 };
    const cut: PartFeature = { kind: "extrude", id: "cut", name: "Cut", profileId: "hole", targetBodyId: "base", operation: "cut", endCondition: "throughAll", direction: "symmetric", x: 20, y: 25, z: 3, distance: 1 };
    const result = mesh(rect("XY"), base, hole, cut);
    expect(result.volumeMm3).toBeCloseTo(24000 - Math.PI * 25 * 6, 0);
    expect(result.bounds).toEqual({ min: [0, 0, 0], max: [80, 50, 6] });
  });
  it("moves a named cap boss when the parent depth changes, preserving IDs", () => {
    const boss: PartFeature = { kind: "rectangle", id: "bossProfile", name: "Boss", plane: "XY", support: { kind: "extrusionCap", featureId: "base", side: "end" }, width: 10, height: 10 };
    const add: PartFeature = { kind: "extrude", id: "boss", name: "Boss", profileId: "bossProfile", targetBodyId: "base", operation: "add", x: 20, y: 20, distance: 4 };
    const original = authored(rect("XY"), base, boss, add);
    const edited = replaceFeature(original, "base", { ...base, distance: 9 });
    expect(readFeatures(edited).map(f => f.id)).toEqual(readFeatures(original).map(f => f.id));
    expect(evaluateFeatureSource(edited, kernel).bounds.max[2]).toBe(13);
    expect(evaluateFeatureSource(original, kernel).bounds.max[2]).toBe(10);
  });
  it("rejects missing, forward and non-extrusion cap references with exact IDs", () => {
    const cap: ProfileFeature = { kind: "rectangle", id: "cap", name: "Cap", plane: "XY", width: 10, height: 10, support: { kind: "extrusionCap", featureId: "missing", side: "end" } };
    expect(() => authored(rect("XY"), base, cap)).toThrow(/cap.*missing/);
    expect(() => authored({ ...cap, support: { kind: "extrusionCap", featureId: "future", side: "end" } }, base)).toThrow(/cap.*future/);
    expect(() => authored(rect("XY"), base, { ...cap, support: { kind: "extrusionCap", featureId: "profile", side: "end" } })).toThrow(/cap.*profile/);
  });
  it("rejects through-all additions and bases", () => {
    expect(() => authored(rect("XY"), { ...base, endCondition: "throughAll" })).toThrow(/base.*throughAll/);
    expect(() => authored(rect("XY"), base, { ...rect("XY"), id: "second" }, { ...base, id: "add", profileId: "second", targetBodyId: "base", operation: "add", endCondition: "throughAll" })).toThrow(/add.*throughAll/);
  });
  it("keeps legacy source bytes unchanged", () => {
    const old = authored(rect("XY"), base);
    expect(old.source).toBe('// Piton browser-typescript/v1; units=mm; restricted named-feature source\npart.rectangle({"id":"profile","name":"Outline","plane":"XY","width":80,"height":50});\npart.extrude({"id":"base","name":"Base","profileId":"profile","distance":6});\n');
    expect(authored(...readFeatures(old)).source).toBe(old.source);
  });
});
