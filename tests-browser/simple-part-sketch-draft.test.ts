// @vitest-environment node
import { describe, expect, it } from "vitest";
import { appendFeatures, emptyFeatureSource, readFeatures } from "../src/modeling/source";
import { reduceSketchDraft, sketchPreview, sketchSource, type SketchContext } from "../src/modeling/sketchDraft";

const context: SketchContext = { projectId: "project-a", documentId: "part-a", revisionId: null };
const other: SketchContext = { ...context, documentId: "part-b" };
const start = (draftId = "draft-a") => reduceSketchDraft(null, { type: "newSketch", context, draftId, plane: "XY" });

function rectangle() {
  return reduceSketchDraft(start(), { type: "rectangle", context, width: 20, height: 10 });
}

describe("transient XY sketch command draft", () => {
  it("starts only on XY and binds project, document and revision identity", () => {
    expect(start()).toMatchObject({ status: "drawing", context, draftId: "draft-a", generation: 0, profile: null });
    expect(() => reduceSketchDraft(null, { type: "newSketch", context, draftId: "draft-b", plane: "XZ" as never })).toThrow(/XY/);
    expect(() => reduceSketchDraft(start(), { type: "newSketch", context, draftId: "draft-b", plane: "XY" })).toThrow(/active/);
    expect(() => reduceSketchDraft(start(), { type: "circle", context: other, diameter: 8 })).toThrow(/stale/i);
    expect(() => reduceSketchDraft(start(), { type: "circle", context: { ...context, revisionId: "rev-next" }, diameter: 8 })).toThrow(/stale/i);
    expect(() => reduceSketchDraft(start(), { type: "circle", context: { ...context, projectId: "other" }, diameter: 8 })).toThrow(/stale/i);
  });

  it("drafts rectangle, previews without a solid, drives dimensions, finishes into canonical source", () => {
    const original = rectangle();
    const preview = sketchPreview(original, context);
    expect(preview).toMatchObject({ kind: "rectangle", width: 20, height: 10, plane: "XY", generation: 1, draftId: "draft-a", claimScope: "sketch-only", reviewState: "needs_human_review", fabricationRelease: false, machineActuation: false });
    expect(preview?.outline).toEqual([[0, 0], [20, 0], [20, 10], [0, 10]]);
    const changed = reduceSketchDraft(original, { type: "dimension", context, target: "width", value: 25 });
    expect(changed.generation).toBe(2);
    expect(sketchPreview(changed, context)?.outline).toEqual([[0, 0], [25, 0], [25, 10], [0, 10]]);
    expect(sketchPreview(original, context)?.generation).toBe(1);
    const finished = reduceSketchDraft(changed, { type: "finishSketch", context });
    expect(finished.status).toBe("finished");
    const source = sketchSource(finished, context);
    expect(readFeatures(source)).toEqual([{ kind: "rectangle", id: "sketchProfile", name: "Sketch profile", plane: "XY", width: 25, height: 10 }]);
    expect(source).toEqual(appendFeatures(emptyFeatureSource(), readFeatures(source)));
    expect(() => reduceSketchDraft(finished, { type: "dimension", context, target: "width", value: 5 })).toThrow(/drawing/);
    expect(() => sketchSource(changed, context)).toThrow(/finished/);
  });

  it("drafts a circle independently of solid evaluation and drives diameter", () => {
    const circle = reduceSketchDraft(start(), { type: "circle", context, diameter: 12 });
    expect(sketchPreview(circle, context)).toMatchObject({ kind: "circle", diameter: 12, center: [0, 0], claimScope: "sketch-only" });
    const resized = reduceSketchDraft(circle, { type: "dimension", context, target: "diameter", value: 14 });
    expect(readFeatures(sketchSource(reduceSketchDraft(resized, { type: "finishSketch", context }), context))).toEqual([
      { kind: "circle", id: "sketchProfile", name: "Sketch profile", plane: "XY", diameter: 14 },
    ]);
  });

  it("builds a closed Line polygon, previews the actual contour and drives individual vertices", () => {
    let state = start();
    for (const point of [[0, 0], [6, 0], [6, 2], [2, 2], [2, 5], [0, 5]] as const) {
      state = reduceSketchDraft(state, { type: "linePoint", context, point });
    }
    expect(sketchPreview(state, context)).toMatchObject({ kind: "line", closed: false, generation: 6 });
    expect(() => reduceSketchDraft(state, { type: "finishSketch", context })).toThrow(/closed/);
    const closed = reduceSketchDraft(state, { type: "closeLine", context });
    expect(sketchPreview(closed, context)).toMatchObject({ kind: "polygon", closed: true, outline: [[0, 0], [6, 0], [6, 2], [2, 2], [2, 5], [0, 5]] });
    const edited = reduceSketchDraft(closed, { type: "dimension", context, target: "vertexX", index: 2, value: 7 });
    const editedY = reduceSketchDraft(edited, { type: "dimension", context, target: "vertexY", index: 2, value: 3 });
    const source = sketchSource(reduceSketchDraft(editedY, { type: "finishSketch", context }), context);
    expect(readFeatures(source)[0]).toMatchObject({ kind: "polygon", vertices: [[0, 0], [6, 0], [7, 3], [2, 2], [2, 5], [0, 5]] });
  });

  it("rejects negative dimensions, invalid polygon geometry and wrong dimension targets atomically", () => {
    const rect = rectangle();
    for (const value of [-1, 0, NaN, Infinity, 1001]) {
      expect(() => reduceSketchDraft(rect, { type: "dimension", context, target: "height", value })).toThrow();
    }
    expect(() => reduceSketchDraft(rect, { type: "dimension", context, target: "diameter", value: 3 })).toThrow();
    expect(rect.profile).toMatchObject({ width: 20, height: 10 });
    expect(rect.generation).toBe(1);
    let line = start();
    for (const point of [[0, 0], [4, 0], [4, 4], [0, 4]] as const) line = reduceSketchDraft(line, { type: "linePoint", context, point });
    expect(() => reduceSketchDraft(line, { type: "linePoint", context, point: [0, 0] })).toThrow(/duplicate|zero|repeated/i);
    const closed = reduceSketchDraft(line, { type: "closeLine", context });
    expect(() => reduceSketchDraft(closed, { type: "closeLine", context })).toThrow(/already closed/);
    expect(() => reduceSketchDraft(closed, { type: "dimension", context, target: "vertexX", index: 2, value: 0 })).toThrow();
    expect(() => reduceSketchDraft(closed, { type: "dimension", context, target: "vertexY", index: 100, value: 1 })).toThrow();
    expect(closed.profile).toMatchObject({ vertices: [[0, 0], [4, 0], [4, 4], [0, 4]] });
    let crossing = start("crossing");
    for (const point of [[0, 0], [4, 0], [0, 4], [4, 4]] as const) crossing = reduceSketchDraft(crossing, { type: "linePoint", context, point });
    expect(() => reduceSketchDraft(crossing, { type: "closeLine", context })).toThrow();
    expect(() => reduceSketchDraft(start(), { type: "closeLine", context })).toThrow(/3/);
    let clockwise = start("clockwise");
    for (const point of [[0, 0], [0, 4], [4, 0]] as const) clockwise = reduceSketchDraft(clockwise, { type: "linePoint", context, point });
    expect(() => reduceSketchDraft(clockwise, { type: "closeLine", context })).toThrow(/counterclockwise/);
  });

  it("cancels without authority, rejects stale cancellation and invalidates prior previews on edits", () => {
    const rect = rectangle();
    expect(() => reduceSketchDraft(rect, { type: "cancelSketch", context: other })).toThrow(/stale/i);
    expect(() => sketchSource(reduceSketchDraft(rect, { type: "finishSketch", context }), other)).toThrow(/stale/i);
    expect(() => sketchPreview(rect, other)).toThrow(/stale/i);
    const cancelled = reduceSketchDraft(rect, { type: "cancelSketch", context });
    expect(cancelled).toBeNull();
    expect(() => sketchSource(cancelled, context)).toThrow();
    expect(() => reduceSketchDraft(null, { type: "finishSketch", context })).toThrow(/active/);
    const next = reduceSketchDraft(cancelled, { type: "newSketch", context, draftId: "draft-b", plane: "XY" });
    expect(sketchPreview(next, context)).toBeNull();
    expect(next.draftId).not.toBe(rect.draftId);
  });
});
