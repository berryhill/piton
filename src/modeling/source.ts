import { sha256Hex } from "../domain";

/** The only authored value is restricted TypeScript source. Features are parsed
 * read-only projections, not a second persisted/writable mechanical graph.
 * Deliberately no eval, arbitrary TS, imports, loops, or fixture constructors. */
export interface FeatureSource {
  readonly authorityProfile: "browser-typescript/v1";
  readonly units: "mm";
  readonly source: string;
}
interface Named { readonly id: string; readonly name: string }
export type ProfileFeature =
  | (Named & { readonly kind: "rectangle"; readonly plane: "XY"; readonly width: number; readonly height: number })
  | (Named & { readonly kind: "circle"; readonly plane: "XY"; readonly diameter: number })
  | (Named & { readonly kind: "polygon"; readonly plane: "XY"; readonly vertices: readonly (readonly [number, number])[] });
export type ExtrudeFeature = Named & { readonly kind: "extrude"; readonly profileId: string; readonly distance: number };
/** XY profile is a radial/axial section: X is nonnegative radius from the
 * Z axis, Y is the resulting Z height. Only a complete turn is supported. */
export type RevolveFeature = Named & { readonly kind: "revolve"; readonly profileId: string; readonly axis: "Z"; readonly angleDegrees: 360 };
export type HoleFeature = Named & { readonly kind: "hole"; readonly bodyId: string; readonly x: number; readonly y: number; readonly diameter: number; readonly extent: "through" };
/** Count includes the source hole; repeats i=1..count-1 are placed at
 * (source.x + i*spacingX, source.y + i*spacingY) on the named body. */
export type LinearPatternFeature = Named & { readonly kind: "linearPattern"; readonly bodyId: string; readonly sourceHoleId: string; readonly count: number; readonly spacingX: number; readonly spacingY: number };
/** Four vertical outer corners of one rectangular +Z extrusion only. */
export type FinishingFeature = Named & { readonly kind: "fillet"; readonly bodyId: string; readonly edgeSet: "verticalOuterPerimeter"; readonly radius: number }
  | Named & { readonly kind: "chamfer"; readonly bodyId: string; readonly edgeSet: "verticalOuterPerimeter"; readonly distance: number };
