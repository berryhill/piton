// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import Module, { type ManifoldToplevel } from "manifold-3d";
import { appendFeatures, emptyFeatureSource, readFeatures, type PartFeature } from "../src/modeling/source";
import { reduceSketchDraft, sketchSource, type SketchContext } from "../src/modeling/sketchDraft";
import { evaluateFeatureSource } from "../src/modeling/evaluator";

const context: SketchContext = { projectId: "p", documentId: "d", revisionId: null };
const start = () => reduceSketchDraft(null, { type: "newSketch", context, draftId: "d", plane: "XY" });
const polygon = () => {
  let state = start();
  for (const point of [[0, 0], [5, 1], [6, 5], [0, 4]] as const) state = reduceSketchDraft(state, { type: "linePoint", context, point });
  return reduceSketchDraft(state, { type: "closeLine", context });
};
const constrain = (state: ReturnType<typeof polygon>, constraint: Parameters<typeof reduceSketchDraft>[1] & { type: "addConstraint" }) => reduceSketchDraft(state, constraint);

describe("fixed sketch relation admission", () => {
  it("captures fixed coordinate and rejects a later horizontal relation atomically", () => {
    const fixed = constrain(polygon(), { type: "addConstraint", context, constraint: { id: "pin", kind: "fixedPoint", vertex: 1 } });
    expect(fixed.profile?.sketchIntent?.constraints).toContainEqual({ id: "pin", kind: "fixedPoint", vertex: 1, point: [5, 1] });
    const before = structuredClone(fixed);
    expect(() => constrain(fixed, { type: "addConstraint", context, constraint: { id: "horizontal", kind: "horizontal", edge: 0 } })).toThrow(/fixed|conflict/i);
    expect(fixed).toEqual(before);
    expect(() => reduceSketchDraft(fixed, { type: "dimension", context, target: "vertexY", index: 1, value: 0 })).toThrow();
  });
  it("rejects raw source contradicting captured fixed point and preserves legacy bytes", () => {
    const fixed = constrain(polygon(), { type: "addConstraint", context, constraint: { id: "pin", kind: "fixedPoint", vertex: 1 } });
    const authored = sketchSource(reduceSketchDraft(fixed, { type: "finishSketch", context }), context);
    const tampered = { ...authored, source: authored.source.replace('[[0,0],[5,1]', '[[0,0],[5,0]') };
    expect(() => readFeatures(tampered)).toThrow(/fixed|conflict/i);
    const legacyProfile = { ...fixed.profile!, sketchIntent: { constraints: [{ id: "pin", kind: "fixedPoint" as const, vertex: 1 }] } };
    const legacy = appendFeatures(emptyFeatureSource(), [legacyProfile]);
    expect(appendFeatures(emptyFeatureSource(), readFeatures(legacy)).source).toBe(legacy.source);
    expect(() => constrain({ ...fixed, profile: legacyProfile }, { type: "addConstraint", context, constraint: { id: "horizontal", kind: "horizontal", edge: 0 } })).toThrow(/fixed|conflict/i);
  });
  it("preserves shape origin and drivers on same-kind reapplication; requires clear to switch kind", () => {
    let state = reduceSketchDraft(start(), { type: "rectangle", context, width: 20, height: 10 });
    state = reduceSketchDraft(state, { type: "move", context, entityId: "sketchProfile", point: [4, 5] });
    state = constrain(state, { type: "addConstraint", context, constraint: { id: "w", kind: "dimension", target: "width", value: 20 } });
    const same = reduceSketchDraft(state, { type: "rectangle", context, width: 20, height: 12 });
    expect(same.profile).toMatchObject({ origin: [4, 5], sketchIntent: { constraints: [{ id: "w", kind: "dimension", target: "width", value: 20 }] } });
    expect(() => reduceSketchDraft(state, { type: "rectangle", context, width: 21, height: 10 })).toThrow();
    expect(() => reduceSketchDraft(state, { type: "circle", context, diameter: 10 })).toThrow(/constraint|clear/i);
    const circle = reduceSketchDraft(start(), { type: "circle", context, diameter: 10 });
    const located = reduceSketchDraft(circle, { type: "move", context, entityId: "sketchProfile", point: [2, 3] });
    expect(reduceSketchDraft(located, { type: "circle", context, diameter: 12 }).profile).toMatchObject({ origin: [2, 3] });
  });
});

let kernel: ManifoldToplevel;
beforeAll(async () => { kernel = await Module(); kernel.setup(); });
const source = (...features: PartFeature[]) => appendFeatures(emptyFeatureSource(), features);
const body: PartFeature = { kind: "rectangle", id: "baseProfile", name: "Base", plane: "XY", width: 20, height: 20 };
const base: PartFeature = { kind: "extrude", id: "base", name: "Body", profileId: "baseProfile", distance: 6 };
const tool: PartFeature = { kind: "rectangle", id: "tool", name: "Tool", plane: "XY", width: 4, height: 4, origin: [8, 8] };
const cut: PartFeature = { kind: "extrude", id: "cut", name: "Cut", profileId: "tool", targetBodyId: "base", operation: "cut", endCondition: "throughAll", direction: "forward", distance: 1 };

describe("throughAll directional halfspace in real WASM", () => {
  it("does not reach behind a plane at z=10; reverse and symmetric cut", () => {
    const make = (direction: "forward" | "reverse" | "symmetric") => source(body, base, tool, { ...cut, z: 10, direction });
    expect(() => evaluateFeatureSource(make("forward"), kernel)).toThrow(/intersect|extent/i);
    for (const direction of ["reverse", "symmetric"] as const) {
      const mesh = evaluateFeatureSource(make(direction), kernel);
      expect(mesh.bounds).toEqual({ min: [0, 0, 0], max: [20, 20, 6] });
      expect(mesh.volumeMm3).toBeCloseTo(2304, 2);
    }
  });
  it("honors each principal plane normal in positive and negative directions", () => {
    const cases = [
      { plane: "XY" as const, offset: { z: 10 }, origin: [8, 8] as const, volume: 2304, opposite: { z: -4 } },
      { plane: "XZ" as const, offset: { y: -10 }, origin: [8, 1] as const, volume: 2080, opposite: { y: 30 } },
      { plane: "YZ" as const, offset: { x: 30 }, origin: [8, 1] as const, volume: 2080, opposite: { x: -4 } },
    ];
    for (const { plane, offset, origin, volume, opposite } of cases) {
      const profile: PartFeature = { ...tool, plane, origin };
      expect(() => evaluateFeatureSource(source(body, base, profile, { ...cut, ...offset, direction: "forward" }), kernel)).toThrow(/intersect|extent/i);
      const reverse = evaluateFeatureSource(source(body, base, profile, { ...cut, ...offset, direction: "reverse" }), kernel);
      expect(reverse.bounds).toEqual({ min: [0, 0, 0], max: [20, 20, 6] });
      expect(reverse.volumeMm3).toBeCloseTo(volume, 2);
      expect(() => evaluateFeatureSource(source(body, base, profile, { ...cut, ...opposite, direction: "reverse" }), kernel)).toThrow(/intersect|extent/i);
      expect(evaluateFeatureSource(source(body, base, profile, { ...cut, ...opposite, direction: "forward" }), kernel).volumeMm3).toBeCloseTo(volume, 2);
    }
  });
});
