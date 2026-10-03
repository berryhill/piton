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
  | (Named & { readonly kind: "circle"; readonly plane: "XY"; readonly diameter: number });
export type ExtrudeFeature = Named & { readonly kind: "extrude"; readonly profileId: string; readonly distance: number };
export type HoleFeature = Named & { readonly kind: "hole"; readonly bodyId: string; readonly x: number; readonly y: number; readonly diameter: number; readonly extent: "through" };
export type PartFeature = ProfileFeature | ExtrudeFeature | HoleFeature;
export type ModelingErrorCode = "invalid_source" | "invalid_feature" | "dependency_failure" | "unsupported_operation" | "geometry_failed";
export class ModelingError extends Error {
  constructor(readonly code: ModelingErrorCode, message: string) { super(message); this.name = "ModelingError"; }
}
export const MODELING_LIMITS = Object.freeze({ maxFeatures: 66, maxSourceBytes: 32768, minDimension: 0.1, maxDimension: 1000, minWall: 0.01 });
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
function parseFeature(value: unknown): PartFeature {
  if (!value || typeof value !== "object") return fail("invalid_feature", "Feature must be an object");
  const f = value as Record<string, unknown>;
  const common = ["id", "name", "kind"];
  switch (f.kind) {
    case "rectangle": keys(f, [...common, "plane", "width", "height"]); dimension(f.width); dimension(f.height); break;
    case "circle": keys(f, [...common, "plane", "diameter"]); dimension(f.diameter); break;
    case "extrude": keys(f, [...common, "profileId", "distance"]); identity(f.profileId); dimension(f.distance); break;
    case "hole":
      keys(f, [...common, "bodyId", "x", "y", "diameter", "extent"]); identity(f.bodyId); dimension(f.diameter);
      if (f.extent !== "through") fail("unsupported_operation", "Only through holes are supported");
      for (const v of [f.x, f.y]) if (typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > 1000) fail("invalid_feature", "Hole coordinates must be finite mm coordinates within +/-1000");
      break;
    default: return fail("unsupported_operation", "Unsupported named feature");
  }
  identity(f.id);
  if (typeof f.name !== "string" || !f.name.trim() || f.name !== f.name.trim() || f.name.length > 100 || /[\u0000-\u001f]/.test(f.name)) fail("invalid_feature", "Name must contain 1–100 visible characters without surrounding whitespace");
  if ((f.kind === "rectangle" || f.kind === "circle") && f.plane !== "XY") fail("unsupported_operation", "Only the XY reference plane is supported; extrusion is along +Z");
  return Object.freeze({ ...f }) as unknown as PartFeature;
}

function validateSequence(features: readonly PartFeature[]): void {
  if (features.length > MODELING_LIMITS.maxFeatures) fail("invalid_source", "Feature count exceeds limit");
  const ids = new Set<string>();
  let profile: ProfileFeature | undefined;
  let body: ExtrudeFeature | undefined;
  const holes: HoleFeature[] = [];
  for (const f of features) {
    if (ids.has(f.id)) fail("invalid_feature", "Duplicate feature identity");
    ids.add(f.id);
    if (f.kind === "rectangle" || f.kind === "circle") {
      if (profile || body) fail("unsupported_operation", "This bounded source supports one profile and one extruded body");
      profile = f;
    } else if (f.kind === "extrude") {
      if (!profile || f.profileId !== profile.id) fail("dependency_failure", "Extrude must reference the preceding profile");
      if (body) fail("unsupported_operation", "Only one extrusion is supported");
      body = f;
    } else {
      if (!profile || !body || f.bodyId !== body.id) fail("dependency_failure", "Hole must reference the preceding extruded body");
      const r = f.diameter / 2 + MODELING_LIMITS.minWall;
      if (profile.kind === "rectangle" ? f.x < r || f.y < r || f.x > profile.width - r || f.y > profile.height - r : Math.hypot(f.x, f.y) + r > profile.diameter / 2) fail("invalid_feature", "Hole must remain inside the profile with positive wall thickness");
      if (holes.some(h => Math.hypot(h.x - f.x, h.y - f.y) < (h.diameter + f.diameter) / 2 + MODELING_LIMITS.minWall)) fail("invalid_feature", "Holes must not overlap or touch");
      holes.push(f);
    }
  }
}
function line(feature: PartFeature): string {
  // Fixed field order makes serialization independent of caller object order.
  const { kind, id, name } = feature;
  const parameters = kind === "rectangle" ? { id, name, plane: feature.plane, width: feature.width, height: feature.height }
    : kind === "circle" ? { id, name, plane: feature.plane, diameter: feature.diameter }
    : kind === "extrude" ? { id, name, profileId: feature.profileId, distance: feature.distance }
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
      const match = /^part\.(rectangle|circle|extrude|hole)\((\{.*\})\);$/.exec(text);
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
