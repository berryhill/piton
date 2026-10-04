import type { CrossSection, Manifold, ManifoldToplevel } from "manifold-3d";
import { SAFETY_TRUTH, sha256Hex } from "../domain";
import { featureSourceDigest, FILLET_CORNER_SEGMENTS, ModelingError, readFeatures, type FeatureSource, type HoleFeature } from "./source";

export const CIRCULAR_SEGMENTS = 256;
/** Four quarter arcs with 64 chords each; other perimeter surfaces stay planar. */
const CORNER_SEGMENTS = FILLET_CORNER_SEGMENTS;
export const MODELING_ENVIRONMENT = Object.freeze({ kernel: "manifold-3d@3.3.2", segments: CIRCULAR_SEGMENTS, cornerSegments: CORNER_SEGMENTS, units: "mm", frame: "XY/+Z", claimScope: "review-mesh-only" as const });
export const MODELING_ENVIRONMENT_DIGEST = `sha256-${sha256Hex(JSON.stringify(MODELING_ENVIRONMENT))}`;
export type Bounds = { min: [number, number, number]; max: [number, number, number] };
export interface GeometryCheck { readonly name: string; readonly passed: boolean; readonly actual: number; readonly expected: number; readonly tolerance: number }
export interface FeatureEvaluation {
  readonly sourceDigest: string;
  readonly environmentDigest: string;
  readonly claimScope: "review-mesh-only";
  readonly units: "mm";
  readonly vertices: number[];
  readonly triangles: number[];
  readonly bounds: Bounds;
  readonly volumeMm3: number;
  readonly checks: readonly GeometryCheck[];
  readonly reviewState: "needs_human_review";
  readonly fabricationRelease: false;
  readonly machineActuation: false;
  readonly releaseState: "unreleased";
}

/** Independent of Manifold's boundingBox()/volume(): read the actual triangles.
 * This is a review-mesh check, not a B-rep/exact geometry claim. */
export function measureMesh(vertices: readonly number[], triangles: readonly number[]): { bounds: Bounds; volumeMm3: number } {
  if (!vertices.length || vertices.length % 3 || !triangles.length || triangles.length % 3 || vertices.some(v => !Number.isFinite(v)) || triangles.some(i => !Number.isSafeInteger(i) || i < 0 || i >= vertices.length / 3)) throw new ModelingError("geometry_failed", "Invalid mesh payload");
  const min: Bounds["min"] = [Infinity, Infinity, Infinity];
  const max: Bounds["max"] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < vertices.length; i += 3) for (let axis = 0; axis < 3; axis++) {
    min[axis] = Math.min(min[axis], vertices[i + axis]);
    max[axis] = Math.max(max[axis], vertices[i + axis]);
  }
  let volume = 0;
  for (let i = 0; i < triangles.length; i += 3) {
    const a = triangles[i] * 3, b = triangles[i + 1] * 3, c = triangles[i + 2] * 3;
    volume += (vertices[a] * (vertices[b + 1] * vertices[c + 2] - vertices[b + 2] * vertices[c + 1])
      + vertices[a + 1] * (vertices[b + 2] * vertices[c] - vertices[b] * vertices[c + 2])
      + vertices[a + 2] * (vertices[b] * vertices[c + 1] - vertices[b + 1] * vertices[c])) / 6;
  }
  if (!Number.isFinite(volume) || volume <= 0) throw new ModelingError("geometry_failed", "Mesh must enclose positive oriented volume");
  return { bounds: { min, max }, volumeMm3: volume };
}

/** Derived review cross-section only; source remains the authored authority. */
function finishedRectangle(width: number, height: number, kind: "fillet" | "chamfer", d: number): [number, number][] {
  if (kind === "chamfer") return [[d, 0], [width - d, 0], [width, d], [width, height - d],
    [width - d, height], [d, height], [0, height - d], [0, d]];
  const corners: [number, number, number][] = [
    [width - d, d, -Math.PI / 2], [width - d, height - d, 0],
    [d, height - d, Math.PI / 2], [d, d, Math.PI],
  ];
  return corners.flatMap(([cx, cy, start]) => Array.from({ length: CORNER_SEGMENTS + 1 }, (_, i): [number, number] => {
    const angle = start + i * Math.PI / (2 * CORNER_SEGMENTS);
    return [cx + d * Math.cos(angle), cy + d * Math.sin(angle)];
  }));
}

