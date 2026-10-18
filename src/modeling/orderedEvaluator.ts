import type { CrossSection, Manifold, ManifoldToplevel } from "manifold-3d";
import { SAFETY_TRUTH } from "../domain";
import { CIRCULAR_SEGMENTS, measureMesh, MODELING_ENVIRONMENT_DIGEST, type FeatureEvaluation, type GeometryCheck } from "./evaluator";
import { featureSourceDigest, ModelingError, type FeatureSource, type PartFeature, type ProfileFeature } from "./source";
import { add3, dot3, extent, resolveWorkplane, scale3, type Vector3 } from "./workplanes";
import { assertSurvivingCap } from "./capFaces";
import { appendFeatures, emptyFeatureSource } from "./source";

/** Check every undirected triangle edge occurs twice with opposite winding. */
function invalidEdges(triangles: readonly number[]): number {
  const edges = new Map<string, { count: number; winding: number }>();
  for (let i = 0; i < triangles.length; i += 3) {
    const [a, b, c] = triangles.slice(i, i + 3);
    if (a === b || b === c || c === a) return 1;
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const key = `${Math.min(u, v)}:${Math.max(u, v)}`;
      const edge = edges.get(key) ?? { count: 0, winding: 0 };
      edge.count++;
      edge.winding += u < v ? 1 : -1;
      edges.set(key, edge);
    }
  }
  return [...edges.values()].filter(edge => edge.count !== 2 || edge.winding !== 0).length;
}

