import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { DesignRevision, LBracketParameters } from "../domain";
import type { SemanticSelectionId } from "../App";
import type { FixtureReviewMeasurement, FixtureReviewPoint } from "../fixture";
import { clearReviewMeasurementOverlay, updateReviewMeasurementOverlay } from "./reviewMeasurement";
import { deriveGeometryBinding, type GeometryAuthorityBinding } from "../geometry/binding";
import { GeometryResultGate, installReplacement, type GeometryRequestIdentity, type GeometryResult } from "../geometry/gate";
import { fitCameraToBounds, meshBounds, selectedLegZone, type CameraPreset, type MeshBounds } from "../geometry/view";
import { applyCameraAction, recordCameraPose, rememberCamera, restoreCamera, ViewControls, type ViewHost } from "./ViewControls";
import {
  constructGeometryWorker,
  geometryWorkerGeneration,
  postGeometryWorkerMessage,
  type GeometryWorkerSurface,
} from "../geometry/workerClient";
import {
  GEOMETRY_ENVIRONMENT_DIGEST,
  geometryInputDigest,
  parseGeometryWorkerMessage,
} from "../geometry/protocol";

interface PreviewBuildStatus {
  requestId: number;
  binding: GeometryAuthorityBinding;
  state: "previewing" | "ready" | "failed";
  message: string;
}

interface Props {
  parameters: LBracketParameters;
  authoritativeBase: DesignRevision;
  viewKey?: string;
  disabled?: boolean;
  semanticSelection?: SemanticSelectionId | null;
  onBuildStatus?: (status: PreviewBuildStatus) => void;
  onGeometryAdmitted?: (bounds: MeshBounds, binding: GeometryAuthorityBinding) => void;
  onReviewMesh?: (result: GeometryResult) => void;
  measurement?: FixtureReviewMeasurement;
  onMeasurementPoint?: (point: FixtureReviewPoint) => void;
  onMeasurementHover?: (point: FixtureReviewPoint | null) => void;
  onMeasurementCancel?: () => void;
}

