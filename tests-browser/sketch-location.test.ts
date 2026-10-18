// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import Module, { type ManifoldToplevel } from "manifold-3d";
import { appendFeatures, emptyFeatureSource, isOrderedSource, readFeatures, type PartFeature } from "../src/modeling/source";
import { evaluateFeatureSource } from "../src/modeling/evaluator";
import { analyzeSketch } from "../src/modeling/sketchConstraints";
import { reduceSketchDraft, reopenSketchProfile, sketchPreview, sketchSource, type SketchContext } from "../src/modeling/sketchDraft";

let kernel: ManifoldToplevel;
beforeAll(async () => { kernel = await Module(); kernel.setup(); });
const context: SketchContext = { projectId: "p", documentId: "d", revisionId: null };
const start = (plane: "XY" | "XZ" = "XY") => reduceSketchDraft(null, { type: "newSketch", context, draftId: "draft", plane });
const move = (draft: ReturnType<typeof start>, point: readonly [number, number]) => reduceSketchDraft(draft, { type: "move", context, entityId: "sketchProfile", point });
const finish = (draft: ReturnType<typeof start>) => sketchSource(reduceSketchDraft(draft, { type: "finishSketch", context }), context);
const extrude = (profileId = "sketchProfile"): PartFeature => ({ kind: "extrude", id: "body", name: "Body", profileId, distance: 6 });

describe("authored sketch local location", () => {
  it.each([
    ["XY", [14, 14, 0], [26, 26, 6]],
    ["XZ", [14, -6, 14], [26, 0, 26]],
  ] as const)("moves a free circle on %s through source into actual WASM bounds", (plane, min, max) => {
    const drawn = reduceSketchDraft(start(plane), { type: "circle", context, diameter: 12 });
    const source = finish(move(drawn, [20, 20]));
    expect(readFeatures(source)[0]).toMatchObject({ origin: [20, 20] });
    expect(isOrderedSource(readFeatures(source))).toBe(true);
    const solid = evaluateFeatureSource(appendFeatures(source, [extrude()]), kernel);
    expect(solid.bounds.min).toEqual(min);
    expect(solid.bounds.max).toEqual(max);
  });
  it("roundtrips a moved rectangle into reopened preview and actual solid bounds", () => {
    const drawn = reduceSketchDraft(start(), { type: "rectangle", context, width: 20, height: 10 });
    const authored = finish(move(drawn, [4, 5]));
    const reopened = reopenSketchProfile(authored, "sketchProfile", context, "edit");
    expect(reopened.position).toEqual([4, 5]);
    expect(sketchPreview(reopened, context)?.outline).toEqual([[4, 5], [24, 5], [24, 15], [4, 15]]);
    expect(evaluateFeatureSource(appendFeatures(authored, [extrude()]), kernel).bounds).toEqual({ min: [4, 5, 0], max: [24, 15, 6] });
  });
  it("persists driving local coordinates and rejects contradictory raw source", () => {
    let draft = reduceSketchDraft(start(), { type: "circle", context, diameter: 10 });
    draft = reduceSketchDraft(draft, { type: "addConstraint", context, constraint: { id: "x", kind: "dimension", target: "centerX", value: 8 } });
    draft = reduceSketchDraft(draft, { type: "addConstraint", context, constraint: { id: "y", kind: "dimension", target: "centerY", value: 9 } });
    const authored = finish(draft);
    expect(readFeatures(authored)[0]).toMatchObject({ origin: [8, 9], sketchIntent: { constraints: [{ target: "centerX", value: 8 }, { target: "centerY", value: 9 }] } });
    expect(reopenSketchProfile(authored, "sketchProfile", context, "edit").position).toEqual([8, 9]);
    expect(() => readFeatures({ ...authored, source: authored.source.replace('"origin":[8,9]', '"origin":[7,9]') })).toThrow(/dimension|conflict/i);
  });
  it("rejects nonzero authored location with origin constraint, including raw source", () => {
    const drawn = reduceSketchDraft(start(), { type: "rectangle", context, width: 4, height: 5 });
    const anchored = reduceSketchDraft(drawn, { type: "addConstraint", context, constraint: { id: "origin", kind: "origin" } });
    const authored = finish(anchored);
    expect(() => readFeatures({ ...authored, source: authored.source.replace('"plane":"XY"', '"plane":"XY","origin":[4,5]') })).toThrow(/origin|conflict/i);
  });
  it("keeps legacy source bytes unchanged when location is omitted", () => {
    const authored = finish(reduceSketchDraft(start(), { type: "rectangle", context, width: 4, height: 5 }));
    expect(authored.source).toBe('// Piton browser-typescript/v1; units=mm; restricted named-feature source\npart.rectangle({"id":"sketchProfile","name":"Sketch profile","plane":"XY","width":4,"height":5});\n');
  });
  it("does not reroute dimension-only legacy plates with holes", () => {
    const plate = { kind: "rectangle", id: "plate", name: "Plate", plane: "XY", width: 40, height: 30,
      sketchIntent: { constraints: [{ id: "width", kind: "dimension", target: "width", value: 40 }] } } as const;
    const authored = appendFeatures(emptyFeatureSource(), [plate, { kind: "extrude", id: "body", name: "Body", profileId: "plate", distance: 6 },
      { kind: "hole", id: "hole", name: "Hole", bodyId: "body", x: 20, y: 15, diameter: 4, extent: "through" }]);
    expect(isOrderedSource(readFeatures(authored))).toBe(false);
    expect(evaluateFeatureSource(authored, kernel).volumeMm3).toBeLessThan(7200);
  });
  it("cuts a supported end cap with an offset local circle center", () => {
    const base = appendFeatures(emptyFeatureSource(), [
      { kind: "rectangle", id: "outline", name: "Outline", plane: "XY", width: 80, height: 50 },
      { kind: "extrude", id: "base", name: "Base", profileId: "outline", distance: 6 },
    ]);
    const cap = { kind: "circle", id: "pocket", name: "Pocket", plane: "XY", support: { kind: "extrusionCap", featureId: "base", side: "end" }, origin: [20, 20], diameter: 10 } as const;
    const authored = appendFeatures(base, [cap, { kind: "extrude", id: "cut", name: "Cut", profileId: "pocket", targetBodyId: "base", operation: "cut", direction: "reverse", distance: 3 }]);
    const solid = evaluateFeatureSource(authored, kernel);
    expect(solid.bounds).toEqual({ min: [0, 0, 0], max: [80, 50, 6] });
    expect(solid.volumeMm3).toBeCloseTo(24000 - Math.PI * 25 * 3, 1);
  });
  it("keeps earlier drafts immutable across two moves and validates fixed positions", () => {
    const original = reduceSketchDraft(start(), { type: "rectangle", context, width: 10, height: 5 });
    const first = move(original, [4, 5]);
    const second = move(first, [6, 7]);
    expect(original.position).toEqual([0, 0]);
    expect(first.position).toEqual([4, 5]);
    expect(second.profile).toMatchObject({ origin: [6, 7] });
    const fixed = reduceSketchDraft(first, { type: "addConstraint", context, constraint: { id: "fixed", kind: "fixedProfile" } });
    expect(analyzeSketch(fixed)).toMatchObject({ status: "fullyDefined" });
    expect(readFeatures(finish(fixed))[0]).toMatchObject({ origin: [4, 5] });
    expect(() => move(fixed, [6, 7])).toThrow();
  });
});
