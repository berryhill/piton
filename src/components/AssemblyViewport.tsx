import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { R14_ASSEMBLY, assemblyContextualFaceId, type AssemblyOccurrence } from "../assembly";
import type { FixtureReviewMeasurement, FixtureReviewPoint, FixtureSelectionMode } from "../fixture";
import { clearReviewMeasurementOverlay, updateReviewMeasurementOverlay } from "./reviewMeasurement";

interface Props {
  disabled?: boolean;
  selectedEntityId?: string | null;
  selectionMode?: FixtureSelectionMode;
  onSelect?: (id: string) => void;
  onOpenSource?: (id: string) => void;
  measurement?: FixtureReviewMeasurement;
  onMeasurementPoint?: (point: FixtureReviewPoint) => void;
  onMeasurementHover?: (point: FixtureReviewPoint | null) => void;
  onMeasurementCancel?: () => void;
}

function reviewMaterial(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.38, metalness: 0.08, side: THREE.DoubleSide });
}

function roundedRectangle(width: number, depth: number, radius: number): THREE.Shape {
  const shape = new THREE.Shape();
  const x = -width / 2;
  const y = -depth / 2;
  shape.moveTo(x + radius, y);
  shape.lineTo(x + width - radius, y);
  shape.absarc(x + width - radius, y + radius, radius, -Math.PI / 2, 0);
  shape.lineTo(x + width, y + depth - radius);
  shape.absarc(x + width - radius, y + depth - radius, radius, 0, Math.PI / 2);
  shape.lineTo(x + radius, y + depth);
  shape.absarc(x + radius, y + depth - radius, radius, Math.PI / 2, Math.PI);
  shape.lineTo(x, y + radius);
  shape.absarc(x + radius, y + radius, radius, Math.PI, Math.PI * 1.5);
  return shape;
}

function mappedMesh(
  geometry: THREE.BufferGeometry,
  color: number,
  sourceFaceId: `face:${string}`,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, reviewMaterial(color));
  mesh.userData.sourceFaceId = sourceFaceId;
  return mesh;
}

function basePlate(): THREE.Mesh {
  const shape = roundedRectangle(120, 80, 8);
  for (const [x, y] of [[-46, -26], [-46, 26], [46, -26], [46, 26]]) {
    const hole = new THREE.Path();
    hole.absarc(x, y, 4.5, 0, Math.PI * 2);
    shape.holes.push(hole);
  }
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 12, bevelEnabled: false, curveSegments: 24 });
  geometry.computeVertexNormals();
  return mappedMesh(geometry, 0x477b9b, "face:top");
}

function clampJaw(): THREE.Group {
  const group = new THREE.Group();
  const foot = mappedMesh(new THREE.BoxGeometry(46, 28, 8), 0xf07832, "face:jaw-base");
  foot.position.z = 4;
  const upright = mappedMesh(new THREE.BoxGeometry(30, 28, 37), 0xf07832, "face:jaw-grip");
  upright.position.z = 26.5;
  group.add(foot, upright);
  return group;
}

function guidePin(): THREE.Group {
  const group = new THREE.Group();
  const shaft = mappedMesh(new THREE.CylinderGeometry(5, 5, 43, 32), 0x72d5df, "face:pin-shaft");
  shaft.rotation.x = Math.PI / 2;
  shaft.position.z = 21.5;
  const head = mappedMesh(new THREE.CylinderGeometry(9, 9, 5, 32), 0x72d5df, "face:pin-top");
  head.rotation.x = Math.PI / 2;
  head.position.z = 45.5;
  group.add(shaft, head);
  return group;
}

function occurrenceGeometry(occurrence: AssemblyOccurrence): THREE.Object3D {
  if (occurrence.sourceDocumentId === "base-plate.part") return basePlate();
  if (occurrence.sourceDocumentId === "clamp-jaw.part") return clampJaw();
  return guidePin();
}