export type PartFeature = ProfileFeature | ExtrudeFeature | RevolveFeature | HoleFeature | LinearPatternFeature | FinishingFeature;
export type ModelingErrorCode = "invalid_source" | "invalid_feature" | "dependency_failure" | "unsupported_operation" | "geometry_failed";
export class ModelingError extends Error {
  constructor(readonly code: ModelingErrorCode, message: string) { super(message); this.name = "ModelingError"; }
}
export const MODELING_LIMITS = Object.freeze({ maxFeatures: 66, maxSourceBytes: 32768, minDimension: 0.1, maxDimension: 1000, minWall: 0.01 });
/** Shared with the evaluator: each rounded corner is an inscribed quarter arc. */
export const FILLET_CORNER_SEGMENTS = 64;
const HEADER = '// Piton browser-typescript/v1; units=mm; restricted named-feature source\n';
function fail(code: ModelingErrorCode, message: string): never { throw new ModelingError(code, message); }
function keys(value: unknown, expected: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join("|") !== [...expected].sort().join("|")) fail("invalid_feature", "Unexpected or missing fields");
}
function dimension(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < MODELING_LIMITS.minDimension || value > MODELING_LIMITS.maxDimension) fail("invalid_feature", "Dimension must be finite and between 0.1 and 1000 mm");
}
function identity(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value)) fail("invalid_feature", "Feature ID must be a bounded identifier");
}
function polygonVertices(value: unknown): asserts value is readonly (readonly [number, number])[] {
  if (!Array.isArray(value) || value.length < 3 || value.length > 32) fail("invalid_feature", "Polygon requires 3–32 vertices");
  for (const vertex of value) {
    if (!Array.isArray(vertex) || vertex.length !== 2 || vertex.some(v => typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > 1000)) fail("invalid_feature", "Polygon vertices must be finite XY coordinates within +/-1000 mm");
  }
  const vertices = value as number[][];
  const n = vertices.length;
  const cross = (a: number[], b: number[], c: number[]) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const onSegment = (a: number[], b: number[], p: number[]) => cross(a, b, p) === 0 && p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0]) && p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1]);
  for (let i = 0; i < n; i++) {
    const a = vertices[i], b = vertices[(i + 1) % n];
    if (a[0] === b[0] && a[1] === b[1]) fail("invalid_feature", "Polygon has a zero edge");
    for (let j = 0; j < i; j++) if (a[0] === vertices[j][0] && a[1] === vertices[j][1]) fail("invalid_feature", "Polygon has repeated vertices");
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // Edges sharing an endpoint are adjacent.
      const c = vertices[j], d = vertices[(j + 1) % n];
      const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
      if ((abC * abD < 0 && cdA * cdB < 0) || onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b)) fail("invalid_feature", "Polygon edges must not intersect or touch");
    }
  }
  const origin = vertices[0];
  let twiceArea = 0;
  for (let i = 1; i < n - 1; i++) twiceArea += cross(origin, vertices[i], vertices[i + 1]);
  if (twiceArea <= 0) fail("invalid_feature", "Polygon requires positive counterclockwise winding area");
}
function parseFeature(value: unknown): PartFeature {
  if (!value || typeof value !== "object") return fail("invalid_feature", "Feature must be an object");
  const f = value as Record<string, unknown>;
  const common = ["id", "name", "kind"];
  switch (f.kind) {
    case "rectangle": keys(f, [...common, "plane", "width", "height"]); dimension(f.width); dimension(f.height); break;
    case "circle": keys(f, [...common, "plane", "diameter"]); dimension(f.diameter); break;
    case "polygon": keys(f, [...common, "plane", "vertices"]); polygonVertices(f.vertices); break;
    case "extrude": keys(f, [...common, "profileId", "distance"]); identity(f.profileId); dimension(f.distance); break;
    case "revolve":
      keys(f, [...common, "profileId", "axis", "angleDegrees"]); identity(f.profileId);
      if (f.axis !== "Z" || f.angleDegrees !== 360) fail("unsupported_operation", "Only a full 360 degree revolve about Z is supported");
      break;
    case "hole":
      keys(f, [...common, "bodyId", "x", "y", "diameter", "extent"]); identity(f.bodyId); dimension(f.diameter);
      if (f.extent !== "through") fail("unsupported_operation", "Only through holes are supported");
      for (const v of [f.x, f.y]) if (typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > 1000) fail("invalid_feature", "Hole coordinates must be finite mm coordinates within +/-1000");
      break;
    case "linearPattern":
      keys(f, [...common, "bodyId", "sourceHoleId", "count", "spacingX", "spacingY"]);
      identity(f.bodyId); identity(f.sourceHoleId);
      if (!Number.isInteger(f.count) || (f.count as number) < 2 || (f.count as number) > 16) fail("invalid_feature", "Pattern count must be an integer from 2 to 16");
      for (const v of [f.spacingX, f.spacingY]) if (typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > 1000) fail("invalid_feature", "Pattern spacing must be finite XY mm within +/-1000");
      if (f.spacingX === 0 && f.spacingY === 0) fail("invalid_feature", "Pattern spacing cannot be zero");
      break;
    case "fillet":
    case "chamfer":
      keys(f, [...common, "bodyId", "edgeSet", f.kind === "fillet" ? "radius" : "distance"]);
      identity(f.bodyId);
      if (f.edgeSet !== "verticalOuterPerimeter") fail("unsupported_operation", "Only rectangular vertical outer perimeter edges are supported");
      dimension(f.kind === "fillet" ? f.radius : f.distance);
      break;
    default: return fail("unsupported_operation", "Unsupported named feature");
  }
  identity(f.id);
  if (typeof f.name !== "string" || !f.name.trim() || f.name !== f.name.trim() || f.name.length > 100 || /[\u0000-\u001f]/.test(f.name)) fail("invalid_feature", "Name must contain 1–100 visible characters without surrounding whitespace");
  if ((f.kind === "rectangle" || f.kind === "circle" || f.kind === "polygon") && f.plane !== "XY") fail("unsupported_operation", "Only the XY reference plane is supported; extrusion is along +Z");
  return Object.freeze(f.kind === "polygon"
    ? { ...f, vertices: Object.freeze((f.vertices as readonly (readonly [number, number])[]).map(vertex => Object.freeze([...vertex]))) }
    : { ...f }) as unknown as PartFeature;
}

