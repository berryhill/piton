/// <reference lib="webworker" />
import Module from "manifold-3d";
import wasmUrl from "manifold-3d/manifold.wasm?url";
import type { LBracketParameters } from "../domain";
import type { GeometryAuthorityBinding } from "./binding";
import { bracketHole } from "./bracket";

interface BuildMessage {
  requestId: number;
  binding: GeometryAuthorityBinding;
  parameters: LBracketParameters;
}

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

self.onmessage = async (event: MessageEvent<BuildMessage>) => {
  const { requestId, binding, parameters: p } = event.data;
  try {
    const module = await manifoldModule();
    const { Manifold } = module;
    const base = Manifold.cube([p.base_length_mm, p.leg_width_mm, p.base_thickness_mm]);
    const leg = Manifold.cube([p.leg_thickness_mm, p.leg_width_mm, p.leg_length_mm])
      .translate([0, 0, p.base_thickness_mm]);
    const holeSpec = bracketHole(p);
    const hole = Manifold.cylinder(holeSpec.length, holeSpec.diameter / 2, holeSpec.diameter / 2, 32, true)
      .rotate([90, 0, 0])
      .translate(holeSpec.center);
    const union = base.add(leg);
    const solid = union.subtract(hole);
    const mesh = solid.getMesh();
    const vertices = Array.from(mesh.vertProperties);
    const triangles = Array.from(mesh.triVerts);
    solid.delete();
    union.delete();
    hole.delete();
    leg.delete();
    base.delete();
    self.postMessage({ requestId, binding, vertices, triangles });
  } catch (error) {
    self.postMessage({
      requestId,
      binding,
      error: error instanceof Error ? error.message : "Unknown Manifold WASM build failure",
    });
  }
};