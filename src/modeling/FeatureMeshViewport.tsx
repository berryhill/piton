import { useEffect, useRef, useState } from "react";
import type { FeatureEvaluation } from "./evaluator";

/** A review-only projection of the evaluated Manifold triangles, not CAD authority. */
export default function FeatureMeshViewport({ geometry, revisionId }: { geometry: FeatureEvaluation; revisionId: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
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
        scene.add(new THREE.Mesh(meshGeometry, material));
        const grid = new THREE.GridHelper(240, 24, 0x42647d, 0x243c4e);
        scene.add(grid);
        scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 2));
        const light = new THREE.DirectionalLight(0xffffff, 2);
        light.position.set(80, 130, 100); scene.add(light);
        const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 3000);
        const controls = new OrbitControls(camera, renderer.domElement);
        const bounds = geometry.bounds;
        controls.target.set((bounds.min[0] + bounds.max[0]) / 2, (bounds.min[2] + bounds.max[2]) / 2, -(bounds.min[1] + bounds.max[1]) / 2);
        const span = Math.max(...bounds.max.map((v, i) => v - bounds.min[i]), 10);
        camera.position.copy(controls.target).add(new THREE.Vector3(span * 1.7, span * 1.5, span * 1.8));
        camera.lookAt(controls.target); controls.update();
        const render = () => renderer.render(scene, camera);
        const resize = () => { const width = element.clientWidth, height = element.clientHeight; if (!width || !height) return; camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setSize(width, height); render(); };
        const observer = new ResizeObserver(resize); observer.observe(element);
        controls.addEventListener("change", render); resize();
        dispose = () => { observer.disconnect(); controls.dispose(); meshGeometry.dispose(); material.dispose(); grid.geometry.dispose(); (grid.material as import("three").Material).dispose(); renderer.dispose(); renderer.domElement.remove(); };
      } catch (cause) { if (!disposed) setError(cause instanceof Error ? cause.message : "WebGL unavailable"); }
    })();
    return () => { disposed = true; dispose(); };
  }, [geometry]);
  return <section className="r7-empty-viewport r7-authored-viewport" aria-label="Feature review mesh" data-revision-id={revisionId} data-testid="feature-mesh-viewport">
    <div className="r7-three" ref={host} />
    <div className="r7-axis">Review mesh only · CAD Z ↑<br />mm · not fabrication approved</div>
    {error && <p role="status">3D preview unavailable: {error}</p>}
  </section>;
}
