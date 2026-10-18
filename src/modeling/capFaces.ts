import { CIRCULAR_SEGMENTS, type FeatureEvaluation } from "./evaluator";
import { featureSourceDigest, ModelingError, readFeatures, type ExtrudeFeature, type FeatureSource, type PartFeature, type ProfileFeature } from "./source";
import { add3, dot3, extent, resolveWorkplane, scale3, type Vector3, type WorkplaneFrame } from "./workplanes";

/** Derived review-mesh hints only. Consumers must bind sourceDigest AND their exact
 * revision to the geometry before using an index; never persist triangle indices. */
export interface SurvivingCap {
  readonly featureId: string;
  readonly side: "start" | "end";
  readonly frame: WorkplaneFrame;
  readonly triangleIndices: readonly number[];
}
type CapResult = { readonly status: "missing" | "ambiguous" | "surviving"; readonly cap?: SurvivingCap };
const TOLERANCE = 1e-5;
const MAX_VERTICES = 2_000_000 / 3;
const MAX_TRIANGLES = 4_000_000 / 3;
const flipped = (vector: Vector3): Vector3 => [vector[0] ? -vector[0] : 0, vector[1] ? -vector[1] : 0, vector[2] ? -vector[2] : 0];
type Point = readonly [number, number];
type Triangle = readonly [Point, Point, Point];
const cross2 = (a: Point, b: Point, c: Point): number => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const area = (triangle: Triangle): number => Math.abs(cross2(...triangle)) / 2;
const local = (point: Vector3, frame: WorkplaneFrame): Point => {
  const delta: Vector3 = [point[0] - frame.origin[0], point[1] - frame.origin[1], point[2] - frame.origin[2]];
  return [dot3(delta, frame.localU), dot3(delta, frame.localV)];
};
function outline(profile: ProfileFeature): Point[] {
  if (profile.kind === "polygon") return [...profile.vertices];
  const [x, y] = profile.origin ?? [0, 0];
  if (profile.kind === "rectangle") return [[x, y], [x + profile.width, y], [x + profile.width, y + profile.height], [x, y + profile.height]];
  return Array.from({ length: CIRCULAR_SEGMENTS }, (_, i): Point => {
    const angle = 2 * Math.PI * i / CIRCULAR_SEGMENTS;
    return [x + profile.diameter / 2 * Math.cos(angle), y + profile.diameter / 2 * Math.sin(angle)];
  });
}
/** Ear triangulation keeps concave profiles from being mistaken for their convex hull. */
function triangulate(points: readonly Point[]): Triangle[] {
  const winding = points.reduce((sum, point, i) => {
    const next = points[(i + 1) % points.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0);
  const remaining = points.map((_, i) => i);
  if (winding < 0) remaining.reverse();
  const result: Triangle[] = [];
  while (remaining.length > 3) {
    let ear = false;
    for (let i = 0; i < remaining.length; i++) {
      const a = points[remaining[(i + remaining.length - 1) % remaining.length]];
      const b = points[remaining[i]];
      const c = points[remaining[(i + 1) % remaining.length]];
      if (cross2(a, b, c) <= 1e-10) continue;
      if (remaining.some((index, j) => j !== i && j !== (i + 1) % remaining.length && j !== (i + remaining.length - 1) % remaining.length
        && cross2(a, b, points[index]) >= -1e-10 && cross2(b, c, points[index]) >= -1e-10 && cross2(c, a, points[index]) >= -1e-10)) continue;
      result.push([a, b, c]); remaining.splice(i, 1); ear = true; break;
    }
    if (!ear) return []; // Unproven profile partition: fail closed.
  }
  result.push([points[remaining[0]], points[remaining[1]], points[remaining[2]]]);
  return result;
}
/** Area of a triangle clipped to another convex triangle. */
function overlap(subject: Triangle, clip: Triangle, tolerance = 1e-9): number {
  let polygon: Point[] = [...subject];
  for (let edge = 0; edge < 3 && polygon.length; edge++) {
    const a = clip[edge], b = clip[(edge + 1) % 3];
    const input = polygon; polygon = [];
    for (let i = 0; i < input.length; i++) {
      const p = input[i], q = input[(i + 1) % input.length];
      const cp = cross2(a, b, p), cq = cross2(a, b, q);
      if (cp >= -tolerance) polygon.push(p);
      if ((cp < -tolerance && cq > tolerance) || (cp > tolerance && cq < -tolerance)) {
        const t = cp / (cp - cq);
        polygon.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
      }
    }
  }
  if (polygon.length < 3) return 0;
  let sum = 0;
  for (let i = 1; i < polygon.length - 1; i++) sum += cross2(polygon[0], polygon[i], polygon[i + 1]) / 2;
  return Math.max(0, sum);
}
function covered(subject: Triangle, regions: readonly Triangle[], holes: readonly Triangle[] = []): boolean {
  const surface = area(subject);
  if (surface <= 1e-10 || !regions.length) return false;
  const inside = regions.reduce((sum, region) => sum + overlap(subject, region), 0);
  const removed = holes.reduce((sum, hole) => sum + overlap(subject, hole), 0);
  return inside - removed >= surface - Math.max(1e-7, surface * 1e-6);
}
function meshTriangle(frame: WorkplaneFrame, vertices: readonly number[], triangles: readonly number[], ordinal: number): Triangle {
  return [0, 1, 2].map(offset => {
    const index = triangles[ordinal * 3 + offset] * 3;
    return local([vertices[index], vertices[index + 1], vertices[index + 2]], frame);
  }) as unknown as Triangle;
}
function footprint(profile: ProfileFeature, frame: WorkplaneFrame, basis: WorkplaneFrame): { regions: Triangle[]; holes: Triangle[] } {
  const project = (point: Point): Point => local(add3(basis.origin, add3(scale3(basis.localU, point[0]), scale3(basis.localV, point[1]))), frame);
  const regions = triangulate(outline(profile).map(project));
  const holes = profile.kind === "circle" && profile.innerDiameter !== undefined
    ? triangulate(outline({ ...profile, diameter: profile.innerDiameter, innerDiameter: undefined }).map(project)) : [];
  return { regions, holes };
}

function expectedFrame(parent: ExtrudeFeature, profile: ProfileFeature, earlier: readonly PartFeature[], side: "start" | "end"): WorkplaneFrame {
  const basis = resolveWorkplane(profile, earlier);
  const [start, end] = extent(parent);
  const normal = side === "start" ? flipped(basis.normal) : basis.normal;
  const displacement: Vector3 = [parent.x ?? 0, parent.y ?? 0, parent.z ?? 0];
  return { origin: add3(add3(basis.origin, displacement), scale3(basis.normal, side === "start" ? start : end)),
    localU: side === "start" ? flipped(basis.localU) : basis.localU, localV: basis.localV, normal };
}

function capOnMesh(frame: WorkplaneFrame, vertices: readonly number[], triangles: readonly number[], featureId: string, side: "start" | "end", regions: readonly Triangle[], holes: readonly Triangle[]): CapResult {
  const positions = new Map<number, string>();
  const key = (index: number): string => {
    let result = positions.get(index);
    if (!result) {
      result = [0, 1, 2].map(axis => Math.round(vertices[index * 3 + axis] / TOLERANCE)).join(":");
      positions.set(index, result);
    }
    return result;
  };
  const edges = new Map<string, number[]>();
  const selected: number[] = [];
  for (let i = 0; i < triangles.length; i += 3) {
    const indices = triangles.slice(i, i + 3);
    const points = indices.map((index): Vector3 => [vertices[index * 3], vertices[index * 3 + 1], vertices[index * 3 + 2]]);
    if (points.some(point => Math.abs(dot3([point[0] - frame.origin[0], point[1] - frame.origin[1], point[2] - frame.origin[2]], frame.normal)) > TOLERANCE)) continue;
    const a = [points[1][0] - points[0][0], points[1][1] - points[0][1], points[1][2] - points[0][2]];
    const b = [points[2][0] - points[0][0], points[2][1] - points[0][1], points[2][2] - points[0][2]];
    const cross: Vector3 = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    if (dot3(cross, frame.normal) <= TOLERANCE * TOLERANCE) continue;
    const ordinal = i / 3;
    if (!covered(meshTriangle(frame, vertices, triangles, ordinal), regions, holes)) continue;
    selected.push(ordinal);
    for (const [u, v] of [[indices[0], indices[1]], [indices[1], indices[2]], [indices[2], indices[0]]]) {
      const pair = [key(u), key(v)].sort().join("|");
      const peers = edges.get(pair) ?? [];
      peers.push(ordinal);
      edges.set(pair, peers);
    }
  }
  if (!selected.length) return { status: "missing" };
  const adjacency = new Map(selected.map(index => [index, [] as number[]]));
  for (const peers of edges.values()) {
    if (peers.length > 2) return { status: "ambiguous" }; // Non-manifold welded edge.
    if (peers.length === 2) { adjacency.get(peers[0])!.push(peers[1]); adjacency.get(peers[1])!.push(peers[0]); }
  }
  const visited = new Set<number>();
  let components = 0;
  for (const index of selected) {
    if (visited.has(index)) continue;
    if (++components > 1) return { status: "ambiguous" };
    const stack = [index]; visited.add(index);
    while (stack.length) for (const neighbor of adjacency.get(stack.pop()!)!) if (!visited.has(neighbor)) { visited.add(neighbor); stack.push(neighbor); }
  }
  return { status: "surviving", cap: { featureId, side, frame, triangleIndices: selected } };
}

function inspectCaps(source: FeatureSource, geometry: Pick<FeatureEvaluation, "sourceDigest" | "vertices" | "triangles">): Map<string, CapResult> {
  const features = readFeatures(source);
  if (geometry.sourceDigest !== featureSourceDigest(source)) throw new ModelingError("geometry_failed", "Cap geometry does not match source");
  const { vertices, triangles } = geometry;
  if (!vertices.length || vertices.length % 3 || vertices.length / 3 > MAX_VERTICES || !triangles.length || triangles.length % 3 || triangles.length / 3 > MAX_TRIANGLES
    || vertices.some(v => !Number.isFinite(v)) || triangles.some(i => !Number.isSafeInteger(i) || i < 0 || i >= vertices.length / 3))
    throw new ModelingError("geometry_failed", "Invalid cap mesh or preview budget exceeded");
  const result = new Map<string, CapResult>();
  for (let i = 0; i < features.length; i++) {
    const parent = features[i];
    if (parent.kind !== "extrude" || parent.operation === "cut" || parent.endCondition === "throughAll") continue;
    const profile = features.slice(0, i).find(f => f.id === parent.profileId) as ProfileFeature | undefined;
    if (!profile || profile.support) continue; // Nested support is outside this bounded slice.
    for (const side of ["start", "end"] as const) {
      const frame = expectedFrame(parent, profile, features.slice(0, i), side);
      const basis = resolveWorkplane(profile, features.slice(0, i));
      const displacement: Vector3 = [parent.x ?? 0, parent.y ?? 0, parent.z ?? 0];
      const shape = footprint(profile, frame, { ...basis, origin: add3(basis.origin, displacement) });
      result.set(`${parent.id}:${side}`, capOnMesh(frame, vertices, triangles, parent.id, side, shape.regions, shape.holes));
    }
  }
  return result;
}

/** Pure derived candidates on this exact source/mesh pair, not persisted face IDs. */
export function enumerateSurvivingCaps(source: FeatureSource, geometry: Pick<FeatureEvaluation, "sourceDigest" | "vertices" | "triangles">): readonly SurvivingCap[] {
  return [...inspectCaps(source, geometry).values()].flatMap(result => result.cap ? [result.cap] : []);
}

/** Reject missing and split nominal caps against the current body at this step. */
export function assertSurvivingCap(profile: ProfileFeature, source: FeatureSource, geometry: Pick<FeatureEvaluation, "sourceDigest" | "vertices" | "triangles">, consumer?: ExtrudeFeature, actualExtent?: readonly [number, number]): void {
  if (!profile.support) return;
  const { featureId, side } = profile.support;
  const result = inspectCaps(source, geometry).get(`${featureId}:${side}`);
  if (result?.status !== "surviving") throw new ModelingError("dependency_failure", `${profile.id}: ${featureId} ${side} cap ${result?.status === "ambiguous" ? "ambiguous" : "missing"} on current body`);
  // A declared sketch has no effective footprint until an extrusion consumes it.
  if (!consumer) return;
  const cap = result.cap!;
  const basis = resolveWorkplane(profile, readFeatures(source));
  const displacement: Vector3 = [consumer.x ?? 0, consumer.y ?? 0, consumer.z ?? 0];
  const placed: WorkplaneFrame = { ...basis, origin: add3(basis.origin, displacement) };
  const normalOffset = dot3([placed.origin[0] - cap.frame.origin[0], placed.origin[1] - cap.frame.origin[1], placed.origin[2] - cap.frame.origin[2]], cap.frame.normal);
  const [start, end] = actualExtent ?? extent(consumer);
  // Projection alone cannot establish that the placed extrusion touches this cap.
  if (normalOffset + start > TOLERANCE || normalOffset + end < -TOLERANCE)
    throw new ModelingError("dependency_failure", `${profile.id}: extrusion displaced from surviving ${featureId} ${side} cap`);
  const shape = footprint(profile, cap.frame, placed);
  const surviving = cap.triangleIndices.map(index => meshTriangle(cap.frame, geometry.vertices, geometry.triangles, index));
  // Additions need full support. A cut can open at an edge, but its placed
  // material must overlap this named surviving cap. A holed cutter cannot be
  // certified by outer overlap alone; fail closed instead of counting its void.
  if (consumer.operation === "cut" && shape.holes.length)
    throw new ModelingError("dependency_failure", `${profile.id}: holed cutter cap overlap cannot be proven`);
  const admitted = consumer.operation === "cut"
    ? shape.regions.some(region => surviving.some(triangle => overlap(region, triangle, 0) > 0))
    : shape.regions.length > 0 && shape.regions.every(region => covered(region, surviving));
  if (!admitted)
    throw new ModelingError("dependency_failure", `${profile.id}: footprint outside surviving ${featureId} ${side} cap`);
}