export default function Viewport({
  parameters,
  authoritativeBase,
  viewKey,
  disabled = false,
  semanticSelection = null,
  onBuildStatus,
  onGeometryAdmitted,
  onReviewMesh,
  measurement = { phase: "idle" },
  onMeasurementPoint,
  onMeasurementHover,
  onMeasurementCancel,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const worker = useRef<GeometryWorkerSurface | null>(null);
  const gate = useRef(new GeometryResultGate());
  const activeRequest = useRef<GeometryRequestIdentity | null>(null);
  const updateMesh = useRef<(result: GeometryResult) => MeshBounds>(() => { throw new Error("viewport is not initialized"); });
  const updateZone = useRef<(next: LBracketParameters) => void>(() => {});
  const updateSemantic = useRef<(selection: SemanticSelectionId | null, next: LBracketParameters) => void>(() => {});
  const updateMeasurement = useRef<(value: FixtureReviewMeasurement) => void>(() => {});
  const measurementInteraction = useRef({ measurement, onMeasurementPoint, onMeasurementHover, onMeasurementCancel });
  measurementInteraction.current = { measurement, onMeasurementPoint, onMeasurementHover, onMeasurementCancel };
  const statusSink = useRef(onBuildStatus);
  const geometrySink = useRef(onGeometryAdmitted);
  const meshSink = useRef(onReviewMesh);
  meshSink.current = onReviewMesh;
  const [status, setStatus] = useState(disabled ? "Geometry disabled in component test" : "Initializing Manifold WASM…");
  const [cameraUnavailable, setCameraUnavailable] = useState(disabled ? "geometry disabled" : "renderer initializing");

  useEffect(() => { statusSink.current = onBuildStatus; }, [onBuildStatus]);
  useEffect(() => { geometrySink.current = onGeometryAdmitted; }, [onGeometryAdmitted]);

  useEffect(() => {
    if (disabled || !host.current) return;
    const element = host.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#111820");
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
    camera.position.set(145, -150, 115);
    camera.up.set(0, 0, 1);
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); }
    catch (error) {
      const reason = `renderer failed: ${error instanceof Error ? error.message : String(error)}`;
      setStatus(`3D preview unavailable: ${reason}`);
      setCameraUnavailable(reason);
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    element.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(50, 0, 28);
    controls.enableDamping = true;
    controls.enableRotate = true;
    controls.enablePan = true;
    controls.enableZoom = true;
    element.dataset.controls = "orbit pan zoom";
    scene.add(new THREE.HemisphereLight(0xffffff, 0x26313d, 2.4));
    const light = new THREE.DirectionalLight(0xffffff, 2.8);
    light.position.set(100, -80, 150);
    scene.add(light);
    const grid = new THREE.GridHelper(350, 35, 0x526579, 0x273442);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = 0;
    grid.name = "physical-build-plane-z0";
    scene.add(grid);
    const zone = selectedLegZone(parameters);
    const zoneHighlight = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(...zone.size)),
      new THREE.LineBasicMaterial({ color: 0xffc064, transparent: true, opacity: 0.85 }),
    );
    zoneHighlight.position.set(...zone.center);
    zoneHighlight.name = "selected-leg-length-zone";
    scene.add(zoneHighlight);
    updateZone.current = (next) => {
      const nextZone = selectedLegZone(next);
      zoneHighlight.geometry.dispose();
      zoneHighlight.geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(...nextZone.size));
      zoneHighlight.position.set(...nextZone.center);
    };
    const semanticOverlay = new THREE.Group();
    semanticOverlay.name = "fixture-local-semantic-highlight";
    scene.add(semanticOverlay);
    const disposeSemanticOverlay = () => {
      for (const child of [...semanticOverlay.children]) {
        semanticOverlay.remove(child);
        child.traverse((object) => {
          const disposable = object as THREE.Object3D & { geometry?: THREE.BufferGeometry; material?: THREE.Material | THREE.Material[] };
          disposable.geometry?.dispose();
          const materials = disposable.material ? (Array.isArray(disposable.material) ? disposable.material : [disposable.material]) : [];
          materials.forEach((material) => material.dispose());
        });
      }
    };
    updateSemantic.current = (selection, next) => {
      disposeSemanticOverlay();
      if (selection) element.dataset.selectedReviewId = selection;
      else delete element.dataset.selectedReviewId;
      const height = next.base_thickness_mm + next.leg_length_mm;
      if (selection === "face:top") {
        const zone = selectedLegZone(next);
        const highlight = new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.BoxGeometry(...zone.size)),
          new THREE.LineBasicMaterial({ color: 0xffd166 }),
        );
        highlight.position.set(...zone.center);
        semanticOverlay.add(highlight);
      } else if (selection === "component:l-bracket:1") {
        const highlight = new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.BoxGeometry(next.base_length_mm, next.leg_width_mm, height)),
          new THREE.LineBasicMaterial({ color: 0x59d8ff }),
        );
        highlight.position.set(next.base_length_mm / 2, next.leg_width_mm / 2, height / 2);
        semanticOverlay.add(highlight);
      } else if (selection === "origin") {
        semanticOverlay.add(new THREE.AxesHelper(30));
      } else if (selection === "plane:top") {
        const plane = new THREE.GridHelper(140, 14, 0x70e1b5, 0x356b58);
        plane.rotation.x = Math.PI / 2;
        semanticOverlay.add(plane);
      } else if (selection === "mate:review-only") {
        const geometry = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(next.leg_thickness_mm, next.leg_width_mm / 2, next.base_thickness_mm),
          new THREE.Vector3(next.base_length_mm / 2, next.leg_width_mm / 2, next.base_thickness_mm),
        ]);
        semanticOverlay.add(new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xf47ac3 })));
      }
    };
    updateSemantic.current(semanticSelection, parameters);
    const buildVolume = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(350, 350, 350)),
      new THREE.LineBasicMaterial({ color: 0x33526e, transparent: true, opacity: 0.3 }),
    );
    buildVolume.position.set(175, 0, 175);
    buildVolume.name = "build-volume-350mm";
    scene.add(buildVolume);
    element.dataset.buildVolume = "350 × 350 × 350 mm";
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

    interface InstalledReviewMesh {
      mesh: THREE.Mesh;
      bounds: MeshBounds;
    }
    let part: InstalledReviewMesh | null = null;
    let admittedBounds: MeshBounds | null = null;
    let admittedViewKey: string | undefined;
    const disposePart = (installed: InstalledReviewMesh) => {
      installed.mesh.geometry.dispose();
      const materials = Array.isArray(installed.mesh.material) ? installed.mesh.material : [installed.mesh.material];
      materials.forEach((material) => material.dispose());
    };
    const fitCurrentMesh = (action: CameraPreset | "fit" | "reset" = "reset") => {
      if (!admittedBounds) return;
      const fit = applyCameraAction(camera, controls, admittedBounds, "cad-z-up", action);
      if (action !== "fit") element.dataset.cameraPreset = action === "reset" ? "iso" : action;
      if (fit) element.dataset.fitDistance = fit.distance.toFixed(3);
      element.dataset.fitTarget = admittedBounds.center.join(",");
      recordCameraPose(element, camera, controls.target);
    };
    updateMesh.current = (result) => {
      const replacement = installReplacement(
        part,
        () => {
          const geometry = new THREE.BufferGeometry();
          const material = new THREE.MeshStandardMaterial({ color: 0xe6a54b, roughness: 0.38, metalness: 0.18 });
          try {
            geometry.setAttribute("position", new THREE.Float32BufferAttribute(result.vertices, 3));
            geometry.setIndex(result.triangles);
            geometry.computeVertexNormals();
            const bounds = meshBounds(result.vertices);
            fitCameraToBounds(bounds, camera.fov, camera.aspect, { x: 1, y: -1, z: 0.75 });
            return { mesh: new THREE.Mesh(geometry, material), bounds };
          } catch (error) {
            geometry.dispose();
            material.dispose();
            throw error;
          }
        },
        (candidate) => scene.add(candidate.mesh),
        (previous) => scene.remove(previous.mesh),
        disposePart,
      );
      part = replacement;
      admittedBounds = replacement.bounds;
      admittedViewKey = viewKey ? `${viewKey}:${result.sourceRevisionId}` : undefined;
      fitCurrentMesh();
      restoreCamera(admittedViewKey, camera, controls);
      recordCameraPose(element, camera, controls.target);
      setCameraUnavailable("");
      element.dataset.cadZMin = String(admittedBounds.min[2]);
      element.dataset.buildPlaneZ = "0";
      element.dataset.renderedBbox = admittedBounds.size.join(" × ");
      element.dataset.renderedVertexCount = String(result.vertices.length / 3);
      return replacement.bounds;
    };
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const measurementPointAt = (clientX: number, clientY: number): FixtureReviewPoint | null => {
      if (!part) return null;
      const bounds = renderer.domElement.getBoundingClientRect();
      if (!(bounds.width > 0 && bounds.height > 0)) return null;
      pointer.set(
        ((clientX - bounds.left) / bounds.width) * 2 - 1,
        -((clientY - bounds.top) / bounds.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObject(part.mesh, false)[0];
      return hit ? [hit.point.x, hit.point.y, hit.point.z] : null;
    };
    const keyboardMeasurementPoint = (): FixtureReviewPoint | null => {
      const bounds = renderer.domElement.getBoundingClientRect();
      for (const y of [0.5, 0.4, 0.6, 0.3, 0.7]) {
        for (const x of [0.5, 0.4, 0.6, 0.3, 0.7]) {
          const point = measurementPointAt(bounds.left + bounds.width * x, bounds.top + bounds.height * y);
          if (point) return point;
        }
      }
      return null;
    };
    let pointerDown = { x: 0, y: 0 };
    const handlePointerDown = (event: PointerEvent) => {
      pointerDown = { x: event.clientX, y: event.clientY };
      if (measurementInteraction.current.measurement.phase !== "idle") element.focus();
    };
    const handleClick = (event: MouseEvent) => {
      if (Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 4) return;
      const phase = measurementInteraction.current.measurement.phase;
      if (phase !== "armed" && phase !== "endpoint-a") return;
      const point = measurementPointAt(event.clientX, event.clientY);
      if (point) measurementInteraction.current.onMeasurementPoint?.(point);
    };
    const handlePointerMove = (event: PointerEvent) => {
      if (measurementInteraction.current.measurement.phase !== "endpoint-a") return;
      measurementInteraction.current.onMeasurementHover?.(measurementPointAt(event.clientX, event.clientY));
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      const phase = measurementInteraction.current.measurement.phase;
      if (event.key === "Escape" && phase !== "idle") {
        event.preventDefault();
        measurementInteraction.current.onMeasurementCancel?.();
        return;
      }
      if ((event.key === "Enter" || event.key === " ") && (phase === "armed" || phase === "endpoint-a")) {
        event.preventDefault();
        const point = keyboardMeasurementPoint();
        if (point) measurementInteraction.current.onMeasurementPoint?.(point);
      }
    };
    renderer.domElement.addEventListener("pointerdown", handlePointerDown);
    renderer.domElement.addEventListener("pointermove", handlePointerMove);
    renderer.domElement.addEventListener("click", handleClick);
    element.addEventListener("keydown", handleKeyDown);
    const resize = () => {
      const { clientWidth: width, clientHeight: height } = element;
      if (!(width > 0 && height > 0)) return;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      // Resizing must not discard the current direction or roll.
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    let frame = 0;
    const draw = () => {
      controls.update();
      if (admittedBounds) { rememberCamera(admittedViewKey, camera, controls.target); recordCameraPose(element, camera, controls.target); }
      renderer.render(scene, camera);
      frame = requestAnimationFrame(draw);
    };
    draw();
    const actions = element as ViewHost;
    actions.resetView = () => {
      fitCurrentMesh("iso");
      element.dataset.viewState = "fit-to-rendered-bbox";
    };
    actions.fitView = () => {
      fitCurrentMesh("fit");
      element.dataset.viewState = "fit-to-rendered-bbox";
    };
    actions.setView = (preset) => {
      fitCurrentMesh(preset);
      rememberCamera(admittedViewKey, camera, controls.target);
      element.dataset.viewState = preset;
    };
    actions.rollView = () => {
      if (!admittedBounds) return;
      applyCameraAction(camera, controls, admittedBounds, "cad-z-up", "roll");
      recordCameraPose(element, camera, controls.target);
      element.dataset.viewState = "rolled";
      rememberCamera(admittedViewKey, camera, controls.target);
    };
    return () => {
      delete actions.resetView; delete actions.fitView; delete actions.setView; delete actions.rollView;
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
      renderer.domElement.removeEventListener("pointermove", handlePointerMove);
      renderer.domElement.removeEventListener("click", handleClick);
      element.removeEventListener("keydown", handleKeyDown);
      controls.dispose();
      disposeSemanticOverlay();
      clearReviewMeasurementOverlay(measurementOverlay);
      if (part) disposePart(part);
      renderer.dispose();
      element.replaceChildren();
    };
  }, [disabled]);

  useEffect(() => {
    if (disabled) return;
    updateSemantic.current(semanticSelection, parameters);
  }, [disabled, parameters, semanticSelection]);

  useEffect(() => updateMeasurement.current(measurement), [measurement]);

  useEffect(() => {
    if (disabled) return;
    updateZone.current(parameters);
    const binding = deriveGeometryBinding(authoritativeBase, parameters);
    const terminateFailedWorker = () => {
      const failedWorker = worker.current;
      worker.current = null;
      failedWorker?.terminate();
    };
    const reportWorkerFailure = (failure: string) => {
      terminateFailedWorker();
      const current = activeRequest.current;
      if (!current) return;
      const message = `${failure} · ${gate.current.lastGood ? "last-good retained" : "no admitted geometry replaced"}`;
      setStatus(message);
      statusSink.current?.({ ...current, state: "failed", message });
    };
    if (!worker.current) {
      worker.current = constructGeometryWorker(
        () => new Worker(new URL("../geometry/geometry.worker.ts", import.meta.url), { type: "module" }),
        reportWorkerFailure,
      );
      if (!worker.current) return;
      worker.current.onmessage = (event: MessageEvent) => {
        const parsed = parseGeometryWorkerMessage(event.data);
        if (!parsed.ok) {
          reportWorkerFailure(`Build rejected: ${parsed.diagnostic.code}: ${parsed.diagnostic.message}`);
          return;
        }
        const messageResult = parsed.value;
        if (messageResult.type === "protocol-error") {
          reportWorkerFailure(`Build rejected: ${messageResult.diagnostic.code}: ${messageResult.diagnostic.message}`);
          return;
        }
        const current = activeRequest.current;
        if (!current) return;
        const identity = { ...messageResult, binding: current.binding };
        if (messageResult.type === "review-mesh-failed") {
          if (gate.current.isCurrent(identity)) reportWorkerFailure(`Build failed: ${messageResult.diagnostic.message}`);
          return;
        }
        const result: GeometryResult = { ...messageResult, binding: current.binding };
        if (gate.current.validate(result)) {
          let bounds: MeshBounds;
          try {
            bounds = updateMesh.current(result);
          } catch (error) {
            reportWorkerFailure(`Viewport install failed: ${error instanceof Error ? error.message : String(error)}`);
            return;
          }
          gate.current.commit(result);
          geometrySink.current?.(bounds, result.binding);
          meshSink.current?.(structuredClone(result));
          const message = "Review mesh ready · CAD Z-min 0 on grid";
          setStatus(message);
          statusSink.current?.({
            requestId: result.requestId,
            binding: result.binding,
            state: "ready",
            message,
          });
        } else if (gate.current.isCurrent(result) && gate.current.lastError) {
          reportWorkerFailure(`Build rejected: ${gate.current.lastError}`);
        }
      };
    }
    const request = gate.current.begin(
      binding,
      geometryWorkerGeneration(worker.current),
      geometryInputDigest(parameters),
      GEOMETRY_ENVIRONMENT_DIGEST,
    );
    activeRequest.current = request;
    const message = "Building browser-local preview…";
    setStatus(message);
    statusSink.current?.({ ...request, state: "previewing", message });
    postGeometryWorkerMessage(worker.current, { type: "build-review-mesh", ...request, parameters }, reportWorkerFailure);
    return () => undefined;
  }, [parameters, authoritativeBase, disabled]);

  useEffect(() => () => {
    worker.current?.terminate();
    worker.current = null;
  }, []);

  return <div className="viewport-shell">
    <div
      ref={host}
      className="viewport"
      data-testid="viewport"
      data-measurement-phase={measurement.phase}
      tabIndex={0}
      role="application"
      aria-label="Part review viewport"
    />
    <div className="viewport-status">{status}</div>
    <ViewControls host={host} unavailable={disabled ? "geometry disabled" : cameraUnavailable} />
  </div>;
}
