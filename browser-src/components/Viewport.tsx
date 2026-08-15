import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { DesignRevision, LBracketParameters } from "../domain";
import { deriveGeometryBinding, type GeometryAuthorityBinding } from "../geometry/binding";
import { GeometryResultGate, installReplacement, type GeometryRequestIdentity, type GeometryResult } from "../geometry/gate";
import { fitCameraToBounds, meshBounds, rolledCameraUp, selectedLegZone, type MeshBounds } from "../geometry/view";
import { constructGeometryWorker, postGeometryWorkerMessage, type GeometryWorkerSurface } from "../geometry/workerClient";

interface PreviewBuildStatus {
  requestId: number;
  binding: GeometryAuthorityBinding;
  state: "previewing" | "ready" | "failed";
  message: string;
}

interface Props {
  parameters: LBracketParameters;
  authoritativeBase: DesignRevision;
  disabled?: boolean;
  onBuildStatus?: (status: PreviewBuildStatus) => void;
  onGeometryAdmitted?: (bounds: MeshBounds, binding: GeometryAuthorityBinding) => void;
}

export default function Viewport({
  parameters,
  authoritativeBase,
  disabled = false,
  onBuildStatus,
  onGeometryAdmitted,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const worker = useRef<GeometryWorkerSurface | null>(null);
  const gate = useRef(new GeometryResultGate());
  const activeRequest = useRef<GeometryRequestIdentity | null>(null);
  const updateMesh = useRef<(result: GeometryResult) => MeshBounds>(() => { throw new Error("viewport is not initialized"); });
  const updateZone = useRef<(next: LBracketParameters) => void>(() => {});
  const statusSink = useRef(onBuildStatus);
  const geometrySink = useRef(onGeometryAdmitted);
  const [status, setStatus] = useState(disabled ? "Geometry disabled in component test" : "Initializing Manifold WASM…");

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
    const renderer = new THREE.WebGLRenderer({ antialias: true });
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
    const buildVolume = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(350, 350, 350)),
      new THREE.LineBasicMaterial({ color: 0x33526e, transparent: true, opacity: 0.3 }),
    );
    buildVolume.position.set(175, 0, 175);
    buildVolume.name = "build-volume-350mm";
    scene.add(buildVolume);
    element.dataset.buildVolume = "350 × 350 × 350 mm";

    interface InstalledReviewMesh {
      mesh: THREE.Mesh;
      bounds: MeshBounds;
    }
    let part: InstalledReviewMesh | null = null;
    let admittedBounds: MeshBounds | null = null;
    const disposePart = (installed: InstalledReviewMesh) => {
      installed.mesh.geometry.dispose();
      const materials = Array.isArray(installed.mesh.material) ? installed.mesh.material : [installed.mesh.material];
      materials.forEach((material) => material.dispose());
    };
    const fitCurrentMesh = () => {
      if (!admittedBounds) return;
      const fit = fitCameraToBounds(admittedBounds, camera.fov, camera.aspect, { x: 1, y: -1, z: 0.75 });
      camera.position.set(...fit.position);
      camera.up.set(0, 0, 1);
      camera.near = fit.near;
      camera.far = fit.far;
      camera.updateProjectionMatrix();
      controls.target.set(...fit.target);
      controls.update();
      element.dataset.fitDistance = fit.distance.toFixed(3);
      element.dataset.fitTarget = fit.target.join(",");
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
      fitCurrentMesh();
      element.dataset.cadZMin = String(admittedBounds.min[2]);
      element.dataset.buildPlaneZ = "0";
      element.dataset.renderedBbox = admittedBounds.size.join(" × ");
      element.dataset.renderedVertexCount = String(result.vertices.length / 3);
      return replacement.bounds;
    };
    const resize = () => {
      const { clientWidth: width, clientHeight: height } = element;
      if (!(width > 0 && height > 0)) return;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      fitCurrentMesh();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    let frame = 0;
    const draw = () => {
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(draw);
    };
    draw();
    const actions = element as HTMLDivElement & { resetView?: () => void; rollView?: () => void };
    actions.resetView = () => {
      fitCurrentMesh();
      element.dataset.viewState = "fit-to-rendered-bbox";
    };
    actions.rollView = () => {
      const sightLine = controls.target.clone().sub(camera.position).normalize();
      const rolled = rolledCameraUp(camera.up, sightLine, Math.PI / 12);
      camera.up.set(rolled.x, rolled.y, rolled.z).normalize();
      controls.update();
      element.dataset.viewState = "rolled";
    };
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      if (part) disposePart(part);
      renderer.dispose();
      element.replaceChildren();
    };
  }, [disabled]);

  useEffect(() => {
    if (disabled) return;
    updateZone.current(parameters);
    const binding = deriveGeometryBinding(authoritativeBase, parameters);
    const request = gate.current.begin(binding);
    activeRequest.current = request;
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
        const result = event.data as GeometryResult & { error?: string };
        if (result.error) {
          if (gate.current.isCurrent(result)) reportWorkerFailure(`Build failed: ${result.error}`);
          return;
        }
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
    const message = "Building browser-local preview…";
    setStatus(message);
    statusSink.current?.({ ...request, state: "previewing", message });
    postGeometryWorkerMessage(worker.current, { ...request, parameters }, reportWorkerFailure);
    return () => undefined;
  }, [parameters, authoritativeBase, disabled]);

  useEffect(() => () => {
    worker.current?.terminate();
    worker.current = null;
  }, []);

  return <div className="viewport-shell">
    <div ref={host} className="viewport" data-testid="viewport" />
    <div className="viewport-status">{status}</div>
    <div className="view-actions">
      <button onClick={() => (host.current as HTMLDivElement & { rollView?: () => void })?.rollView?.()}>Roll 15°</button>
      <button onClick={() => (host.current as HTMLDivElement & { resetView?: () => void })?.resetView?.()}>Reset / fit</button>
    </div>
  </div>;
}
