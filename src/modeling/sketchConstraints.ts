import type { SketchConstraint, ProfileFeature } from "./source";
import type { SketchDraft } from "./sketchDraft";

const equal = (a: number, b: number) => Math.abs(a - b) < 1e-9;
export function sketchConstraints(profile: ProfileFeature): readonly SketchConstraint[] { return profile.sketchIntent?.constraints ?? []; }

/** Validate the finite solved subset, including duplicate drivers and actual coordinate truth. */
export function assertSketchConstraints(profile: ProfileFeature): void {
  const constraints = sketchConstraints(profile);
  const position = profile.kind === "polygon" ? profile.vertices[0] : profile.origin ?? [0, 0];
  const ids = new Set<string>();
  const drivers = new Set<string>();
  for (const c of constraints) {
    if (ids.has(c.id)) throw new Error(`Duplicate constraint ID ${c.id}`);
    ids.add(c.id);
    const key = c.kind === "dimension" ? `${c.target}:${c.vertex ?? ""}` : `${c.kind}:${"edge" in c ? c.edge : "vertex" in c ? c.vertex : ""}`;
    if (drivers.has(key)) throw new Error(`Duplicate constraint ${key}`);
    drivers.add(key);
    if (profile.kind === "polygon") {
      if (c.kind === "fixedProfile" || (c.kind === "dimension" && !["vertexX", "vertexY"].includes(c.target))) throw new Error("Unsupported polygon constraint");
      if (("vertex" in c && c.vertex !== undefined && (!Number.isInteger(c.vertex) || c.vertex < 0 || c.vertex >= profile.vertices.length)) ||
        ("edge" in c && (!Number.isInteger(c.edge) || c.edge < 0 || c.edge >= profile.vertices.length))) throw new Error("Invalid polygon entity index");
      if (c.kind === "origin" && !profile.vertices[0].every(v => equal(v, 0))) throw new Error("Origin constraint conflicts with vertex");
      if (c.kind === "fixedPoint" && c.point && (!equal(profile.vertices[c.vertex][0], c.point[0]) || !equal(profile.vertices[c.vertex][1], c.point[1]))) throw new Error("Fixed point conflicts with captured position");
      if (c.kind === "horizontal" && !equal(profile.vertices[c.edge][1], profile.vertices[(c.edge + 1) % profile.vertices.length][1])) throw new Error("Horizontal edge conflict");
      if (c.kind === "vertical" && !equal(profile.vertices[c.edge][0], profile.vertices[(c.edge + 1) % profile.vertices.length][0])) throw new Error("Vertical edge conflict");
      if (c.kind === "dimension" && (c.target === "vertexX" || c.target === "vertexY") && !equal(profile.vertices[c.vertex!][c.target === "vertexX" ? 0 : 1], c.value)) throw new Error("Vertex dimension conflict");
    } else {
      if (c.kind === "fixedPoint" || c.kind === "horizontal" || c.kind === "vertical" || (c.kind === "dimension" && !["centerX", "centerY", ...(profile.kind === "circle" ? ["diameter"] : ["width", "height"])].includes(c.target))) throw new Error("Unsupported profile constraint");
      if (c.kind === "origin" && (!equal(position[0], 0) || !equal(position[1], 0))) throw new Error("Origin constraint conflicts with location");
      if (c.kind === "dimension") {
        const actual = c.target === "centerX" ? position[0] : c.target === "centerY" ? position[1] :
          c.target === "diameter" && profile.kind === "circle" ? profile.diameter : c.target === "width" && profile.kind === "rectangle" ? profile.width : profile.kind === "rectangle" ? profile.height : NaN;
        if (!equal(actual, c.value)) throw new Error("Driving dimension conflicts with geometry");
      }
    }
  }
  if (drivers.has("origin:") && (drivers.has("fixedProfile:") || drivers.has("fixedPoint:0") || drivers.has("dimension:centerX:") || drivers.has("dimension:centerY:") || drivers.has("dimension:vertexX:0") || drivers.has("dimension:vertexY:0"))) throw new Error("Redundant origin constraint");
  if (drivers.has("fixedProfile:") && constraints.length > 1) throw new Error("Fixed profile conflicts with other drivers");
  if (profile.kind === "polygon") for (let i = 0; i < profile.vertices.length; i++) {
    if (drivers.has(`fixedPoint:${i}`) && (drivers.has(`dimension:vertexX:${i}`) || drivers.has(`dimension:vertexY:${i}`))) throw new Error("Fixed vertex conflicts with dimension");
    if (drivers.has(`horizontal:${i}`) && drivers.has(`vertical:${i}`)) throw new Error("Zero edge constraint conflict");
  }
}

/** Equality-only rank of the implemented coordinate graph; no general equation solver. */
export function analyzeSketch(draft: SketchDraft): { status: "underdefined" | "fullyDefined" | "unsupported"; degreesOfFreedom: number } {
  const p = draft.profile;
  if (!p) return { status: "underdefined", degreesOfFreedom: draft.linePoints.length * 2 };
  assertSketchConstraints(p);
  const cs = sketchConstraints(p);
  if (p.kind !== "polygon") {
    const has = (kind: string) => cs.some(c => c.kind === kind);
    const dim = (target: string) => cs.some(c => c.kind === "dimension" && c.target === target);
    const dof = has("fixedProfile") ? 0 : (has("origin") || dim("centerX") ? 0 : 1) + (has("origin") || dim("centerY") ? 0 : 1) +
      (p.kind === "circle" ? (dim("diameter") ? 0 : 1) : (dim("width") ? 0 : 1) + (dim("height") ? 0 : 1));
    return { status: dof ? "underdefined" : "fullyDefined", degreesOfFreedom: dof };
  }
  const count = p.vertices.length * 2;
  const parent = Array.from({ length: count }, (_, i) => i);
  const root = (i: number): number => parent[i] === i ? i : (parent[i] = root(parent[i]));
  const union = (a: number, b: number) => { parent[root(a)] = root(b); };
  for (const c of cs) {
    if (c.kind === "horizontal" || c.kind === "vertical") union(c.edge * 2 + (c.kind === "horizontal" ? 1 : 0), ((c.edge + 1) % p.vertices.length) * 2 + (c.kind === "horizontal" ? 1 : 0));
  }
  const roots = new Set(parent.map((_, i) => root(i)));
  const fixed = new Set<number>();
  for (const c of cs) {
    if (c.kind === "origin" || c.kind === "fixedPoint") {
      const v = c.kind === "fixedPoint" ? c.vertex : 0;
      fixed.add(root(v * 2)); fixed.add(root(v * 2 + 1));
    } else if (c.kind === "dimension") fixed.add(root(c.vertex! * 2 + (c.target === "vertexY" ? 1 : 0)));
  }
  const dof = roots.size - fixed.size;
  return { status: dof ? "underdefined" : "fullyDefined", degreesOfFreedom: dof };
}
