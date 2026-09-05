import * as THREE from "three";
import type { FixtureReviewMeasurement, FixtureReviewPoint } from "../fixture";

function pointVector(point: FixtureReviewPoint): THREE.Vector3 {
  return new THREE.Vector3(point[0], point[1], point[2]);
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((object) => {
    const disposable = object as THREE.Object3D & {
      geometry?: THREE.BufferGeometry;
      material?: THREE.Material | THREE.Material[];
    };
    disposable.geometry?.dispose();
    if (disposable.material) {
      (Array.isArray(disposable.material) ? disposable.material : [disposable.material])
        .forEach((material) => material.dispose());
    }
  });
}

export function clearReviewMeasurementOverlay(overlay: THREE.Group): void {
  for (const child of [...overlay.children]) {
    overlay.remove(child);
    disposeObject(child);
  }
}

function endpointMarker(point: FixtureReviewPoint, name: string): THREE.Mesh {
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(2.2, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffd166, depthTest: false }),
  );
  marker.position.copy(pointVector(point));
  marker.name = name;
  marker.renderOrder = 20;
  return marker;
}

export function updateReviewMeasurementOverlay(
  overlay: THREE.Group,
  measurement: FixtureReviewMeasurement,
): "none" | "endpoint-a" | "dashed-preview" | "solid-complete" {
  clearReviewMeasurementOverlay(overlay);
  if (!measurement.endpointA) return "none";

  overlay.add(endpointMarker(measurement.endpointA, "measurement-endpoint-a"));
  const target = measurement.phase === "complete" ? measurement.endpointB : measurement.hoverEndpoint;
  if (!target) return "endpoint-a";

  overlay.add(endpointMarker(target, measurement.phase === "complete" ? "measurement-endpoint-b" : "measurement-hover-endpoint"));
  const geometry = new THREE.BufferGeometry().setFromPoints([
    pointVector(measurement.endpointA),
    pointVector(target),
  ]);
  if (measurement.phase === "complete") {
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xffd166, depthTest: false }));
    line.name = "measurement-complete-line";
    line.renderOrder = 20;
    overlay.add(line);
    return "solid-complete";
  }

  const line = new THREE.Line(
    geometry,
    new THREE.LineDashedMaterial({ color: 0xffd166, dashSize: 4, gapSize: 2, depthTest: false }),
  );
  line.computeLineDistances();
  line.name = "measurement-preview-line";
  line.renderOrder = 20;
  overlay.add(line);
  return "dashed-preview";
}
