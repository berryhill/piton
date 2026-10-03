import * as THREE from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import type { GeometryResult } from "./geometry/gate";
export function reviewPartStl(mesh: GeometryResult, revisionId: string): string {
  if(mesh.sourceRevisionId !== revisionId) throw new Error("Review mesh is stale");
  if(!mesh.triangles.length || !mesh.vertices.length || mesh.vertices.some(v=>!Number.isFinite(v))) throw new Error("Invalid review mesh");
  const geometry=new THREE.BufferGeometry();
  try {
    geometry.setAttribute("position",new THREE.Float32BufferAttribute(mesh.vertices,3)); geometry.setIndex(mesh.triangles); geometry.computeVertexNormals();
    return new STLExporter().parse(new THREE.Mesh(geometry),{binary:false});
  } finally {geometry.dispose();}
}
export function downloadPartFile(filename:string,text:string,type:string) {
  const url=URL.createObjectURL(new Blob([text],{type}));const anchor=document.createElement("a");anchor.href=url;anchor.download=filename;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