/** Synchronous kernel work belongs in a bounded browser worker. No application
 * state is read/written here; callers bind sourceDigest to their revision/build. */
export function evaluateFeatureSource(source: FeatureSource, kernel: ManifoldToplevel): FeatureEvaluation {
  const features = readFeatures(source);
  const profile = features.find(f => f.kind === "rectangle" || f.kind === "circle" || f.kind === "polygon");
  const extrusion = features.find(f => f.kind === "extrude");
  const revolve = features.find(f => f.kind === "revolve");
  const finish = features.find(f => f.kind === "fillet" || f.kind === "chamfer");
  if (!profile || (!extrusion && !revolve)) throw new ModelingError("geometry_failed", "A profile and extrusion or revolve are required for a solid preview");
  // Derived review cutters only: the pattern stays one named source operation.
  const sources = new Map(features.filter((f): f is HoleFeature => f.kind === "hole").map(h => [h.id, h]));
  const holes = features.flatMap(f => f.kind === "hole" ? [f] : f.kind === "linearPattern"
    ? Array.from({ length: f.count - 1 }, (_, index) => {
        const source = sources.get(f.sourceHoleId)!; // readFeatures validated reference and placement.
        return { ...source, x: source.x + (index + 1) * f.spacingX, y: source.y + (index + 1) * f.spacingY };
      }) : []);
  const resources: (Manifold | CrossSection)[] = [];
  function own<T extends Manifold | CrossSection>(object: T): T { resources.push(object); return object; }
  try {
    const crossSection = own(profile.kind === "rectangle"
      ? finish ? new kernel.CrossSection([finishedRectangle(profile.width, profile.height, finish.kind, finish.kind === "fillet" ? finish.radius : finish.distance)])
        : kernel.CrossSection.square([profile.width, profile.height])
      : profile.kind === "circle" ? kernel.CrossSection.circle(profile.diameter / 2, CIRCULAR_SEGMENTS)
      : new kernel.CrossSection([profile.vertices.map(v => [v[0], v[1]] as [number, number])]));
    let solid = own(revolve ? crossSection.revolve(CIRCULAR_SEGMENTS, 360) : crossSection.extrude(extrusion!.distance));
    for (const hole of holes) {
      // Extend beyond both surfaces so coplanar cutter faces cannot cap a hole.
      const cutter = own(kernel.Manifold.cylinder(extrusion!.distance + 2, hole.diameter / 2, hole.diameter / 2, CIRCULAR_SEGMENTS));
      const located = own(cutter.translate([hole.x, hole.y, -1]));
      solid = own(solid.subtract(located));
    }
    if (solid.status() !== "NoError" || solid.isEmpty()) throw new ModelingError("geometry_failed", "Manifold did not produce a valid nonempty solid");
    const mesh = solid.getMesh();
    const vertices: number[] = [];
    for (let i = 0; i < mesh.vertProperties.length; i += mesh.numProp) vertices.push(mesh.vertProperties[i], mesh.vertProperties[i + 1], mesh.vertProperties[i + 2]);
    const triangles = Array.from(mesh.triVerts);
    const measured = measureMesh(vertices, triangles);
    const radius = profile.kind === "circle" ? profile.diameter / 2 : 0;
    const polygonBounds = profile.kind === "polygon" ? {
      min: [Math.min(...profile.vertices.map(v => v[0])), Math.min(...profile.vertices.map(v => v[1])), 0] as Bounds["min"],
      max: [Math.max(...profile.vertices.map(v => v[0])), Math.max(...profile.vertices.map(v => v[1])), extrusion?.distance ?? 0] as Bounds["max"],
    } : undefined;
    const radialMax = profile.kind === "rectangle" ? profile.width : polygonBounds?.max[0] ?? 0;
    const expectedBounds: Bounds = revolve
      ? { min: [-radialMax, -radialMax, polygonBounds?.min[1] ?? 0],
          max: [radialMax, radialMax, polygonBounds?.max[1] ?? (profile.kind === "rectangle" ? profile.height : 0)] }
      : profile.kind === "rectangle"
        ? { min: [0, 0, 0], max: [profile.width, profile.height, extrusion!.distance] }
        : polygonBounds ?? { min: [-radius, -radius, 0], max: [radius, radius, extrusion!.distance] };
    const finishSize = finish ? finish.kind === "fillet" ? finish.radius : finish.distance : 0;
    const analyticArea = profile.kind === "rectangle" ? profile.width * profile.height - (finish?.kind === "fillet" ? (4 - Math.PI) * finishSize ** 2 : finish?.kind === "chamfer" ? 2 * finishSize ** 2 : 0) : profile.kind === "circle" ? Math.PI * radius ** 2
      : profile.vertices.slice(1, -1).reduce((sum, vertex, i) => {
        const origin = profile.vertices[0], next = profile.vertices[i + 2];
        return sum + ((vertex[0] - origin[0]) * (next[1] - origin[1]) - (vertex[1] - origin[1]) * (next[0] - origin[0])) / 2;
      }, 0);
    // Integrate pi*r² dz along each CCW radial-axial contour edge.
    const radialVertices = profile.kind === "rectangle" ? [[0, 0], [profile.width, 0], [profile.width, profile.height], [0, profile.height]]
      : profile.kind === "polygon" ? profile.vertices : [];
    const revolveVolume = Math.PI / 3 * radialVertices.reduce((sum, a, i) => {
      const b = radialVertices[(i + 1) % radialVertices.length];
      return sum + (a[0] ** 2 + a[0] * b[0] + b[0] ** 2) * (b[1] - a[1]);
    }, 0);
    const analyticVolume = revolve ? revolveVolume : (analyticArea - holes.reduce((sum, h) => sum + Math.PI * (h.diameter / 2) ** 2, 0)) * extrusion!.distance;
    // Declared error bound from each circle's regular inscribed polygon area;
    // use sum, not net volume, so thin annuli retain a meaningful bound.
    const polygonError = 1 - CIRCULAR_SEGMENTS * Math.sin(2 * Math.PI / CIRCULAR_SEGMENTS) / (2 * Math.PI);
    const curvedArea = (profile.kind === "circle" ? analyticArea : 0) + holes.reduce((sum, h) => sum + Math.PI * (h.diameter / 2) ** 2, 0);
    // Four quarter-arc chord area shortfall relative to analytic circular arcs.
    const cornerErrorArea = finish?.kind === "fillet" ? finishSize ** 2 * (Math.PI - 2 * CORNER_SEGMENTS * Math.sin(Math.PI / (2 * CORNER_SEGMENTS))) : 0;
    const volumeTolerance = (revolve ? analyticVolume : curvedArea * extrusion!.distance) * polygonError * 1.02
      + cornerErrorArea * (extrusion?.distance ?? 0) * 1.02 + Math.max(1e-6, analyticVolume * 1e-6);
    const checks: GeometryCheck[] = [];
    const check = (name: string, actual: number, expected: number, tolerance: number) => checks.push({ name, actual, expected, tolerance, passed: Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance });
    check("independent analytic volume vs mesh", measured.volumeMm3, analyticVolume, volumeTolerance);
    check("kernel volume vs independent mesh", solid.volume(), measured.volumeMm3, Math.max(1e-6, measured.volumeMm3 * 1e-6));
    for (const side of ["min", "max"] as const) for (let axis = 0; axis < 3; axis++) check(`independent bounds ${side}[${axis}]`, measured.bounds[side][axis], expectedBounds[side][axis], 0.0001);
    if (checks.some(c => !c.passed)) throw new ModelingError("geometry_failed", `Independent geometry validation failed: ${checks.filter(c => !c.passed).map(c => c.name).join(", ")}`);
    return { sourceDigest: featureSourceDigest(source), environmentDigest: MODELING_ENVIRONMENT_DIGEST, claimScope: "review-mesh-only", units: "mm", vertices, triangles, ...measured, checks: Object.freeze(checks), ...SAFETY_TRUTH };
  } catch (error) {
    if (error instanceof ModelingError) throw error;
    throw new ModelingError("geometry_failed", error instanceof Error ? error.message : "Manifold evaluation failed");
  } finally {
    for (const resource of resources.reverse()) resource.delete();
  }
}
