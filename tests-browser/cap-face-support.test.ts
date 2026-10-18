// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import Module, { type ManifoldToplevel } from "manifold-3d";
import { appendFeatures, emptyFeatureSource, readFeatures, replaceFeature, type PartFeature, type ProfileFeature } from "../src/modeling/source";
import { evaluateFeatureSource } from "../src/modeling/evaluator";
import { enumerateSurvivingCaps } from "../src/modeling/capFaces";

let kernel: ManifoldToplevel;
beforeAll(async () => { kernel = await Module(); kernel.setup(); });
const outline: ProfileFeature = { kind: "rectangle", id: "outline", name: "Outline", plane: "XY", width: 20, height: 20 };
const base: PartFeature = { kind: "extrude", id: "base", name: "Base", profileId: "outline", distance: 6 };
const cap: ProfileFeature = { kind: "rectangle", id: "onCap", name: "On cap", plane: "XY", width: 2, height: 2, support: { kind: "extrusionCap", featureId: "base", side: "end" } };
const boss: PartFeature = { kind: "extrude", id: "boss", name: "Boss", profileId: "onCap", targetBodyId: "base", operation: "add", distance: 2, x: 4, y: 4 };
const source = (...features: PartFeature[]) => appendFeatures(emptyFeatureSource(), features);
const evaluate = (...features: PartFeature[]) => evaluateFeatureSource(source(...features), kernel);
const cutProfile: ProfileFeature = { kind: "rectangle", id: "tool", name: "Tool", plane: "XY", width: 2, height: 20, origin: [9, 0] };
const splitter: PartFeature = { kind: "extrude", id: "split", name: "Split top", profileId: "tool", targetBodyId: "base", operation: "cut", direction: "reverse", distance: 2, z: 6 };

describe("surviving extrusion cap admission", () => {
  it("enumerates both actual oriented caps with ephemeral triangle hints", () => {
    const authored = source(outline, base);
    const candidates = enumerateSurvivingCaps(authored, evaluateFeatureSource(authored, kernel));
    expect(candidates.map(c => [c.featureId, c.side, c.frame.normal])).toEqual([
      ["base", "start", [0, 0, -1]], ["base", "end", [0, 0, 1]],
    ]);
    expect(candidates.every(c => c.triangleIndices.length > 0)).toBe(true);
    expect(candidates.every(c => c.triangleIndices.every(i => Number.isInteger(i)))).toBe(true);
    expect(evaluate(outline, base, cap, boss).bounds.max[2]).toBe(8);
  });
  it("does not admit a through-all cut as a cap parent", () => {
    const tool: ProfileFeature = { ...cutProfile, width: 2, height: 2, origin: [4, 4] };
    const through: PartFeature = { ...splitter, endCondition: "throughAll", direction: "symmetric", distance: 1, profileId: "tool" };
    expect(() => source(outline, base, tool, through, { ...cap, support: { kind: "extrusionCap", featureId: "split", side: "end" } })).toThrow(/onCap.*split/);
  });
  it("rejects an entirely removed cap after a subsequent cut", () => {
    const tool: ProfileFeature = { ...cutProfile, width: 20, height: 20, origin: [0, 0] };
    const removeTop: PartFeature = { ...splitter, distance: 2 };
    const authored = source(outline, base, tool, removeTop);
    expect(enumerateSurvivingCaps(authored, evaluateFeatureSource(authored, kernel)).some(c => c.featureId === "base" && c.side === "end")).toBe(false);
    expect(() => evaluate(outline, base, tool, removeTop, cap, { ...boss, targetBodyId: "split" })).toThrow(/onCap.*base.*missing/i);
  });
  it("rejects a top cap wholly covered by a later boss, not its internal plane", () => {
    const cover: ProfileFeature = { ...outline, id: "cover" };
    const add: PartFeature = { kind: "extrude", id: "coverBoss", name: "Cover", profileId: "cover", targetBodyId: "base", operation: "add", distance: 2, z: 6 };
    const authored = source(outline, base, cover, add);
    expect(enumerateSurvivingCaps(authored, evaluateFeatureSource(authored, kernel)).some(c => c.featureId === "base" && c.side === "end")).toBe(false);
    expect(() => evaluate(outline, base, cover, add, cap, { ...boss, targetBodyId: "coverBoss" })).toThrow(/onCap.*base.*missing/i);
  });
  it("rejects two top-cap regions despite connected body beneath", () => {
    const authored = source(outline, base, cutProfile, splitter);
    expect(enumerateSurvivingCaps(authored, evaluateFeatureSource(authored, kernel)).some(c => c.featureId === "base" && c.side === "end")).toBe(false);
    expect(() => evaluate(outline, base, cutProfile, splitter, cap, { ...boss, targetBodyId: "split" })).toThrow(/onCap.*base.*ambiguous/i);
  });
  it("accepts a connected ring surrounding a through hole", () => {
    const hole: ProfileFeature = { kind: "circle", id: "hole", name: "Hole", plane: "XY", diameter: 4, origin: [10, 10] };
    const through: PartFeature = { ...splitter, profileId: "hole", endCondition: "throughAll", direction: "symmetric", distance: 1, z: 3 };
    const authored = source(outline, base, hole, through);
    expect(enumerateSurvivingCaps(authored, evaluateFeatureSource(authored, kernel)).some(c => c.featureId === "base" && c.side === "end")).toBe(true);
    expect(evaluate(outline, base, hole, through, cap, { ...boss, targetBodyId: "split" }).bounds.max[2]).toBe(8);
  });
  it("relocates stable semantic support after a parent depth edit", () => {
    const original = source(outline, base, cap, boss);
    const edited = replaceFeature(original, "base", { ...base, distance: 9 });
    expect(readFeatures(edited).map(f => f.id)).toEqual(readFeatures(original).map(f => f.id));
    const candidates = enumerateSurvivingCaps(edited, evaluateFeatureSource(edited, kernel));
    expect(candidates.find(c => c.featureId === "base" && c.side === "end")?.frame.origin).toEqual([0, 0, 9]);
    expect(evaluateFeatureSource(edited, kernel).bounds.max[2]).toBe(11);
  });
  it("uses actual cap orientation for reverse and symmetric extents", () => {
    const reversed = source(outline, { ...base, direction: "reverse" });
    const symmetric = source(outline, { ...base, direction: "symmetric" });
    for (const authored of [reversed, symmetric]) {
      const caps = enumerateSurvivingCaps(authored, evaluateFeatureSource(authored, kernel));
      expect(caps.map(c => c.frame.normal)).toEqual([[0, 0, -1], [0, 0, 1]]);
    }
  });
  it("checks the actual parent cap before a support offset, and binds candidates to source", () => {
    const offsetCap: ProfileFeature = { ...cap, offset: 2 };
    const authored = source(outline, base);
    expect(enumerateSurvivingCaps(authored, evaluateFeatureSource(authored, kernel)).find(c => c.side === "end")?.frame.origin).toEqual([0, 0, 6]);
    expect(() => enumerateSurvivingCaps(source(outline, { ...base, distance: 9 }), evaluateFeatureSource(authored, kernel))).toThrow(/does not match source/);
    expect(evaluate(outline, base, offsetCap, { ...boss, z: -2 }).bounds.max[2]).toBe(8);
  });
});