/** Signed clearance from a hole center to the finished outer boundary. */
function finishingClearance(x: number, y: number, width: number, height: number, finish: FinishingFeature): number {
  const d = finish.kind === "fillet" ? finish.radius : finish.distance;
  if (finish.kind === "fillet") {
    const qx = Math.abs(x - width / 2) - (width / 2 - d);
    const qy = Math.abs(y - height / 2) - (height / 2 - d);
    const analytic = d - Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - Math.min(Math.max(qx, qy), 0);
    // An inscribed chord lies inside the analytic arc. Reserve its maximum
    // inward sagitta so the declared minimum wall holds on the realized mesh.
    const chordInset = d * (1 - Math.cos(Math.PI / (4 * FILLET_CORNER_SEGMENTS)));
    return analytic - chordInset;
  }
  return Math.min(x, y, width - x, height - y,
    (x + y - d) / Math.SQRT2, (width - x + y - d) / Math.SQRT2,
    (width - x + height - y - d) / Math.SQRT2, (x + height - y - d) / Math.SQRT2);
}
function validateSequence(features: readonly PartFeature[]): void {
  if (features.length > MODELING_LIMITS.maxFeatures) fail("invalid_source", "Feature count exceeds limit");
  const ids = new Set<string>();
  let profile: ProfileFeature | undefined;
  let body: ExtrudeFeature | RevolveFeature | undefined;
  const holes: HoleFeature[] = [];
  const sourceHoles = new Map<string, HoleFeature>();
  let finished = false;
  for (const f of features) {
    if (ids.has(f.id)) fail("invalid_feature", "Duplicate feature identity");
    ids.add(f.id);
    if (finished) fail("unsupported_operation", "Finishing must be the last operation");
    if (f.kind === "rectangle" || f.kind === "circle" || f.kind === "polygon") {
      if (profile || body) fail("unsupported_operation", "This bounded source supports one profile and one body");
      profile = f;
    } else if (f.kind === "extrude" || f.kind === "revolve") {
      if (!profile || f.profileId !== profile.id) fail("dependency_failure", `${f.kind === "extrude" ? "Extrude" : "Revolve"} must reference the preceding profile`);
      if (body) fail("unsupported_operation", "Only one extrusion or revolve is supported");
      if (f.kind === "revolve") {
        if (profile.kind === "circle") fail("unsupported_operation", "Circular radial-axial profiles are not supported for revolve");
        if (profile.kind === "polygon" && profile.vertices.some(v => v[0] < 0)) fail("unsupported_operation", "Revolve profile X radius must be nonnegative");
      }
      body = f;
    } else if (f.kind === "fillet" || f.kind === "chamfer") {
      if (!body || f.bodyId !== body.id) fail("dependency_failure", "Finishing must reference the preceding body");
      if (!profile || profile.kind !== "rectangle" || body.kind !== "extrude") fail("unsupported_operation", "Finishing requires a rectangular extruded plate");
      const d = f.kind === "fillet" ? f.radius : f.distance;
      if (d >= Math.min(profile.width, profile.height) / 2) fail("invalid_feature", "Finishing size must be below half the smaller profile side");
      for (const hole of holes) if (finishingClearance(hole.x, hole.y, profile.width, profile.height, f) < hole.diameter / 2 + MODELING_LIMITS.minWall)
        fail("invalid_feature", "Finishing violates hole wall thickness");
      finished = true;
    } else {
      if (!profile || !body || f.bodyId !== body.id) fail("dependency_failure", "Hole or pattern must reference the preceding body");
      if (body.kind === "revolve") fail("unsupported_operation", "Holes on revolved bodies are not supported");
      if (profile.kind === "polygon") fail("unsupported_operation", "Polygon holes are not supported in this bounded slice");
      const source = f.kind === "hole" ? f : sourceHoles.get(f.sourceHoleId);
      if (!source || source.bodyId !== f.bodyId) fail("dependency_failure", "Pattern must reference a preceding through-hole on the same body");
      const instances = f.kind === "hole" ? [f] : Array.from({ length: f.count - 1 }, (_, index) => ({ ...source, x: source.x + (index + 1) * f.spacingX, y: source.y + (index + 1) * f.spacingY }));
      for (const instance of instances) {
        const r = instance.diameter / 2 + MODELING_LIMITS.minWall;
        if (profile.kind === "rectangle" ? instance.x < r || instance.y < r || instance.x > profile.width - r || instance.y > profile.height - r : Math.hypot(instance.x, instance.y) + r > profile.diameter / 2) fail("invalid_feature", "Hole must remain inside the profile with positive wall thickness");
        if (holes.some(h => Math.hypot(h.x - instance.x, h.y - instance.y) < (h.diameter + instance.diameter) / 2 + MODELING_LIMITS.minWall)) fail("invalid_feature", "Holes must not overlap or touch");
        holes.push(instance);
      }
      if (f.kind === "hole") sourceHoles.set(f.id, f);
    }
  }
}
function line(feature: PartFeature): string {
  // Fixed field order makes serialization independent of caller object order.
  const { kind, id, name } = feature;
  const parameters = kind === "rectangle" ? { id, name, plane: feature.plane, width: feature.width, height: feature.height }
    : kind === "circle" ? { id, name, plane: feature.plane, diameter: feature.diameter }
    : kind === "polygon" ? { id, name, plane: feature.plane, vertices: feature.vertices }
    : kind === "extrude" ? { id, name, profileId: feature.profileId, distance: feature.distance }
    : kind === "revolve" ? { id, name, profileId: feature.profileId, axis: feature.axis, angleDegrees: feature.angleDegrees }
    : kind === "linearPattern" ? { id, name, bodyId: feature.bodyId, sourceHoleId: feature.sourceHoleId, count: feature.count, spacingX: feature.spacingX, spacingY: feature.spacingY }
    : kind === "fillet" ? { id, name, bodyId: feature.bodyId, edgeSet: feature.edgeSet, radius: feature.radius }
    : kind === "chamfer" ? { id, name, bodyId: feature.bodyId, edgeSet: feature.edgeSet, distance: feature.distance }
    : { id, name, bodyId: feature.bodyId, x: feature.x, y: feature.y, diameter: feature.diameter, extent: feature.extent };
  return `part.${kind}(${JSON.stringify(parameters)});\n`;
}
/** Pure command reducer. The application owns scope, CAS, idempotency, preview,
 * revisions and persistence; this function confers no commit authority. */
