// @vitest-environment node
import { describe, expect, it } from "vitest";
import { appendFeatures, emptyFeatureSource, readFeatures, type ProfileFeature } from "../src/modeling/source";
import { reduceSketchDraft, reopenSketchProfile, sketchPreview, sketchSource, type SketchContext } from "../src/modeling/sketchDraft";

const context: SketchContext = { projectId: "p", documentId: "d", revisionId: "r1" };
const baseProfile: ProfileFeature = { kind: "rectangle", id: "baseProfile", name: "Base", plane: "XZ", width: 30, height: 20 };
const base = appendFeatures(emptyFeatureSource(), [baseProfile, { kind: "extrude", id: "base", name: "Base", profileId: "baseProfile", distance: 5 }]);

describe("sketch plane and source handoff", () => {
  it.each(["XZ", "YZ"] as const)("previews %s with its actual local frame", plane => {
    const draft = reduceSketchDraft(null, { type: "newSketch", context, draftId: "d", plane, profileId: "outline" });
    const state = reduceSketchDraft(draft, { type: "rectangle", context, width: 5, height: 7 });
    expect(sketchPreview(state, context)).toMatchObject({ plane, frame: expect.objectContaining({ normal: plane === "XZ" ? [0, -1, 0] : [1, 0, 0] }) });
    expect(readFeatures(sketchSource(reduceSketchDraft(state, { type: "finishSketch", context }), context))[0]).toMatchObject({ id: "outline", plane });
  });
  it("preserves named cap and offset with effective base and existing features", () => {
    const draft = reduceSketchDraft(null, { type: "newSketch", context, draftId: "d", plane: "XZ", profileId: "cap", base, offset: 2, support: { kind: "extrusionCap", featureId: "base", side: "end" } });
    const state = reduceSketchDraft(draft, { type: "circle", context, diameter: 6 });
    expect(sketchPreview(state, context)?.frame.origin).toEqual([0, -7, 0]);
    const finished = reduceSketchDraft(state, { type: "finishSketch", context });
    expect(sketchSource(finished, context).source.startsWith(base.source)).toBe(true);
    const authored = sketchSource(finished, context, base);
    expect(readFeatures(authored).map(f => f.id)).toEqual(["baseProfile", "base", "cap"]);
    expect(readFeatures(authored)[2]).toMatchObject({ plane: "XZ", offset: 2, support: { featureId: "base", side: "end" } });
    expect(authored.source.startsWith(base.source)).toBe(true);
  });
  it("reopens profile with identity/support/dimensions and guards stale context", () => {
    const authored = sketchSource(reduceSketchDraft(reduceSketchDraft(reduceSketchDraft(null, { type: "newSketch", context, draftId: "d", plane: "XZ", profileId: "cap", support: { kind: "extrusionCap", featureId: "base", side: "end" } }), { type: "circle", context, diameter: 6 }), { type: "finishSketch", context }), context, base);
    const reopened = reopenSketchProfile(authored, "cap", context, "edit");
    expect(reopened).toMatchObject({ status: "drawing", profile: { id: "cap", plane: "XZ", diameter: 6, support: { featureId: "base" } } });
    expect(() => sketchPreview(reopened, { ...context, revisionId: "r2" })).toThrow(/stale/i);
    expect(() => reduceSketchDraft(reopened, { type: "dimension", context: { ...context, revisionId: "r2" }, target: "diameter", value: 7 })).toThrow(/stale/i);
  });
});
