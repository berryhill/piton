import type { ReactNode } from "react";
import { Vector3, type PerspectiveCamera } from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { cameraPresetDirection, fitCameraToBounds, meshBounds, rolledCameraUp, type CameraPreset, type MeshBounds } from "../geometry/view";

export type CameraFrame = "cad-z-up" | "feature-display";
export type CameraAction = CameraPreset | "fit" | "reset" | "roll";

type CameraPose = { position: number[]; up: number[]; target: number[]; near: number; far: number };
const reviewViews = new Map<string, CameraPose>();
export function rememberCamera(key: string | undefined, camera: PerspectiveCamera, target: Vector3) {
  if (!key) return;
  reviewViews.delete(key);
  reviewViews.set(key, { position: camera.position.toArray(), up: camera.up.toArray(), target: target.toArray(), near: camera.near, far: camera.far });
  if (reviewViews.size > 128) reviewViews.delete(reviewViews.keys().next().value!);
}
export function restoreCamera(key: string | undefined, camera: PerspectiveCamera, controls: Pick<OrbitControls, 'target' | 'update'>) {
  const pose = key ? reviewViews.get(key) : undefined;
  if (!pose) return false;
  camera.position.fromArray(pose.position); camera.up.fromArray(pose.up); controls.target.fromArray(pose.target);
  camera.near = pose.near; camera.far = pose.far;
  camera.updateProjectionMatrix(); camera.lookAt(controls.target); controls.update();
  return true;
}

/** Read-only projection of the real camera, used by review diagnostics. */
export function recordCameraPose(host: HTMLElement, camera: PerspectiveCamera, target: Vector3) {
  host.dataset.cameraPosition = JSON.stringify(camera.position.toArray());
  host.dataset.cameraUp = JSON.stringify(camera.up.toArray());
  host.dataset.cameraTarget = JSON.stringify(target.toArray());
}

/** Feature triangles use (CAD x, CAD z, -CAD y); imported triangles stay CAD Z-up. */
export function cadToDisplay(vector: Vector3, frame: CameraFrame): Vector3 {
  return frame === "feature-display" ? new Vector3(vector.x, vector.z, -vector.y) : vector.clone();
}
export function displayToCad(vector: Vector3, frame: CameraFrame): Vector3 {
  return frame === "feature-display" ? new Vector3(vector.x, -vector.z, vector.y) : vector.clone();
}

/** View changes are camera-only: no revision, mesh, selection or measurement write. */
export function applyCameraAction(camera: PerspectiveCamera, controls: Pick<OrbitControls, "target" | "update">, bounds: MeshBounds, frame: CameraFrame, action: CameraAction) {
  const target = cadToDisplay(new Vector3(...bounds.center), frame);
  let direction = displayToCad(camera.position.clone().sub(controls.target), frame).normalize();
  let up = displayToCad(camera.up, frame).normalize();
  if (action === "roll") {
    const rolled = rolledCameraUp({ x: up.x, y: up.y, z: up.z }, { x: -direction.x, y: -direction.y, z: -direction.z }, Math.PI / 12);
    camera.up.copy(cadToDisplay(new Vector3(rolled.x, rolled.y, rolled.z), frame)).normalize();
    camera.lookAt(controls.target);
    controls.update();
    return;
  }
  if (action !== "fit") {
    const preset = action === "reset" ? "iso" : action;
    const vector = cameraPresetDirection(preset);
    direction = new Vector3(vector.x, vector.y, vector.z).normalize();
    // CAD +Y is the screen-up axis for top; CAD +Z would be parallel to the sight line.
    up = preset === "top" ? new Vector3(0, 1, 0) : new Vector3(0, 0, 1);
  }
  // Fit the eight CAD corners in the ACTUAL view basis (including roll), rather
  // than fitting an unrolled preset and clipping long parts after a roll.
  const right = new Vector3().crossVectors(up, direction).normalize();
  if (right.lengthSq() < 1e-12) throw new Error("camera up is parallel to the view direction");
  const vertical = new Vector3().crossVectors(direction, right).normalize();
  const projected: number[] = [];
  for (const x of [bounds.min[0], bounds.max[0]]) for (const y of [bounds.min[1], bounds.max[1]]) for (const z of [bounds.min[2], bounds.max[2]]) {
    const offset = new Vector3(x, y, z).sub(new Vector3(...bounds.center));
    projected.push(offset.dot(right), offset.dot(vertical), offset.dot(direction));
  }
  const fit = fitCameraToBounds(meshBounds(projected), camera.fov, camera.aspect, { x: 0, y: 0, z: 1 });
  controls.target.copy(target);
  camera.position.copy(target).add(cadToDisplay(direction.multiplyScalar(fit.distance), frame));
  camera.up.copy(cadToDisplay(up, frame));
  camera.near = fit.near;
  camera.far = fit.far;
  camera.updateProjectionMatrix();
  camera.lookAt(target);
  controls.update();
  return fit;
}

export type ViewHost = HTMLDivElement & {
  resetView?: () => void;
  rollView?: () => void;
  setView?: (preset: CameraPreset) => void;
  fitView?: () => void;
};

export function ViewControls({ host, unavailable }: { host: React.RefObject<HTMLDivElement | null>; unavailable?: string | null }): ReactNode {
  const run = (action: CameraAction) => {
    if (unavailable) return;
    const node = host.current as ViewHost | null;
    if (action === "reset") node?.resetView?.();
    else if (action === "fit") node?.fitView?.();
    else if (action === "roll") node?.rollView?.();
    else node?.setView?.(action);
  };
  return <div className="view-actions" aria-label="Review camera controls">
    {unavailable && <span role="status">Camera controls unavailable: {unavailable}</span>}
    {(["iso", "front", "top", "fit", "roll", "reset"] as const).map(action =>
      <button key={action} type="button" disabled={!!unavailable} title={unavailable ?? undefined} onClick={() => run(action)}>
        {action === "roll" ? "Roll 15°" : action === "reset" ? "Reset / fit" : action[0].toUpperCase() + action.slice(1)}
      </button>)}
  </div>;
}