function createOccurrence(occurrence: AssemblyOccurrence): THREE.Group {
  const group = new THREE.Group();
  group.name = `${occurrence.label} → ${occurrence.sourceDocumentId}`;
  group.userData = {
    entityId: occurrence.id,
    occurrenceId: occurrence.id,
    sourceDocumentId: occurrence.sourceDocumentId,
    fixed: occurrence.fixed,
    suppressed: occurrence.suppressed,
  };
  const geometry = occurrenceGeometry(occurrence);
  geometry.traverse((object) => {
    Object.assign(object.userData, group.userData);
    if (object.userData.sourceFaceId) {
      object.userData.contextualFaceId = assemblyContextualFaceId(occurrence.id, object.userData.sourceFaceId as `face:${string}`);
    }
  });
  group.add(geometry);
  group.position.set(...occurrence.transform.translationMm);
  group.rotation.set(...occurrence.transform.rotationDeg.map(THREE.MathUtils.degToRad) as [number, number, number]);
  return group;
}

export function createAssemblyReviewRoot(): THREE.Group {
  const root = new THREE.Group();
  root.name = "Assembly scene · Bench Clamp";
  for (const occurrence of R14_ASSEMBLY.occurrences) root.add(createOccurrence(occurrence));
  root.updateMatrixWorld(true);
  return root;
}

export function inspectAssemblyReviewRoot(root: THREE.Object3D): {
  bounds: THREE.Box3;
  size: THREE.Vector3;
  center: THREE.Vector3;
  occurrenceCount: number;
  cadZMinMm: number;
  gridWorldZMm: 0;
} {
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  const cadZMinMm = Math.abs(bounds.min.z) < 1e-9 ? 0 : bounds.min.z;
  return {
    bounds,
    size: bounds.getSize(new THREE.Vector3()),
    center: bounds.getCenter(new THREE.Vector3()),
    occurrenceCount: root.children.length,
    cadZMinMm,
    gridWorldZMm: 0,
  };
}

const CONTEXTUAL_FACE_IDS = new Set(R14_ASSEMBLY.contextualFaces.map(({ id }) => id));

export function resolveAssemblyReviewPick(
  intersections: readonly Readonly<{ object: THREE.Object3D }>[],
  selectionMode: FixtureSelectionMode,
): string | null {
  for (const { object } of intersections) {
    const occurrenceId = object.userData.occurrenceId as string | undefined;
    if (!occurrenceId || !R14_ASSEMBLY.occurrences.some(({ id }) => id === occurrenceId)) continue;
    if (selectionMode !== "face") return occurrenceId;
    const contextualFaceId = object.userData.contextualFaceId as string | undefined;
    if (contextualFaceId && CONTEXTUAL_FACE_IDS.has(contextualFaceId)) return contextualFaceId;
  }
  return null;
}

export function assemblySelectionOccurrenceIds(id: string | null): string[] {
  if (!id) return [];
  const occurrence = R14_ASSEMBLY.occurrences.find(({ id: occurrenceId }) => occurrenceId === id)
    ?? R14_ASSEMBLY.occurrences.find(({ id: occurrenceId }) => id.startsWith(`contextual-face:${occurrenceId}:`));
  if (occurrence && (id === occurrence.id || CONTEXTUAL_FACE_IDS.has(id))) return [occurrence.id];
  return [...(R14_ASSEMBLY.relationships.find(({ id: relationshipId }) => relationshipId === id)?.relatedOccurrenceIds ?? [])];
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((object) => {
    const candidate = object as THREE.Object3D & { geometry?: THREE.BufferGeometry; material?: THREE.Material | THREE.Material[] };
    candidate.geometry?.dispose();
    if (candidate.material) (Array.isArray(candidate.material) ? candidate.material : [candidate.material]).forEach((material) => material.dispose());
  });
}

