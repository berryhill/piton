import { ModelingError, type ExtrudeFeature, type PartFeature, type PrincipalPlane, type ProfileFeature } from "./source";

export type Vector3 = readonly [number, number, number];
export interface WorkplaneFrame { readonly origin: Vector3; readonly localU: Vector3; readonly localV: Vector3; readonly normal: Vector3 }
const frames: Record<PrincipalPlane, Omit<WorkplaneFrame, "origin">> = {
  XY: { localU: [1, 0, 0], localV: [0, 1, 0], normal: [0, 0, 1] },
  XZ: { localU: [1, 0, 0], localV: [0, 0, 1], normal: [0, -1, 0] },
  YZ: { localU: [0, 1, 0], localV: [0, 0, 1], normal: [1, 0, 0] },
};
export const add3 = (a: Vector3, b: Vector3): Vector3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale3 = (a: Vector3, n: number): Vector3 => [a[0] * n, a[1] * n, a[2] * n];
export const dot3 = (a: Vector3, b: Vector3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export function principalFrame(plane: PrincipalPlane): WorkplaneFrame { return { origin: [0, 0, 0], ...frames[plane] }; }
export function extent(feature: ExtrudeFeature): readonly [number, number] {
  return feature.direction === "reverse" ? [-feature.distance, 0]
    : feature.direction === "symmetric" ? [-feature.distance / 2, feature.distance / 2] : [0, feature.distance];
}
/** Deterministic named-feature support only. No triangulated face identity or nearest-face search. */
export function resolveWorkplane(profile: ProfileFeature, earlier: readonly PartFeature[]): WorkplaneFrame {
  const basis = principalFrame(profile.plane);
  let frame = basis;
  if (profile.support) {
    const { featureId, side } = profile.support;
    const index = earlier.findIndex(f => f.id === featureId);
    if (index < 0) throw new ModelingError("dependency_failure", `${profile.id}: missing or forward extrusion cap ${featureId}`);
    const parent = earlier[index];
    if (parent.kind !== "extrude" || parent.operation === "cut" || parent.endCondition === "throughAll") throw new ModelingError("dependency_failure", `${profile.id}: ${featureId} is not a solid extrusion cap`);
    const parentProfile = earlier.slice(0, index).find(f => f.id === parent.profileId);
    if (!parentProfile || (parentProfile.kind !== "rectangle" && parentProfile.kind !== "circle" && parentProfile.kind !== "polygon"))
      throw new ModelingError("dependency_failure", `${profile.id}: missing parent profile ${parent.profileId}`);
    if (parentProfile.support) throw new ModelingError("unsupported_operation", `${profile.id}: nested extrusion cap support ${featureId} is not supported`);
    const parentFrame = resolveWorkplane(parentProfile, earlier.slice(0, index));
    const [start, end] = extent(parent);
    const displacement: Vector3 = [parent.x ?? 0, parent.y ?? 0, parent.z ?? 0];
    const outward = side === "end" ? 1 : -1;
    frame = { origin: add3(add3(parentFrame.origin, displacement), scale3(parentFrame.normal, side === "end" ? end : start)),
      localU: outward === 1 ? parentFrame.localU : scale3(parentFrame.localU, -1), localV: parentFrame.localV,
      normal: scale3(parentFrame.normal, outward) };
  }
  return { ...frame, origin: add3(frame.origin, scale3(frame.normal, profile.offset ?? 0)) };
}