export function appendFeatures(base: FeatureSource, additions: readonly PartFeature[]): FeatureSource {
  const features = [...readFeatures(base), ...additions.map(parseFeature)];
  return sourceFromFeatures(features);
}
function sourceFromFeatures(features: readonly PartFeature[]): FeatureSource {
  validateSequence(features);
  const result = Object.freeze({ authorityProfile: "browser-typescript/v1" as const, units: "mm" as const, source: HEADER + features.map(line).join("") });
  if (new TextEncoder().encode(result.source).length > MODELING_LIMITS.maxSourceBytes) fail("invalid_source", "Source exceeds byte budget");
  return result;
}
export function emptyFeatureSource(): FeatureSource { return sourceFromFeatures([]); }
export function readFeatures(input: FeatureSource): readonly PartFeature[] {
  keys(input, ["authorityProfile", "units", "source"]);
  if (input.authorityProfile !== "browser-typescript/v1" || input.units !== "mm" || typeof input.source !== "string" || !input.source.startsWith(HEADER) || new TextEncoder().encode(input.source).length > MODELING_LIMITS.maxSourceBytes) fail("invalid_source", "Invalid browser TypeScript source or units");
  const body = input.source.slice(HEADER.length);
  const features: PartFeature[] = [];
  if (body) {
    if (!body.endsWith("\n")) fail("invalid_source", "Source must end in a newline");
    for (const text of body.slice(0, -1).split("\n")) {
      const match = /^part\.(rectangle|circle|polygon|extrude|revolve|hole|linearPattern|fillet|chamfer)\((\{.*\})\);$/.exec(text);
      if (!match) fail("invalid_source", "Only canonical named-feature calls are allowed");
      let value: unknown;
      try { value = JSON.parse(match![2]); } catch { return fail("invalid_source", "Malformed feature parameters"); }
      if (!value || typeof value !== "object" || Array.isArray(value) || Object.hasOwn(value, "kind")) fail("invalid_source", "Malformed feature call");
      features.push(parseFeature({ ...value, kind: match![1] }));
    }
  }
  validateSequence(features);
  // Reject duplicate JSON keys, extra syntax, noncanonical numbers/order and
  // multiple textual identities for the same source. Never execute source text.
  if (HEADER + features.map(line).join("") !== input.source) fail("invalid_source", "Noncanonical feature source");
  return Object.freeze(features);
}
export function featureSourceDigest(source: FeatureSource): string { readFeatures(source); return `sha256-${sha256Hex(source.source)}`; }
/** Parameter/name edit preserves stable feature IDs and validates all dependents. */
export function replaceFeature(base: FeatureSource, id: string, replacement: PartFeature): FeatureSource {
  const features = readFeatures(base);
  if (!features.some(f => f.id === id) || replacement.id !== id) fail("dependency_failure", "Replacement must preserve an existing feature identity");
  return sourceFromFeatures(features.map(f => f.id === id ? parseFeature(replacement) : f));
}
export function removeFeature(base: FeatureSource, id: string): FeatureSource {
  const features = readFeatures(base);
  if (!features.some(f => f.id === id)) fail("dependency_failure", "Feature not found");
  return sourceFromFeatures(features.filter(f => f.id !== id));
}