export default function AssemblyViewport({
  disabled = false,
  selectedEntityId = null,
  selectionMode = "smart",
  onSelect,
  onOpenSource,
  measurement = { phase: "idle" },
  onMeasurementPoint,
  onMeasurementHover,
  onMeasurementCancel,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const selection = useRef<(id: string | null) => void>(() => {});
  const updateMeasurement = useRef<(value: FixtureReviewMeasurement) => void>(() => {});
  const interaction = useRef({ selectionMode, onSelect, onOpenSource, measurement, onMeasurementPoint, onMeasurementHover, onMeasurementCancel });
  interaction.current = { selectionMode, onSelect, onOpenSource, measurement, onMeasurementPoint, onMeasurementHover, onMeasurementCancel };

  useEffect(() => {
    if (disabled || !host.current) return;
    const element = host.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#111820");
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
    camera.position.set(145, -150, 115);
    camera.up.set(0, 0, 1);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    element.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 28);
    controls.enableDamping = true;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x26313d, 2.4));
    const light = new THREE.DirectionalLight(0xffffff, 2.8);
    light.position.set(100, -80, 150);
    scene.add(light);
    const grid = new THREE.GridHelper(350, 35, 0x526579, 0x273442);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = 0;
    grid.name = "physical-build-plane-z0";
    scene.add(grid);

    const root = createAssemblyReviewRoot();
    const occurrenceObjects = new Map<string, THREE.Group>(root.children.map((object) => [object.userData.occurrenceId as string, object as THREE.Group]));
    scene.add(root);
    const measurementOverlay = new THREE.Group();
    measurementOverlay.name = "review-mesh-measurement-overlay";
    scene.add(measurementOverlay);
    updateMeasurement.current = (value) => {
      const active = value.phase === "armed" || value.phase === "endpoint-a";
      controls.enabled = !active;
      element.dataset.controlsEnabled = String(!active);
      element.dataset.measurementPhase = value.phase;
      element.dataset.measurementOverlay = updateReviewMeasurementOverlay(measurementOverlay, value);
    };
    updateMeasurement.current(measurement);
    const evidence = inspectAssemblyReviewRoot(root);
    const { size, center } = evidence;
    const highlight = new THREE.Group();
    highlight.name = "assembly-selection-highlight";
    scene.add(highlight);
    selection.current = (id) => {
      for (const child of [...highlight.children]) {
        highlight.remove(child);
        disposeObject(child);
      }
      if (id) element.dataset.selectedReviewId = id;
      else delete element.dataset.selectedReviewId;
      const color = id?.startsWith("contextual-face:") ? 0xffcf59 : id?.startsWith("mate:") ? 0xf47ac3 : 0x59d8ff;
      for (const occurrenceId of assemblySelectionOccurrenceIds(id)) {
        const related = occurrenceObjects.get(occurrenceId);
        if (related) highlight.add(new THREE.BoxHelper(related, color));
      }
    };
    selection.current(selectedEntityId);

    function fit(preset: "iso" | "front" | "top" = "iso") {
      const radius = Math.max(size.x, size.y, size.z) * 1.25;
      const directions = { iso: [1, -1, 0.8], front: [0, -1, 0.2], top: [0, 0, 1] } as const;
      const direction = new THREE.Vector3(...directions[preset]).normalize();
      camera.position.copy(center).addScaledVector(direction, radius);
      camera.up.set(0, preset === "top" ? 1 : 0, preset === "top" ? 0 : 1);
      camera.near = Math.max(0.1, radius / 100);
      camera.far = radius * 10;
      camera.updateProjectionMatrix();
      controls.target.copy(center);
      controls.update();
      element.dataset.cameraPreset = preset;
    }
    fit();

    element.dataset.sceneName = root.name;
    element.dataset.occurrenceCount = String(evidence.occurrenceCount);
    element.dataset.occurrenceIds = R14_ASSEMBLY.occurrences.map(({ id }) => id).join(",");
    element.dataset.cadZMin = String(evidence.cadZMinMm);
    element.dataset.buildPlaneZ = String(evidence.gridWorldZMm);
    element.dataset.cadWorldMapping = "CAD Z=Three.js world Z";
    element.dataset.renderedBbox = [size.x, size.y, size.z].join(" × ");

    const resize = () => {
      const width = element.clientWidth;
      const height = element.clientHeight;
      if (!(width > 0 && height > 0)) return;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const intersectionsAt = (clientX: number, clientY: number): THREE.Intersection[] => {
      const bounds = renderer.domElement.getBoundingClientRect();
      if (!(bounds.width > 0 && bounds.height > 0)) return [];
      pointer.set(
        ((clientX - bounds.left) / bounds.width) * 2 - 1,
        -((clientY - bounds.top) / bounds.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      return raycaster.intersectObject(root, true);
    };
    const pick = (event: MouseEvent): string | null => {
      return resolveAssemblyReviewPick(intersectionsAt(event.clientX, event.clientY), interaction.current.selectionMode);
    };
    const measurementPointAt = (clientX: number, clientY: number): FixtureReviewPoint | null => {
      const hit = intersectionsAt(clientX, clientY)[0];
      return hit ? [hit.point.x, hit.point.y, hit.point.z] : null;
    };
    let pointerDown = { x: 0, y: 0 };
    const handlePointerDown = (event: PointerEvent) => {
      pointerDown = { x: event.clientX, y: event.clientY };
    };
    const handleClick = (event: MouseEvent) => {
      if (Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 4) return;
      const measuring = interaction.current.measurement.phase === "armed" || interaction.current.measurement.phase === "endpoint-a";
      if (measuring) {
        const point = measurementPointAt(event.clientX, event.clientY);
        if (point) interaction.current.onMeasurementPoint?.(point);
        return;
      }
      const id = pick(event);
      if (id) interaction.current.onSelect?.(id);
    };
    const handlePointerMove = (event: PointerEvent) => {
      if (interaction.current.measurement.phase !== "endpoint-a") return;
      interaction.current.onMeasurementHover?.(measurementPointAt(event.clientX, event.clientY));
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && interaction.current.measurement.phase !== "idle") {
        event.preventDefault();
        interaction.current.onMeasurementCancel?.();
        return;
      }
      if ((event.key === "Enter" || event.key === " ")
        && (interaction.current.measurement.phase === "armed" || interaction.current.measurement.phase === "endpoint-a")) {
        event.preventDefault();
        const bounds = renderer.domElement.getBoundingClientRect();
        const point = measurementPointAt(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
        if (point) interaction.current.onMeasurementPoint?.(point);
      }
    };
    const handleDoubleClick = (event: MouseEvent) => {
      if (interaction.current.measurement.phase !== "idle") return;
      const id = pick(event);
      if (id) interaction.current.onOpenSource?.(id);
    };
    renderer.domElement.addEventListener("pointerdown", handlePointerDown);
    renderer.domElement.addEventListener("pointermove", handlePointerMove);
    renderer.domElement.addEventListener("click", handleClick);
    renderer.domElement.addEventListener("dblclick", handleDoubleClick);
    element.addEventListener("keydown", handleKeyDown);

    let frame = 0;
    const draw = () => {
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(draw);
    };
    draw();

    const actions = element as HTMLDivElement & { setView?: typeof fit; fitView?: () => void };
    actions.setView = fit;
    actions.fitView = () => fit((element.dataset.cameraPreset as "iso" | "front" | "top") ?? "iso");

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
      renderer.domElement.removeEventListener("pointermove", handlePointerMove);
      renderer.domElement.removeEventListener("click", handleClick);
      renderer.domElement.removeEventListener("dblclick", handleDoubleClick);
      element.removeEventListener("keydown", handleKeyDown);
      controls.dispose();
      disposeObject(root);
      disposeObject(highlight);
      clearReviewMeasurementOverlay(measurementOverlay);
      renderer.dispose();
      element.replaceChildren();
    };
  }, [disabled]);

  useEffect(() => selection.current(selectedEntityId), [selectedEntityId]);
  useEffect(() => updateMeasurement.current(measurement), [measurement]);

  return <div className="viewport-shell assembly-viewport-shell">
    <div
      ref={host}
      className="viewport"
      data-testid="assembly-viewport"
      data-scene-name="Assembly scene · Bench Clamp"
      data-occurrence-count={R14_ASSEMBLY.sceneEvidence.occurrenceCount}
      data-cad-z-min={R14_ASSEMBLY.sceneEvidence.cadZMinMm}
      data-build-plane-z={R14_ASSEMBLY.sceneEvidence.gridWorldZMm}
      data-cad-world-mapping="CAD Z=Three.js world Z"
      data-selection-mode={selectionMode}
      data-measurement-phase={measurement.phase}
      tabIndex={0}
      role="application"
      aria-label="Assembly review viewport"
    />
    <div className="viewport-status">{disabled ? "Assembly review scene · geometry disabled in component test" : "Interactive Assembly review scene · CAD Z-min 0 on grid"}</div>
    <div className="view-actions" aria-label="Assembly review camera controls">
      {(["iso", "front", "top"] as const).map((preset) => <button key={preset} onClick={() => (host.current as HTMLDivElement & { setView?: (value: typeof preset) => void })?.setView?.(preset)}>{preset[0].toUpperCase() + preset.slice(1)}</button>)}
      <button onClick={() => (host.current as HTMLDivElement & { fitView?: () => void })?.fitView?.()}>Fit</button>
    </div>
  </div>;
}
