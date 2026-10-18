// @vitest-environment node
import { describe, expect, it } from "vitest";
import { reduceSketchDraft, sketchPreview, sketchSource, type SketchContext } from "../src/modeling/sketchDraft";
import { readFeatures } from "../src/modeling/source";
import { analyzeSketch } from "../src/modeling/sketchConstraints";

const context: SketchContext = { projectId: "p", documentId: "d", revisionId: null };
const start = () => reduceSketchDraft(null, { type: "newSketch", context, draftId: "draft", plane: "XY" });
const rect = () => reduceSketchDraft(start(), { type: "rectangle", context, width: 20, height: 10 });
const add = (state: ReturnType<typeof rect>, constraint: Parameters<typeof reduceSketchDraft>[1] & { type: "addConstraint" }) => reduceSketchDraft(state, constraint);

describe("bounded sketch constraint intent", () => {
  it("does not mistake drawn numeric geometry or Finish for fully defined", () => {
    const drawn = rect();
    expect(analyzeSketch(drawn).status).toBe("underdefined");
    expect(analyzeSketch(reduceSketchDraft(drawn, { type: "finishSketch", context })).status).toBe("underdefined");
    const anchored = add(drawn, { type: "addConstraint", context, constraint: { id: "origin", kind: "origin" } });
    const width = add(anchored, { type: "addConstraint", context, constraint: { id: "w", kind: "dimension", target: "width", value: 20 } });
    const height = add(width, { type: "addConstraint", context, constraint: { id: "h", kind: "dimension", target: "height", value: 10 } });
    expect(analyzeSketch(height)).toMatchObject({ status: "fullyDefined", degreesOfFreedom: 0 });
    expect(readFeatures(sketchSource(reduceSketchDraft(height, { type: "finishSketch", context }), context))[0]).toMatchObject({ sketchIntent: { constraints: [
      { id: "origin", kind: "origin" }, { id: "w", kind: "dimension", target: "width", value: 20 }, { id: "h", kind: "dimension", target: "height", value: 10 },
    ] } });
  });
  it("anchors circle center and diameter, rejects duplicate/conflicting additions atomically", () => {
    const circle = reduceSketchDraft(start(), { type: "circle", context, diameter: 12 });
    const anchored = reduceSketchDraft(circle, { type: "addConstraint", context, constraint: { id: "origin", kind: "origin" } });
    const driven = reduceSketchDraft(anchored, { type: "addConstraint", context, constraint: { id: "d", kind: "dimension", target: "diameter", value: 12 } });
    expect(analyzeSketch(driven).status).toBe("fullyDefined");
    expect(() => reduceSketchDraft(driven, { type: "addConstraint", context, constraint: { id: "d", kind: "dimension", target: "diameter", value: 13 } })).toThrow();
    expect(() => reduceSketchDraft(driven, { type: "addConstraint", context, constraint: { id: "d2", kind: "dimension", target: "diameter", value: 13 } })).toThrow();
    expect(driven.profile).toEqual(readFeatures(sketchSource(reduceSketchDraft(driven, { type: "finishSketch", context }), context))[0]);
  });
  it("moves free positions, keeps status and blocks constrained moves", () => {
    const free = reduceSketchDraft(rect(), { type: "move", context, entityId: "sketchProfile", point: [4, 5] });
    expect(sketchPreview(free, context)?.outline).toEqual([[4, 5], [24, 5], [24, 15], [4, 15]]);
    expect(analyzeSketch(free).status).toBe("underdefined");
    const fixed = reduceSketchDraft(free, { type: "addConstraint", context, constraint: { id: "fixed", kind: "fixedProfile" } });
    expect(analyzeSketch(fixed).status).toBe("fullyDefined");
    const lastValid = structuredClone(fixed);
    expect(() => reduceSketchDraft(fixed, { type: "move", context, entityId: "sketchProfile", point: [8, 5] })).toThrow();
    expect(fixed).toEqual(lastValid);
    expect(free.profile?.sketchIntent).toBeUndefined();
  });
  it("propagates horizontal/vertical edges and rejects invalid closure or fixed conflicts", () => {
    let state = start();
    for (const point of [[0, 0], [5, 1], [6, 5], [0, 4]] as const) state = reduceSketchDraft(state, { type: "linePoint", context, point });
    state = reduceSketchDraft(state, { type: "closeLine", context });
    const horizontal = reduceSketchDraft(state, { type: "addConstraint", context, constraint: { id: "horizontal", kind: "horizontal", edge: 0 } });
    expect(horizontal.profile).toMatchObject({ vertices: [[0, 0], [5, 0], [6, 5], [0, 4]] });
    const vertical = reduceSketchDraft(horizontal, { type: "addConstraint", context, constraint: { id: "vertical", kind: "vertical", edge: 1 } });
    expect(vertical.profile).toMatchObject({ vertices: [[0, 0], [5, 0], [5, 5], [0, 4]] });
    expect(analyzeSketch(vertical).status).toBe("underdefined");
    const fixed = reduceSketchDraft(vertical, { type: "addConstraint", context, constraint: { id: "point", kind: "fixedPoint", vertex: 1 } });
    expect(() => reduceSketchDraft(fixed, { type: "move", context, entityId: "sketchProfile", vertex: 1, point: [5, 2] })).toThrow();
    expect(() => reduceSketchDraft(vertical, { type: "move", context, entityId: "sketchProfile", vertex: 2, point: [0, 0] })).toThrow();
  });
});
