/// <reference lib="webworker" />
import Module from "manifold-3d";
import wasmUrl from "manifold-3d/manifold.wasm?url";
import { bracketHole } from "./bracket";
import {
  parseGeometryBuildRequest,
  type GeometryDiagnostic,
  type GeometryProtocolIdentity,
  type GeometryWorkerError,
  type GeometryWorkerSuccess,
} from "./protocol";

let initialized: Promise<Awaited<ReturnType<typeof Module>>> | null = null;

function manifoldModule() {
  if (!initialized) {
    initialized = Module({ locateFile: () => wasmUrl }).then((module) => {
      module.setup();
      return module;
    });
  }
  return initialized;
}

function identityOf(request: GeometryProtocolIdentity): GeometryProtocolIdentity {
  return {
    requestId: request.requestId,
    workerGeneration: request.workerGeneration,
    sourceRevisionId: request.sourceRevisionId,
    inputDigest: request.inputDigest,
    environmentDigest: request.environmentDigest,
  };
}

self.onmessage = async (event: MessageEvent<unknown>) => {
  const parsed = parseGeometryBuildRequest(event.data);
  if (!parsed.ok) {
    self.postMessage({ type: "protocol-error", diagnostic: parsed.diagnostic });
    return;
  }
  const request = parsed.value;
  const p = request.parameters;
  let base: { delete(): void } | null = null;
  let leg: { delete(): void } | null = null;
  let hole: { delete(): void } | null = null;
  let union: { delete(): void } | null = null;
  let solid: { delete(): void } | null = null;
  try {
    const module = await manifoldModule();
    const { Manifold } = module;
    base = Manifold.cube([p.base_length_mm, p.leg_width_mm, p.base_thickness_mm]);
    leg = Manifold.cube([p.leg_thickness_mm, p.leg_width_mm, p.leg_length_mm])
      .translate([0, 0, p.base_thickness_mm]);
    const holeSpec = bracketHole(p);
    hole = Manifold.cylinder(holeSpec.length, holeSpec.diameter / 2, holeSpec.diameter / 2, 32, true)
      .rotate([90, 0, 0])
      .translate(holeSpec.center);
    union = (base as typeof base & { add(other: unknown): typeof base }).add(leg);
    solid = (union as typeof union & { subtract(other: unknown): typeof union }).subtract(hole);
    const mesh = (solid as typeof solid & { getMesh(): { vertProperties: ArrayLike<number>; triVerts: ArrayLike<number> } }).getMesh();
    const result: GeometryWorkerSuccess = {
      type: "review-mesh-built",
      ...identityOf(request),
      vertices: Array.from(mesh.vertProperties),
      triangles: Array.from(mesh.triVerts),
    };
    self.postMessage(result);
  } catch (error) {
    const diagnostic: GeometryDiagnostic = {
      code: "build_failed",
      message: error instanceof Error ? error.message : "Unknown Manifold WASM build failure",
    };
    const result: GeometryWorkerError = {
      type: "review-mesh-failed",
      ...identityOf(request),
      diagnostic,
    };
    self.postMessage(result);
  } finally {
    solid?.delete();
    union?.delete();
    hole?.delete();
    leg?.delete();
    base?.delete();
  }
};
