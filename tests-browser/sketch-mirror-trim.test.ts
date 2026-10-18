// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import Module, { type ManifoldToplevel } from "manifold-3d";
import { appendFeatures, readFeatures, type ProfileFeature } from "../src/modeling/source";
import { evaluateFeatureSource } from "../src/modeling/evaluator";
import { reduceSketchDraft, sketchSource, type SketchContext, type SketchDraft } from "../src/modeling/sketchDraft";

const context: SketchContext = { projectId: "p", documentId: "d", revisionId: "r1" };
const start = (plane: "XY" | "XZ" | "YZ" = "XY") => reduceSketchDraft(null, { type: "newSketch", context, draftId: "draft", plane, profileId: "outline" });
function line(points: readonly (readonly [number, number])[], draft = start()): SketchDraft {
  return points.reduce<SketchDraft>((state, point) => reduceSketchDraft(state, { type: "linePoint", context, point }), draft);
}
const finish = (draft: SketchDraft) => sketchSource(reduceSketchDraft(draft, { type: "finishSketch", context }), context);
let kernel: ManifoldToplevel;
beforeAll(async () => { kernel = await Module(); kernel.setup(); });

describe("bounded destructive sketch mirror and trim commands", () => {
  it("mirrors an axis-ended half-chain into one CCW canonical polygon and real solid", () => {
    const half = line([[0, 0], [20, 0], [20, 10], [10, 20], [0, 20]]);
    const mirrored = reduceSketchDraft(half, { type: "mirrorLine", context, axis: "V" });
    expect(mirrored.generation).toBe(half.generation + 1);
    expect(mirrored.linePoints).toEqual([]);
    expect(mirrored.profile).toMatchObject({ kind: "polygon", id: "outline", vertices: [[0, 0], [20, 0], [20, 10], [10, 20], [0, 20], [-10, 20], [-20, 10], [-20, 0]] });
    const source = finish(mirrored);
    expect(readFeatures(source)[0]).toEqual(mirrored.profile);
    const mesh = evaluateFeatureSource(appendFeatures(source, [{ kind: "extrude", id: "body", name: "Body", profileId: "outline", distance: 5 }]), kernel);
    expect(mesh.bounds).toEqual({ min: [-20, 0, 0], max: [20, 20, 5] });
    expect(mesh.volumeMm3).toBeCloseTo(3500, 2);
  });
  it("normalizes opposite winding and U-axis reflection without duplicate axis endpoints", () => {
    const half = line([[10, 1], [10, 5], [0, 5], [0, 0]]);
    // One endpoint is off U; the operation must not infer/repair an axis.
    expect(() => reduceSketchDraft(half, { type: "mirrorLine", context, axis: "U" })).toThrow(/endpoint.*axis/i);
    const valid = line([[0, 0], [0, 10], [5, 10], [5, 0]]);
    const result = reduceSketchDraft(valid, { type: "mirrorLine", context, axis: "U" });
    expect(result.profile?.kind).toBe("polygon");
    expect((result.profile as Extract<ProfileFeature, { kind: "polygon" }>).vertices).toHaveLength(6);
    expect(finish(result).source).toContain('part.polygon');
  });
  it("rejects crossing, off-axis, repeated or unsupported chains atomically", () => {
    for (const points of [
      [[0, 0], [5, 0], [-5, 4], [0, 8]],
      [[0, 0], [5, 0], [5, 8], [1, 8]],
      [[0, 0], [0, 2], [5, 3], [0, 8]],
    ] as const) {
      const draft = line(points);
      const last = structuredClone(draft);
      expect(() => reduceSketchDraft(draft, { type: "mirrorLine", context, axis: "V" })).toThrow();
      expect(draft).toEqual(last);
    }
    const draft = start();
    expect(() => reduceSketchDraft(draft, { type: "mirrorLine", context, axis: "bad" as "V" })).toThrow(/axis/i);
    expect(() => reduceSketchDraft(draft, { type: "mirrorLine", context: { ...context, revisionId: "r2" }, axis: "V" })).toThrow(/stale/i);
  });
  it("trims only open chains to an explicit contiguous prefix or suffix", () => {
    const chain = line([[0, 0], [10, 0], [10, 10], [0, 10], [-9, 10]]);
    const prefix = reduceSketchDraft(chain, { type: "trimLine", context, edge: 3, keep: "start" });
    const suffix = reduceSketchDraft(chain, { type: "trimLine", context, edge: 0, keep: "end" });
    expect(prefix.linePoints).toEqual([[0, 0], [10, 0], [10, 10], [0, 10]]);
    expect(suffix.linePoints).toEqual([[10, 0], [10, 10], [0, 10], [-9, 10]]);
    expect(prefix.generation).toBe(chain.generation + 1);
    const mirrored = reduceSketchDraft(prefix, { type: "mirrorLine", context, axis: "V" });
    expect(readFeatures(finish(mirrored))[0]).toMatchObject({ kind: "polygon", id: "outline" });
    for (const edge of [-1, 0, 4, 1.5]) expect(() => reduceSketchDraft(chain, { type: "trimLine", context, edge, keep: "start" })).toThrow();
    expect(() => reduceSketchDraft(chain, { type: "trimLine", context, edge: 2, keep: "bad" as "end" })).toThrow(/keep/i);
    expect(() => reduceSketchDraft(chain, { type: "trimLine", context: { ...context, documentId: "other" }, edge: 2, keep: "end" })).toThrow(/stale/i);
    expect(chain.linePoints).toHaveLength(5);
    expect(() => reduceSketchDraft(mirrored, { type: "trimLine", context, edge: 1, keep: "end" })).toThrow(/open/i);
  });
  it("preserves plane, support, base, profile identity and context", () => {
    const base = finish(reduceSketchDraft(start("XZ"), { type: "rectangle", context, width: 30, height: 20 }));
    const body = appendFeatures(base, [{ kind: "extrude", id: "base", name: "Base", profileId: "outline", distance: 5 }]);
    const draft = reduceSketchDraft(null, { type: "newSketch", context, draftId: "cap-draft", plane: "XZ", profileId: "cap", offset: 2, support: { kind: "extrusionCap", featureId: "base", side: "end" }, base: body });
    const result = reduceSketchDraft(line([[0, 0], [5, 0], [5, 10], [0, 10]], draft), { type: "mirrorLine", context, axis: "V" });
    expect(result).toMatchObject({ draftId: "cap-draft", context, profileId: "cap", base: body, placement: draft.placement, profile: { id: "cap", plane: "XZ", offset: 2, support: draft.placement.support } });
    expect(readFeatures(finish(result)).map(f => f.id)).toEqual(["outline", "base", "cap"]);
  });
  it("reflects a closed polygon as a destructive coordinate transform with positive winding", () => {
    const closed = reduceSketchDraft(line([[0, 0], [8, 0], [8, 4], [0, 4]]), { type: "closeLine", context });
    const reflected = reduceSketchDraft(closed, { type: "mirrorReflection", context, axis: "V" });
    expect(reflected.profile).toMatchObject({ id: "outline", vertices: [[0, 4], [-8, 4], [-8, 0], [0, 0]] });
    const mesh = evaluateFeatureSource(appendFeatures(finish(reflected), [{ kind: "extrude", id: "body", name: "Body", profileId: "outline", distance: 5 }]), kernel);
    expect(mesh.bounds).toEqual({ min: [-8, 0, 0], max: [0, 4, 5] });
    expect(mesh.volumeMm3).toBeCloseTo(160, 2);
    expect(() => reduceSketchDraft(closed, { type: "mirrorReflection", context: { ...context, revisionId: "r2" }, axis: "V" })).toThrow(/stale/i);
    const rect = reduceSketchDraft(start(), { type: "rectangle", context, width: 4, height: 5 });
    expect(() => reduceSketchDraft(rect, { type: "mirrorReflection", context, axis: "V" })).toThrow(/polygon/i);
  });
  it("rejects constrained closed polygon reflection rather than erasing or misbinding intent", () => {
    const closed = reduceSketchDraft(line([[0, 0], [8, 0], [8, 4], [0, 4]]), { type: "closeLine", context });
    const constrained = reduceSketchDraft(closed, { type: "addConstraint", context, constraint: { id: "h", kind: "horizontal", edge: 0 } });
    const last = structuredClone(constrained);
    expect(() => reduceSketchDraft(constrained, { type: "mirrorReflection", context, axis: "V" })).toThrow(/constraint/i);
    expect(constrained).toEqual(last);
  });
});