/** Ordered operations are a restricted alternate review realization, never authored state. */
export function evaluateOrderedSource(source: FeatureSource, features: readonly PartFeature[], kernel: ManifoldToplevel): FeatureEvaluation {
  const resources: (Manifold | CrossSection)[] = [];
  const own = <T extends Manifold | CrossSection>(resource: T): T => { resources.push(resource); return resource; };
  const profiles = new Map<string, ProfileFeature>();
  const earlier: PartFeature[] = [];
  let solid: Manifold | undefined;
  const checkCap = (profile: ProfileFeature, consumer?: Extract<PartFeature, { kind: "extrude" }>, actualExtent?: readonly [number, number]): void => {
    if (!profile.support) return;
    if (!solid) throw new ModelingError("dependency_failure", `${profile.id}: support has no current body`);
    const mesh = solid.getMesh();
    const vertices: number[] = [];
    for (let i = 0; i < mesh.vertProperties.length; i += mesh.numProp) vertices.push(mesh.vertProperties[i], mesh.vertProperties[i + 1], mesh.vertProperties[i + 2]);
    const partial = appendFeatures(emptyFeatureSource(), earlier);
    assertSurvivingCap(profile, partial, { sourceDigest: featureSourceDigest(partial), vertices, triangles: Array.from(mesh.triVerts) }, consumer, actualExtent);
  };
  try {
    for (const feature of features) {
      if (feature.kind === "rectangle" || feature.kind === "circle" || feature.kind === "polygon") {
        checkCap(feature);
        profiles.set(feature.id, feature); earlier.push(feature); continue;
      }
      if (feature.kind !== "extrude") throw new ModelingError("unsupported_operation", `${feature.id}: unsupported ordered feature`);
      const profile = profiles.get(feature.profileId)!; // source parser validates dependency and order.
      const section = own(profile.kind === "rectangle" ? kernel.CrossSection.square([profile.width, profile.height])
        : profile.kind === "circle" ? kernel.CrossSection.circle(profile.diameter / 2, CIRCULAR_SEGMENTS)
          : new kernel.CrossSection([profile.vertices.map(([x, y]) => [x, y] as [number, number])]));
      const annulus = profile.kind === "circle" && profile.innerDiameter !== undefined
        ? own(section.subtract(own(kernel.CrossSection.circle(profile.innerDiameter / 2, CIRCULAR_SEGMENTS)))) : section;
      const locatedSection = profile.kind !== "polygon" && profile.origin ? own(annulus.translate([...profile.origin])) : annulus;
      const frame = resolveWorkplane(profile, earlier);
      const translation: Vector3 = [feature.x ?? 0, feature.y ?? 0, feature.z ?? 0];
      let [start, end] = extent(feature);
      if (feature.endCondition === "throughAll") {
        if (!solid || feature.operation !== "cut") throw new ModelingError("unsupported_operation", `${feature.id}: throughAll requires a cut on an existing body`);
        // Project the current body bounding corners onto the cutter normal.
        // This is a bounded derived mesh extent, not a guessed long cylinder.
        const bounds = solid.boundingBox();
        const offsets = [bounds.min[0], bounds.max[0]].flatMap(x => [bounds.min[1], bounds.max[1]].flatMap(y =>
          [bounds.min[2], bounds.max[2]].map(z => dot3([x - frame.origin[0] - translation[0], y - frame.origin[1] - translation[1], z - frame.origin[2] - translation[2]], frame.normal))));
        const epsilon = 0.01;
        const minimum = Math.min(...offsets), maximum = Math.max(...offsets);
        start = feature.direction === "reverse" || feature.direction === "symmetric" ? Math.min(minimum - epsilon, 0) : 0;
        end = feature.direction === "reverse" ? 0 : Math.max(maximum + epsilon, 0);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end - start <= 0 || end - start > 5000) throw new ModelingError("geometry_failed", `${feature.id}: throughAll direction does not intersect body or exceeds cutter extent`);
      }
      checkCap(profile, feature, [start, end]);
      const extrusion = own(locatedSection.extrude(end - start));
      const origin = add3(add3(frame.origin, translation), scale3(frame.normal, start));
      // Mat4 is column-major: local U, V, normal, then translation.
      const [u, v, n] = [frame.localU, frame.localV, frame.normal];
      const located = own(extrusion.transform([u[0], u[1], u[2], 0, v[0], v[1], v[2], 0,
        n[0], n[1], n[2], 0, origin[0], origin[1], origin[2], 1]));
      earlier.push(feature);
      if (!solid) { solid = located; continue; }
      const previous = solid.volume();
      const next = own(feature.operation === "cut" ? solid.subtract(located) : kernel.Manifold.union(solid, located));
      if (next.status() !== "NoError" || next.isEmpty()) throw new ModelingError("geometry_failed", `${feature.id}: invalid or empty body`);
      const volume = next.volume();
      const tolerance = Math.max(1e-6, previous * 1e-8);
      if (feature.operation === "cut" && volume >= previous - tolerance) throw new ModelingError("geometry_failed", `${feature.id}: cut does not intersect body`);
      if (feature.operation === "add" && volume <= previous + tolerance) throw new ModelingError("geometry_failed", `${feature.id}: addition does not grow body`);
      const components = next.decompose();
      try { if (components.length !== 1) throw new ModelingError("geometry_failed", `${feature.id}: disconnected body`); }
      finally { for (const component of components) component.delete(); }
      solid = next;
    }
    if (!solid || solid.status() !== "NoError" || solid.isEmpty()) throw new ModelingError("geometry_failed", "A valid extrusion is required for a solid preview");
    const mesh = solid.getMesh();
    const vertices: number[] = [];
    for (let i = 0; i < mesh.vertProperties.length; i += mesh.numProp) vertices.push(mesh.vertProperties[i], mesh.vertProperties[i + 1], mesh.vertProperties[i + 2]);
    const triangles = Array.from(mesh.triVerts);
    if (vertices.length > 2_000_000 || triangles.length > 4_000_000) throw new ModelingError("geometry_failed", "Mesh exceeds preview budget");
    const measured = measureMesh(vertices, triangles);
    const bounds = solid.boundingBox();
    const checks: GeometryCheck[] = [];
    const check = (name: string, actual: number, expected: number, tolerance: number) => checks.push({ name, actual, expected, tolerance, passed: Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance });
    check("kernel volume vs independent mesh", solid.volume(), measured.volumeMm3, Math.max(1e-6, measured.volumeMm3 * 1e-6));
    check("oriented manifold mesh edges", invalidEdges(triangles), 0, 0);
    for (const side of ["min", "max"] as const) for (let axis = 0; axis < 3; axis++) check(`kernel bounds ${side}[${axis}] vs independent mesh`, bounds[side][axis], measured.bounds[side][axis], 0.0001);
    if (checks.some(c => !c.passed)) throw new ModelingError("geometry_failed", `Independent ordered mesh validation failed: ${checks.filter(c => !c.passed).map(c => c.name).join(", ")}`);
    return { sourceDigest: featureSourceDigest(source), environmentDigest: MODELING_ENVIRONMENT_DIGEST, claimScope: "review-mesh-only", units: "mm", vertices, triangles, ...measured, checks: Object.freeze(checks), ...SAFETY_TRUTH };
  } catch (error) {
    if (error instanceof ModelingError) throw error;
    throw new ModelingError("geometry_failed", error instanceof Error ? error.message : "Manifold evaluation failed");
  } finally {
    for (const resource of resources.reverse()) resource.delete();
  }
}
