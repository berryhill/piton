import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import Module, { type ManifoldToplevel } from "manifold-3d";
import { BoxGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera, Raycaster } from "three";
import ProjectWorkspace from "../src/ProjectWorkspace";
import { WorkspaceApplication, type WorkspaceStore } from "../src/workspace";
import { evaluateFeatureSource } from "../src/modeling/evaluator";
import { reviewMeshPointAt } from "../src/modeling/FeatureMeshViewport";

vi.mock("../src/components/Viewport",()=>({default:()=>null}));
vi.mock("../src/modeling/FeatureMeshViewport",async importOriginal=>{
  const actual=await importOriginal<typeof import("../src/modeling/FeatureMeshViewport")>();
  return {...actual,default:({revisionId,measurement,onMeasurementPoint,onMeasurementCancel}:{revisionId:string;measurement:{phase:string};onMeasurementPoint:(point:readonly [number,number,number])=>void;onMeasurementCancel:()=>void})=><section data-testid="feature-mesh-viewport" data-revision-id={revisionId} data-phase={measurement.phase}><button onClick={()=>onMeasurementPoint([0,0,0])}>Pick A</button><button onClick={()=>onMeasurementPoint([3,4,0])}>Pick B</button><button onClick={onMeasurementCancel}>Escape mesh</button></section>};
});
let kernel:ManifoldToplevel;
beforeAll(async()=>{kernel=await Module();kernel.setup();});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
class Store implements WorkspaceStore {
  row:{version:number;json:string}|null=null;
  async readWorkspace(){return structuredClone(this.row);}
  async writeWorkspace(version:number,json:string){if(version!==(this.row?.version??0))throw new Error("stale");this.row={version:version+1,json};}
}
async function setup(){
  const app=new WorkspaceApplication(new Store(),async source=>evaluateFeatureSource(source,kernel));
  const projectId=await app.createProject("Inspection"),documentId=await app.createPart(projectId,"Plate");
  history.replaceState(null,"",`/projects/${projectId}/documents/${documentId}`);
  render(<ProjectWorkspace application={app}/>);
  await screen.findByRole("tablist",{name:"Part command categories"});
  const commands=()=>screen.getByRole("region",{name:"Part commands"});
  fireEvent.click(within(commands()).getByRole("tab",{name:"Inspect"}));
  return {app,commands,projectId,documentId};
}
async function preview(commands:()=>HTMLElement){
  fireEvent.click(within(commands()).getByRole("tab",{name:"Sketch"}));
  fireEvent.change(within(commands()).getByRole("combobox",{name:"Sketch plane"}),{target:{value:"XY"}});
  fireEvent.click(within(commands()).getByRole("button",{name:"New Sketch"}));
  fireEvent.click(within(commands()).getByRole("button",{name:"Rectangle"}));
  fireEvent.click(screen.getByRole("form",{name:"Rectangle parameters"}).querySelector("button")!);
  fireEvent.click(within(commands()).getByRole("button",{name:"Finish Sketch"}));
  fireEvent.click(within(commands()).getByRole("tab",{name:"Features"}));
  fireEvent.click(within(commands()).getByRole("button",{name:"Extrude"}));
  fireEvent.click(screen.getByRole("form",{name:"Extrude parameters"}).querySelector("button")!);
  fireEvent.click(within(commands()).getByRole("button",{name:"Preview features"}));
  await screen.findByTestId("feature-preview");
  fireEvent.click(within(commands()).getByRole("tab",{name:"Inspect"}));
  await waitFor(()=>expect(within(commands()).getByRole("button",{name:"Measure"})).toBeEnabled());
}
it("raycasts the review triangle mesh using canvas coordinates, not grid or empty space",()=>{
  const mesh=new Mesh(new BoxGeometry(2,2,2),new MeshBasicMaterial());
  const camera=new PerspectiveCamera(60,1,0.1,100);camera.position.set(0,0,10);camera.lookAt(0,0,0);camera.updateProjectionMatrix();camera.updateMatrixWorld();mesh.updateMatrixWorld();
  const rect={left:10,top:20,width:100,height:100} as DOMRect;
  expect(reviewMeshPointAt(new Raycaster(),camera,mesh,rect,60,70)).toEqual([0,0,1]);
  expect(reviewMeshPointAt(new Raycaster(),camera,mesh,rect,110,120)).toBeNull();
  expect(reviewMeshPointAt(new Raycaster(),camera,mesh,{...rect,width:0},60,70)).toBeNull();
  mesh.geometry.dispose();(mesh.material as MeshBasicMaterial).dispose();
});
it("measures two mesh points in mm, clears/cancels without writing a revision",async()=>{
  const {app,commands}=await setup();
  expect(within(commands()).getByRole("button",{name:"Measure"})).toBeDisabled();
  await preview(commands);
  const initial=await app.read();
  const measure=within(commands()).getByRole("button",{name:"Measure"});
  fireEvent.click(measure);expect(screen.getByTestId("feature-measurement")).toHaveTextContent("first point");
  fireEvent.click(screen.getByRole("button",{name:"Pick A"}));
  expect(screen.getByTestId("feature-measurement")).toHaveTextContent("second point");
  fireEvent.click(screen.getByRole("button",{name:"Pick B"}));
  expect(screen.getByTestId("feature-measurement")).toHaveTextContent("5.00 mm · review-only, not exact B-rep");
  expect(await app.read()).toEqual(initial);
  fireEvent.click(within(commands()).getByRole("button",{name:"Clear"}));
  expect(screen.getByTestId("feature-measurement")).not.toHaveTextContent("5.00 mm");
  fireEvent.click(measure);fireEvent.click(screen.getByRole("button",{name:"Pick A"}));
  fireEvent.click(screen.getByRole("button",{name:"Escape mesh"}));
  expect(within(commands()).getByRole("button",{name:"Clear"})).toBeDisabled();
});
it("removes measurement across tabs and when preview geometry is invalidated",async()=>{
  const {app,commands,projectId}=await setup();await preview(commands);
  fireEvent.click(within(commands()).getByRole("button",{name:"Measure"}));
  fireEvent.click(screen.getByRole("button",{name:"Pick A"}));fireEvent.click(screen.getByRole("button",{name:"Pick B"}));
  const other=await act(()=>app.createPart(projectId,"Other"));
  fireEvent.click(within(screen.getByRole("navigation",{name:"Project Files"})).getByRole("button",{name:"Other"}));
  await waitFor(()=>expect(location.pathname).toContain(other));
  fireEvent.click(within(commands()).getByRole("tab",{name:"Inspect"}));
  expect(within(commands()).getByRole("button",{name:"Measure"})).toBeDisabled();
  fireEvent.click(screen.getByRole("tab",{name:"Plate"}));
  fireEvent.click(within(commands()).getByRole("tab",{name:"Inspect"}));
  expect(within(commands()).getByTestId("feature-measurement")).not.toHaveTextContent("5.00 mm");
  fireEvent.click(screen.getByText(/^Advanced ·/));
  fireEvent.change(screen.getByRole("textbox",{name:"Named feature source"}),{target:{value:"// invalidated draft"}});
  expect(screen.queryByTestId("feature-mesh-viewport")).toBeNull();
  expect(within(commands()).getByRole("button",{name:"Measure"})).toBeDisabled();
  expect(within(commands()).getByRole("button",{name:"Clear"})).toBeDisabled();
});
