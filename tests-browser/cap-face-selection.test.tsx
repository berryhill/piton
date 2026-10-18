import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BufferGeometry, Float32BufferAttribute, Mesh, MeshBasicMaterial, PerspectiveCamera, Raycaster } from "three";
import { appendFeatures, emptyFeatureSource, readFeatures } from "../src/modeling/source";
import { evaluateFeatureSource } from "../src/modeling/evaluator";
import Module from "manifold-3d";
import { resolveCapFacePick, reviewMeshHitAt } from "../src/modeling/FeatureMeshViewport";
import { PartCommandUI } from "../src/modeling/PartCommandUI";
import { enumerateSurvivingCaps } from "../src/modeling/capFaces";

afterEach(cleanup);
const authored = appendFeatures(emptyFeatureSource(), [
  {kind:"rectangle",id:"outline",name:"Outline",plane:"XY",width:20,height:20},
  {kind:"extrude",id:"extrude1",name:"Base",profileId:"outline",distance:6},
]);
const context = {projectId:"p",documentId:"d",revisionId:"r1"};

it("matches indexed displayed triangles to exactly one surviving named cap; never guesses missing or overlapping hits", async () => {
  const kernel = await Module(); kernel.setup();
  const geometry = evaluateFeatureSource(authored,kernel);
  const candidates = enumerateSurvivingCaps(authored,geometry);
  const top = candidates.find(c=>c.side==="end")!;
  expect(resolveCapFacePick(candidates,top.triangleIndices[0])).toMatchObject({featureId:"extrude1",side:"end"});
  expect(resolveCapFacePick(candidates,-1)).toEqual({reason:"No surviving named cap at this triangle"});
  expect(resolveCapFacePick([...candidates,top],top.triangleIndices[0])).toEqual({reason:"Ambiguous named cap at this triangle"});
  const display = new Float32Array(geometry.vertices.length);
  for(let i=0;i<display.length;i+=3){display[i]=geometry.vertices[i];display[i+1]=geometry.vertices[i+2];display[i+2]=-geometry.vertices[i+1];}
  const buffer=new BufferGeometry();buffer.setAttribute("position",new Float32BufferAttribute(display,3));buffer.setIndex(geometry.triangles);
  const mesh=new Mesh(buffer,new MeshBasicMaterial({side:2}));
  const camera=new PerspectiveCamera(40,1,0.1,100);camera.position.set(10,40,-10);camera.lookAt(10,3,-10);camera.updateProjectionMatrix();camera.updateMatrixWorld();mesh.updateMatrixWorld();
  const hit=reviewMeshHitAt(new Raycaster(),camera,mesh,{left:0,top:0,width:100,height:100} as DOMRect,50,50);
  expect(hit?.faceIndex).toBeTypeOf("number");
  expect(resolveCapFacePick(candidates,hit!.faceIndex!)).toMatchObject({featureId:"extrude1",side:"end"});
  buffer.dispose();
});

it("uses only scoped real candidates in the chooser and selected-face New Sketch; clears without source mutation", async () => {
  const kernel=await Module();kernel.setup();
  const caps=enumerateSurvivingCaps(authored,evaluateFeatureSource(authored,kernel));
  const onSource=vi.fn();const onClear=vi.fn();
  const selection={...context,sourceDigest:"bound",scope:"r1",featureId:"extrude1",side:"end" as const,plane:"XY" as const};
  const {rerender}=render(<PartCommandUI context={context} baseSource={authored} source={authored.source} onSource={onSource} readonly={false} busy={false} previewReady={false} onPreview={()=>{}} onCommit={()=>{}} onSketchDirty={()=>{}} capCandidates={caps.filter(c=>c.side==="end")} capSelection={selection} onClearCapSelection={onClear}/>);
  const bar=screen.getByRole("region",{name:"Part commands"});
  expect(within(bar).getByRole("combobox",{name:"Sketch support"}).querySelectorAll("option")).toHaveLength(2);
  expect(within(bar).getByText(/Selected support: extrude1 end cap · review mesh/)).toBeInTheDocument();
  fireEvent.click(within(bar).getByRole("button",{name:"Sketch on selected face"}));
  expect(within(bar).getByText(/XY sketch · drawing/)).toBeInTheDocument();
  fireEvent.click(within(bar).getByRole("button",{name:"Cancel Sketch"}));
  expect(onSource).not.toHaveBeenCalled();
  fireEvent.click(within(bar).getByRole("button",{name:"Clear selected face"}));expect(onClear).toHaveBeenCalledOnce();
  rerender(<PartCommandUI context={context} baseSource={authored} source={authored.source} onSource={onSource} readonly busy={false} previewReady={false} onPreview={()=>{}} onCommit={()=>{}} onSketchDirty={()=>{}} capCandidates={caps} capSelection={selection} onClearCapSelection={onClear}/>);
  expect(within(bar).getByRole("button",{name:"Sketch on selected face"})).toBeDisabled();
  expect(readFeatures(authored)).toHaveLength(2);
});
