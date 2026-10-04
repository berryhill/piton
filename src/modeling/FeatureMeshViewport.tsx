import { useEffect, useRef, useState } from "react";
import type { FeatureEvaluation } from "./evaluator";
import type * as Three from "three";
import { Vector2 } from "three";
import type { FixtureReviewMeasurement, FixtureReviewPoint } from "../fixture";
import { clearReviewMeasurementOverlay, updateReviewMeasurementOverlay } from "../components/reviewMeasurement";
import { applyCameraAction, recordCameraPose, rememberCamera, restoreCamera, ViewControls, type ViewHost } from "../components/ViewControls";
import { meshBounds, type CameraPreset } from "../geometry/view";

/** Ray hits are display-frame millimetres, matching the shared overlay's frame. */
export function reviewMeshPointAt(raycaster: Three.Raycaster, camera: Three.Camera, mesh: Three.Mesh, bounds: DOMRect, x: number, y: number): FixtureReviewPoint | null {
  if (!(bounds.width > 0 && bounds.height > 0)) return null;
  const pointer = new Vector2(((x - bounds.left) / bounds.width) * 2 - 1, -((y - bounds.top) / bounds.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(mesh, false)[0];
  return hit ? [hit.point.x, hit.point.y, hit.point.z] : null;
}

/** A review-only projection of the evaluated Manifold triangles, not CAD authority. */
export interface FeatureRendererStatus { revisionId:string;state:"initializing"|"ready"|"failed"|"unavailable";reason?:string; }
export default function FeatureMeshViewport({ geometry, revisionId, viewKey, measurement={phase:"idle"}, onMeasurementPoint, onMeasurementHover, onMeasurementCancel, onRendererStatus }: {
  geometry: FeatureEvaluation; revisionId: string; viewKey?: string; measurement?: FixtureReviewMeasurement;
  onMeasurementPoint?: (point:FixtureReviewPoint)=>void; onMeasurementHover?: (point:FixtureReviewPoint|null)=>void; onMeasurementCancel?:()=>void;
  onRendererStatus?:(status:FeatureRendererStatus)=>void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const pickingReady=useRef(false);
  const interaction=useRef({measurement,onMeasurementPoint,onMeasurementHover,onMeasurementCancel});
  interaction.current={measurement,onMeasurementPoint,onMeasurementHover,onMeasurementCancel};
  const updateOverlay=useRef<(value:FixtureReviewMeasurement)=>void>(()=>{});
  useEffect(()=>{updateOverlay.current(measurement);},[measurement]);
  useEffect(() => {
    setReady(false);
    pickingReady.current=false;
    setError("");
    onRendererStatus?.({revisionId,state:"initializing",reason:"Review renderer initializing"});
    let disposed = false;
    let dispose = () => {};
    void (async () => {
      try {
        const THREE = await import("three");
        const { OrbitControls } = await import("three/addons/controls/OrbitControls.js");
        if (disposed || !host.current) return;
        const element = host.current;
        const scene = new THREE.Scene();
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        element.appendChild(renderer.domElement);
        const meshGeometry = new THREE.BufferGeometry();
        // CAD Z is vertical in the existing viewport (Three Y); preserve handedness.
        const vertices = new Float32Array(geometry.vertices.length);
        for (let i = 0; i < vertices.length; i += 3) {
          vertices[i] = geometry.vertices[i];
          vertices[i + 1] = geometry.vertices[i + 2];
          vertices[i + 2] = -geometry.vertices[i + 1];
        }
        meshGeometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
        meshGeometry.setIndex(geometry.triangles);
        meshGeometry.computeVertexNormals();
        const material = new THREE.MeshStandardMaterial({ color: 0x58b8d3, side: THREE.DoubleSide, metalness: 0.12, roughness: 0.7 });
        const mesh=new THREE.Mesh(meshGeometry, material);
        scene.add(mesh);
        const overlay=new THREE.Group();overlay.name="review-mesh-measurement-overlay";scene.add(overlay);
        updateOverlay.current=value=>{element.dataset.measurementOverlay=updateReviewMeasurementOverlay(overlay,value);renderer.render(scene,camera);};
        const grid = new THREE.GridHelper(240, 24, 0x42647d, 0x243c4e);
        scene.add(grid);
        scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 2));
        const light = new THREE.DirectionalLight(0xffffff, 2);
        light.position.set(80, 130, 100); scene.add(light);
        const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 3000);
        const controls = new OrbitControls(camera, renderer.domElement);
        const bounds = geometry.bounds;
        controls.target.set((bounds.min[0] + bounds.max[0]) / 2, (bounds.min[2] + bounds.max[2]) / 2, -(bounds.min[1] + bounds.max[1]) / 2);
        const cadBounds = meshBounds(geometry.vertices);
        const actions = element as ViewHost;
        const view = (action: CameraPreset | "fit" | "reset" | "roll") => {
          const fit = applyCameraAction(camera, controls, cadBounds, "feature-display", action);
          if (fit) element.dataset.fitDistance = fit.distance.toFixed(3);
          element.dataset.viewState = action;
          recordCameraPose(element, camera, controls.target);
          renderer.render(scene, camera);
        };
        actions.setView = preset => view(preset);
        actions.fitView = () => view("fit");
        actions.resetView = () => view("reset");
        actions.rollView = () => view("roll");
        camera.up.set(0, 1, 0);
        camera.aspect = element.clientWidth > 0 && element.clientHeight > 0 ? element.clientWidth / element.clientHeight : 1;
        view("reset");
        restoreCamera(viewKey, camera, controls);
        const raycaster=new THREE.Raycaster();
        const pick=(x:number,y:number)=>pickingReady.current?reviewMeshPointAt(raycaster,camera,mesh,renderer.domElement.getBoundingClientRect(),x,y):null;
        const keyboardPick=()=>{const rect=renderer.domElement.getBoundingClientRect();for(const y of [0.5,0.4,0.6,0.3,0.7])for(const x of [0.5,0.4,0.6,0.3,0.7]){const point=pick(rect.left+rect.width*x,rect.top+rect.height*y);if(point)return point;}return null;};
        let down={x:0,y:0};
        const pointerDown=(event:PointerEvent)=>{down={x:event.clientX,y:event.clientY};if(interaction.current.measurement.phase!=="idle")renderer.domElement.focus();};
        const click=(event:MouseEvent)=>{if(Math.hypot(event.clientX-down.x,event.clientY-down.y)>4)return;const phase=interaction.current.measurement.phase;if(phase!=="armed"&&phase!=="endpoint-a")return;const point=pick(event.clientX,event.clientY);if(point)interaction.current.onMeasurementPoint?.(point);};
        const move=(event:PointerEvent)=>{if(interaction.current.measurement.phase==="endpoint-a")interaction.current.onMeasurementHover?.(pick(event.clientX,event.clientY));};
        const keydown=(event:KeyboardEvent)=>{const phase=interaction.current.measurement.phase;if(event.key==="Escape"&&phase!=="idle"){event.preventDefault();interaction.current.onMeasurementCancel?.();}else if((event.key==="Enter"||event.key===" ")&&(phase==="armed"||phase==="endpoint-a")){event.preventDefault();const point=keyboardPick();if(point)interaction.current.onMeasurementPoint?.(point);}};
        renderer.domElement.tabIndex=0;renderer.domElement.setAttribute("aria-label","Feature review mesh; when measuring press Enter or Space to pick a visible mesh point, Escape to cancel");
        renderer.domElement.addEventListener("pointerdown",pointerDown);renderer.domElement.addEventListener("click",click);renderer.domElement.addEventListener("pointermove",move);renderer.domElement.addEventListener("keydown",keydown);
        const render = () => { rememberCamera(viewKey, camera, controls.target); recordCameraPose(element, camera, controls.target); renderer.render(scene, camera); };
        const resize = () => { const width = element.clientWidth, height = element.clientHeight; if (!width || !height) return; camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setSize(width, height); render(); };
        const observer = new ResizeObserver(resize); observer.observe(element);
        controls.addEventListener("change", render); resize();updateOverlay.current(interaction.current.measurement);
        const lost=(event:Event)=>{event.preventDefault();pickingReady.current=false;setReady(false);setError("WebGL context lost");onRendererStatus?.({revisionId,state:"failed",reason:"WebGL context lost"});};
        renderer.domElement.addEventListener("webglcontextlost",lost);
        pickingReady.current=true;setReady(true);onRendererStatus?.({revisionId,state:"ready"});
        dispose = () => { renderer.domElement.removeEventListener("webglcontextlost",lost);delete actions.setView;delete actions.fitView;delete actions.resetView;delete actions.rollView;observer.disconnect();controls.removeEventListener("change",render);renderer.domElement.removeEventListener("pointerdown",pointerDown);renderer.domElement.removeEventListener("click",click);renderer.domElement.removeEventListener("pointermove",move);renderer.domElement.removeEventListener("keydown",keydown);updateOverlay.current=()=>{};clearReviewMeasurementOverlay(overlay);controls.dispose(); meshGeometry.dispose(); material.dispose(); grid.geometry.dispose(); (grid.material as import("three").Material).dispose(); renderer.dispose(); renderer.domElement.remove(); };
      } catch (cause) { if (!disposed) {const reason=cause instanceof Error?cause.message:"WebGL unavailable";setReady(false);setError(reason);onRendererStatus?.({revisionId,state:"failed",reason});} }
    })();
    return () => { disposed = true;pickingReady.current=false;dispose();onRendererStatus?.({revisionId,state:"unavailable",reason:"Review renderer inactive"}); };
  }, [geometry, viewKey, revisionId, onRendererStatus]);
  return <section className="r7-empty-viewport r7-authored-viewport" aria-label="Feature review mesh" data-revision-id={revisionId} data-testid="feature-mesh-viewport">
    <div className="r7-three" ref={host} data-measurement-phase={measurement.phase} />
    <ViewControls host={host} unavailable={error ? `renderer failed: ${error}` : ready ? null : "renderer initializing"} />
    <div className="r7-axis">Review mesh only · CAD Z ↑<br />mm · not fabrication approved</div>
    {error && <p role="status">3D preview unavailable: {error}</p>}
  </section>;
}
