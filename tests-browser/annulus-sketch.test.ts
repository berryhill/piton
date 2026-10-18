// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import Module, { type ManifoldToplevel } from "manifold-3d";
import { appendFeatures, emptyFeatureSource, readFeatures, replaceFeature, type PartFeature } from "../src/modeling/source";
import { evaluateFeatureSource } from "../src/modeling/evaluator";
import { reduceSketchDraft, reopenSketchProfile, sketchPreview, sketchSource } from "../src/modeling/sketchDraft";

let kernel: ManifoldToplevel;
beforeAll(async () => { kernel = await Module(); kernel.setup(); });
const circle: PartFeature = { kind: "circle", id: "washer", name: "Washer", plane: "XY", diameter: 40, innerDiameter: 20 };
const extrude: PartFeature = { kind: "extrude", id: "body", name: "Body", profileId: "washer", distance: 5 };
const make = (...features: PartFeature[]) => appendFeatures(emptyFeatureSource(), features);
const context = { projectId: "p", documentId: "d", revisionId: null };

describe("bounded concentric annulus", () => {
  it("preserves legacy circle bytes and canonicalizes optional nested diameter", () => {
    // Legacy inputs omit the optional property entirely.
    const old = make({ kind: "circle", id: "washer", name: "Washer", plane: "XY", diameter: 40 });
    expect(old.source).toContain('part.circle({"id":"washer","name":"Washer","plane":"XY","diameter":40});');
    expect(readFeatures(old)[0]).not.toHaveProperty("innerDiameter");
    const nested = make(circle);
    expect(nested.source).toContain('"diameter":40,"innerDiameter":20');
    expect(readFeatures(nested)).toEqual([circle]);

  });
  it.each([-1, 0, 40, 41, 39.99, Number.NaN, Infinity])("rejects invalid inner diameter %s", innerDiameter => {
    expect(() => make({ ...circle, innerDiameter })).toThrow();
  });
  it("extrudes a real void through the full height on the legacy path", () => {
    const result = evaluateFeatureSource(make(circle, extrude), kernel);
    expect(result.bounds).toEqual({ min: [-20, -20, 0], max: [20, 20, 5] });
    expect(result.volumeMm3).toBeCloseTo(Math.PI * (20 ** 2 - 10 ** 2) * 5, 0);
    expect(result.checks.every(check => check.passed)).toBe(true);
    expect(result.fabricationRelease).toBe(false);
    expect(result.machineActuation).toBe(false);
    // No top or bottom faces may span the central opening.
    for (let i = 0; i < result.triangles.length; i += 3) {
      const points = result.triangles.slice(i, i + 3).map(index => result.vertices.slice(index * 3, index * 3 + 3));
      if (points.every(point => Math.abs(point[2]) < 1e-5 || Math.abs(point[2] - 5) < 1e-5))
        expect(points.every(point => Math.hypot(point[0], point[1]) >= 9.99)).toBe(true);
    }
  });
  it.each(["XY", "XZ", "YZ"] as const)("realizes an annular profile on %s", plane => {
    const placed = { ...circle, plane, origin: [4, 6] as const };
    const result = evaluateFeatureSource(make(placed, extrude), kernel);
    expect(result.volumeMm3).toBeCloseTo(Math.PI * 300 * 5, 0);
    expect(result.checks.every(check => check.passed)).toBe(true);
  });
  it("rejects a legacy hole inside or overlapping the existing opening", () => {
    const bore: PartFeature = { kind: "hole", id: "hole", name: "Hole", bodyId: "body", x: 0, y: 0, diameter: 4, extent: "through" };
    expect(() => make(circle, extrude, bore)).toThrow(/opening|wall|void/i);
    expect(() => make(circle, extrude, { ...bore, x: 11 })).toThrow(/opening|wall|void/i);
    expect(make(circle, extrude, { ...bore, x: 15 }).source).toContain("part.hole");
  });
  it("replaces inner diameter at the same ID without mutating earlier source", () => {
    const original = make(circle, extrude);
    const changed = replaceFeature(original, circle.id, { ...circle, innerDiameter: 12 });
    expect(readFeatures(original)[0]).toEqual(circle);
    expect(readFeatures(changed)[0]).toMatchObject({ id: circle.id, innerDiameter: 12 });
    expect(evaluateFeatureSource(changed, kernel).volumeMm3).toBeGreaterThan(evaluateFeatureSource(original, kernel).volumeMm3);
  });
  it("roundtrips nested intent through sketch finish and reopen; rejects contradicted driver", () => {
    let draft = reduceSketchDraft(null, { type: "newSketch", context, draftId: "draft", plane: "XY" });
    draft = reduceSketchDraft(draft, { type: "circle", context, diameter: 40, innerDiameter: 20 });
    expect(sketchPreview(draft, context)).toMatchObject({ kind: "circle", innerDiameter: 20 });
    draft = reduceSketchDraft(draft, { type: "addConstraint", context, constraint: { kind: "dimension", id: "inner", target: "innerDiameter", value: 20 } });
    const source = sketchSource(reduceSketchDraft(draft, { type: "finishSketch", context }), context);
    const reopened = reopenSketchProfile(source, "sketchProfile", context, "second");
    expect(reopened.profile).toMatchObject({ innerDiameter: 20, sketchIntent: { constraints: [{ target: "innerDiameter", value: 20 }] } });
    expect(() => reduceSketchDraft(reopened, { type: "circle", context, diameter: 40, innerDiameter: 24 })).toThrow(/dimension|conflict/i);
  });
});
