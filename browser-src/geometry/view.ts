import type { LBracketParameters } from "../domain";

export interface Vector3Value {
  x: number;
  y: number;
  z: number;
}

export interface ParameterZone {
  center: [number, number, number];
  size: [number, number, number];
}

export interface MeshBounds {
  min: [number, number, number];
  max: [number, number, number];
  size: [number, number, number];
  center: [number, number, number];
}

export interface CameraFit {
  target: [number, number, number];
  position: [number, number, number];
  distance: number;
  near: number;
  far: number;
}

export type CameraPreset = "iso" | "front" | "top";

export function cameraPresetDirection(preset: CameraPreset): Vector3Value {
  if (preset === "front") return { x: 0, y: -1, z: 0 };
  if (preset === "top") return { x: 0, y: 0, z: 1 };
  return { x: 1, y: -1, z: 0.75 };
}

export function reviewDistanceMm(
  start: [number, number, number],
  end: [number, number, number],
): number {
  return Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]);
}

export function meshBounds(vertices: number[]): MeshBounds {
  if (vertices.length < 3 || vertices.length % 3 !== 0 || vertices.some((value) => !Number.isFinite(value))) {
    throw new Error("cannot derive bounds from malformed geometry");
  }
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < vertices.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], vertices[index + axis]);
      max[axis] = Math.max(max[axis], vertices[index + axis]);
    }
  }
  const size: [number, number, number] = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  return {
    min,
    max,
    size,
    center: [min[0] + size[0] / 2, min[1] + size[1] / 2, min[2] + size[2] / 2],
  };
}

export function fitCameraToBounds(
  bounds: MeshBounds,
  verticalFovDegrees: number,
  aspect: number,
  direction: Vector3Value,
  padding = 1.2,
): CameraFit {
  const directionLength = Math.hypot(direction.x, direction.y, direction.z);
  if (!(directionLength > 0) || !(verticalFovDegrees > 0 && verticalFovDegrees < 180) || !(aspect > 0)) {
    throw new Error("camera fit inputs are invalid");
  }
  const halfFov = verticalFovDegrees * Math.PI / 360;
  if (!(padding >= 1) || !Number.isFinite(padding) || bounds.min.some((value) => !Number.isFinite(value))
    || bounds.max.some((value) => !Number.isFinite(value))) {
    throw new Error("camera fit inputs are invalid");
  }
  const cameraZ = [direction.x / directionLength, direction.y / directionLength, direction.z / directionLength] as const;
  const horizontalLength = Math.hypot(cameraZ[0], cameraZ[1]);
  const cameraX = horizontalLength > 1e-12
    ? [-cameraZ[1] / horizontalLength, cameraZ[0] / horizontalLength, 0] as const
    : [1, 0, 0] as const;
  const cameraY = [
    cameraZ[1] * cameraX[2] - cameraZ[2] * cameraX[1],
    cameraZ[2] * cameraX[0] - cameraZ[0] * cameraX[2],
    cameraZ[0] * cameraX[1] - cameraZ[1] * cameraX[0],
  ] as const;
  const tanVertical = Math.tan(halfFov);
  const tanHorizontal = tanVertical * aspect;
  let distance = 1;
  let maximumCameraZ = -Infinity;
  let minimumCameraZ = Infinity;
  for (const x of [bounds.min[0], bounds.max[0]]) {
    for (const y of [bounds.min[1], bounds.max[1]]) {
      for (const z of [bounds.min[2], bounds.max[2]]) {
        const offset = [x - bounds.center[0], y - bounds.center[1], z - bounds.center[2]] as const;
        const projectedX = offset[0] * cameraX[0] + offset[1] * cameraX[1] + offset[2] * cameraX[2];
        const projectedY = offset[0] * cameraY[0] + offset[1] * cameraY[1] + offset[2] * cameraY[2];
        const projectedZ = offset[0] * cameraZ[0] + offset[1] * cameraZ[1] + offset[2] * cameraZ[2];
        distance = Math.max(
          distance,
          projectedZ + padding * Math.abs(projectedX) / tanHorizontal,
          projectedZ + padding * Math.abs(projectedY) / tanVertical,
        );
        maximumCameraZ = Math.max(maximumCameraZ, projectedZ);
        minimumCameraZ = Math.min(minimumCameraZ, projectedZ);
      }
    }
  }
  const nearestDepth = distance - maximumCameraZ;
  const farthestDepth = distance - minimumCameraZ;
  return {
    target: [...bounds.center],
    position: [
      bounds.center[0] + cameraZ[0] * distance,
      bounds.center[1] + cameraZ[1] * distance,
      bounds.center[2] + cameraZ[2] * distance,
    ],
    distance,
    near: Math.max(0.01, nearestDepth * 0.5),
    far: Math.max(10, farthestDepth * 1.5),
  };
}

export function selectedLegZone(parameters: LBracketParameters): ParameterZone {
  return {
    center: [
      parameters.leg_thickness_mm / 2,
      parameters.leg_width_mm / 2,
      parameters.base_thickness_mm + parameters.leg_length_mm / 2,
    ],
    size: [
      parameters.leg_thickness_mm,
      parameters.leg_width_mm,
      parameters.leg_length_mm,
    ],
  };
}

export function rolledCameraUp(
  up: Vector3Value,
  sightLine: Vector3Value,
  angle: number,
): Vector3Value {
  const magnitude = Math.hypot(sightLine.x, sightLine.y, sightLine.z);
  if (magnitude === 0) return { ...up };
  const x = sightLine.x / magnitude;
  const y = sightLine.y / magnitude;
  const z = sightLine.z / magnitude;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const dot = up.x * x + up.y * y + up.z * z;
  return {
    x: up.x * cosine + (y * up.z - z * up.y) * sine + x * dot * (1 - cosine),
    y: up.y * cosine + (z * up.x - x * up.z) * sine + y * dot * (1 - cosine),
    z: up.z * cosine + (x * up.y - y * up.x) * sine + z * dot * (1 - cosine),
  };
}
