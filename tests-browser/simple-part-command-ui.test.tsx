import { cleanup, fireEvent, render, screen, waitFor, within, act } from "@testing-library/react";
import Module, { type ManifoldToplevel } from "manifold-3d";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import ProjectWorkspace from "../src/ProjectWorkspace";
import { WorkspaceApplication, type WorkspaceStore, isFeaturePart } from "../src/workspace";
import { evaluateFeatureSource } from "../src/modeling/evaluator";
import { readFeatures } from "../src/modeling/source";
import { appendFeatures, emptyFeatureSource } from "../src/modeling/source";
import { PartCommandUI } from "../src/modeling/PartCommandUI";

vi.mock("../src/components/Viewport",()=>({default:()=>null}));
let kernel:ManifoldToplevel;
beforeAll(async()=>{kernel=await Module();kernel.setup();});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
class Store implements WorkspaceStore {
  row:{version:number;json:string}|null=null;
  async readWorkspace(){return structuredClone(this.row);}
  async writeWorkspace(version:number,json:string){if(version!==(this.row?.version??0))throw new Error("stale");this.row={version:version+1,json};}
}
async function setup(){
  const store=new Store();const app=new WorkspaceApplication(store,async source=>evaluateFeatureSource(source,kernel));
  const projectId=await app.createProject("Command test"),documentId=await app.createPart(projectId,"Plate");
  history.replaceState(null,"",`/projects/${projectId}/documents/${documentId}`);
  render(<ProjectWorkspace application={app}/>);
  await screen.findByRole("tablist",{name:"Part command categories"});
  return {app,store,projectId,documentId};
}
function commands(){return screen.getByRole("region",{name:"Part commands"});}
function chooseCategory(name:string){fireEvent.click(within(commands()).getByRole("tab",{name}));}
function startSketch(bar=commands()){
  fireEvent.change(within(bar).getByRole("combobox",{name:"Sketch plane"}),{target:{value:"XY"}});
  fireEvent.click(within(bar).getByRole("button",{name:"New Sketch"}));
}

it("places accessible Sketch, Features, Inspect in order and commands in the center",async()=>{
  await setup();
  const bar=commands();
  expect(bar.closest(".r7-center")).not.toBeNull();
  expect(within(bar).getAllByRole("tab").map(node=>node.textContent)).toEqual(["Sketch","Features","Inspect"]);
  expect(within(bar).getByLabelText("Sketch tools").querySelectorAll("button")).toHaveLength(5);
  expect([...within(bar).getByLabelText("Sketch tools").querySelectorAll("button")].map(node=>node.textContent)).toEqual(["New Sketch","Line","Rectangle","Circle","Dimension"]);
  chooseCategory("Features");
  expect([...within(bar).getByLabelText("Features tools").querySelectorAll("button")].map(node=>node.textContent)).toEqual(["Extrude","Revolve","Hole","Linear Pattern","Fillet","Chamfer"]);
  expect(within(bar).getByRole("button",{name:"Extrude"})).toBeDisabled();
  chooseCategory("Inspect");
  expect([...within(bar).getByLabelText("Inspect tools").querySelectorAll("button")].map(node=>node.textContent)).toEqual(["Measure","Clear"]);
  expect(within(bar).getByRole("button",{name:"Measure"})).toBeDisabled();
});
it("authors a rectangle plate via sketch, explicit review preview and immutable commit without source typing",async()=>{
  const {app,store}=await setup();const bar=commands();
  const initial=await app.read();
  startSketch(bar);
  fireEvent.click(within(bar).getByRole("button",{name:"Rectangle"}));
  fireEvent.change(within(bar).getByLabelText("width"),{target:{value:"80"}});
  fireEvent.change(within(bar).getByLabelText("height"),{target:{value:"50"}});
  fireEvent.click(within(bar).getByRole("button",{name:"Apply to sketch"}));
  expect(within(bar).getByRole("img",{name:"Sketch-only 2D preview"})).toBeInTheDocument();
  expect(await app.read()).toEqual(initial);
  fireEvent.click(within(bar).getByRole("button",{name:"Finish Sketch"}));
  expect(await app.read()).toEqual(initial);
  chooseCategory("Features");
  fireEvent.click(within(bar).getByRole("button",{name:"Extrude"}));
  fireEvent.change(within(bar).getByLabelText("distance"),{target:{value:"6"}});
  fireEvent.click(within(bar).getByRole("button",{name:"Add feature"}));
  expect((screen.getByTestId("feature-source-input") as HTMLTextAreaElement).value).toMatch(/part\.extrude/);
  expect(await app.read()).toEqual(initial);
  fireEvent.click(within(bar).getByRole("button",{name:"Preview features"}));
  expect(await screen.findByTestId("feature-preview")).toHaveTextContent("Preview only");
  expect(await app.read()).toEqual(initial);
  fireEvent.click(within(bar).getByRole("button",{name:"Commit feature revision"}));
  await waitFor(async()=>expect(isFeaturePart((await app.read()).projects[0].documents[0].part)).toBe(true));
  const part=(await app.read()).projects[0].documents[0].part;
  if(!isFeaturePart(part))throw new Error("feature part missing");
  expect(readFeatures(part.revisions[0].authored).map(f=>f.kind)).toEqual(["rectangle","extrude"]);
  expect(part.revisions[0]).toMatchObject({reviewState:"needs_human_review",fabricationRelease:false,machineActuation:false});
  expect(store.row?.version).toBe(3);
});
it("preserves a sketch per tab and blocks unsupported operations",async()=>{
  const {app,projectId,documentId}=await setup();
  const propose=vi.spyOn(app,"proposeFeatures");
  startSketch();
  fireEvent.click(within(commands()).getByRole("button",{name:"Circle"}));
  fireEvent.click(within(commands()).getByRole("button",{name:"Apply to sketch"}));
  const second=await act(async()=>app.createPart(projectId,"Other"));
  fireEvent.click(within(screen.getByRole("navigation",{name:"Project Files"})).getByRole("button",{name:"Other"}));
  await waitFor(()=>expect(location.pathname).toContain(second));
  fireEvent.click(screen.getByRole("tab",{name:"Plate"}));
  expect(within(commands()).getByRole("img",{name:"Sketch-only 2D preview"})).toBeInTheDocument();
  chooseCategory("Features");
  expect(within(commands()).getByRole("button",{name:"Revolve"})).toBeDisabled();
  expect(propose).not.toHaveBeenCalled();
  expect((await app.read()).projects[0].documents.find(d=>d.id===documentId)?.part.currentRevisionId).toBeNull();
});

it("gates New Sketch on explicit XY choice and marks unsupported planes unavailable",async()=>{
  await setup();const bar=commands();
  expect(within(bar).getByRole("button",{name:"New Sketch"})).toBeDisabled();
  const plane=within(bar).getByRole("combobox",{name:"Sketch plane"});
  expect(within(plane).getByRole("option",{name:/XZ plane/})).toBeDisabled();
  expect(within(plane).getByRole("option",{name:/YZ plane/})).toBeDisabled();
  startSketch(bar);
  expect(within(bar).getByText(/XY sketch · drawing/)).toBeInTheDocument();
});

it("roves category focus and selection with arrows, Home and End and associates the panel",async()=>{
  await setup();const bar=commands();
  const tabs=within(bar).getAllByRole("tab"),panel=within(bar).getByRole("tabpanel");
  expect(tabs.map(tab=>tab.getAttribute("tabindex"))).toEqual(["0","-1","-1"]);
  for(const tab of tabs)expect(tab).toHaveAttribute("aria-controls",panel.id);
  tabs[0].focus();fireEvent.keyDown(tabs[0],{key:"ArrowRight"});
  expect(tabs[1]).toHaveFocus();expect(tabs[1]).toHaveAttribute("aria-selected","true");
  expect(panel).toHaveAttribute("aria-labelledby",tabs[1].id);
  fireEvent.keyDown(tabs[1],{key:"End"});expect(tabs[2]).toHaveFocus();
  fireEvent.keyDown(tabs[2],{key:"ArrowRight"});expect(tabs[0]).toHaveFocus();
  fireEvent.keyDown(tabs[0],{key:"ArrowLeft"});expect(tabs[2]).toHaveFocus();
  fireEvent.keyDown(tabs[2],{key:"Home"});expect(tabs[0]).toHaveFocus();
  expect(tabs.map(tab=>tab.getAttribute("tabindex"))).toEqual(["0","-1","-1"]);
});

it("prefills dimensions from the edited rectangle and preserves an untouched dimension",async()=>{
  await setup();const bar=commands();startSketch(bar);
  fireEvent.click(within(bar).getByRole("button",{name:"Rectangle"}));
  fireEvent.change(within(bar).getByLabelText("width"),{target:{value:"125"}});
  fireEvent.change(within(bar).getByLabelText("height"),{target:{value:"73"}});
  fireEvent.click(within(bar).getByRole("button",{name:"Apply to sketch"}));
  fireEvent.click(within(bar).getByRole("button",{name:"Dimension"}));
  expect(within(bar).getByLabelText("width")).toHaveValue(125);
  expect(within(bar).getByLabelText("height")).toHaveValue(73);
  fireEvent.change(within(bar).getByLabelText("width"),{target:{value:"140"}});
  fireEvent.click(within(bar).getByRole("button",{name:"Apply to sketch"}));
  fireEvent.click(within(bar).getByRole("button",{name:"Dimension"}));
  expect(within(bar).getByLabelText("height")).toHaveValue(73);
  expect(within(bar).getByRole("img",{name:"Sketch-only 2D preview"}).querySelector("polygon")).toHaveAttribute("points","0,0 140,0 140,73 0,73");
});

it("renders a large circle using its actual radius and bounds",async()=>{
  await setup();const bar=commands();startSketch(bar);
  fireEvent.click(within(bar).getByRole("button",{name:"Circle"}));
  fireEvent.change(within(bar).getByLabelText("diameter"),{target:{value:"800"}});
  fireEvent.click(within(bar).getByRole("button",{name:"Apply to sketch"}));
  const svg=within(bar).getByRole("img",{name:"Sketch-only 2D preview"});
  expect(svg.querySelector("circle")).toHaveAttribute("r","400");
  expect(svg).toHaveAttribute("viewBox","-440 -440 880 880");
});

it("preloads selected polygon vertex coordinates and rejects an invalid vertex",async()=>{
  await setup();const bar=commands();startSketch(bar);
  for(const [x,y] of [[10,20],[110,20],[10,90]]){
    fireEvent.click(within(bar).getByRole("button",{name:"Line"}));
    fireEvent.change(within(bar).getByLabelText("x"),{target:{value:String(x)}});
    fireEvent.change(within(bar).getByLabelText("y"),{target:{value:String(y)}});
    fireEvent.click(within(bar).getByRole("button",{name:"Apply to sketch"}));
  }
  fireEvent.click(within(bar).getByRole("button",{name:"Close Line"}));
  const svg=within(bar).getByRole("img",{name:"Sketch-only 2D preview"});
  expect(svg.querySelector("polygon")).toHaveAttribute("points","10,20 110,20 10,90");
  expect(svg).toHaveAttribute("viewBox","5 15 110 80");
  fireEvent.click(within(bar).getByRole("button",{name:"Dimension"}));
  fireEvent.change(within(bar).getByLabelText("Vertex index"),{target:{value:"1"}});
  expect(within(bar).getByLabelText("vertexX")).toHaveValue(110);
  expect(within(bar).getByLabelText("vertexY")).toHaveValue(20);
  fireEvent.change(within(bar).getByLabelText("Vertex index"),{target:{value:"99"}});
  fireEvent.submit(within(bar).getByRole("form",{name:"Dimension parameters"}));
  expect(within(bar).getByRole("alert")).toHaveTextContent(/existing vertex index/);
  expect(svg.querySelector("polygon")).toHaveAttribute("points","10,20 110,20 10,90");
});

it("allocates a second pattern ID against retained feature IDs",()=>{
  const base=appendFeatures(emptyFeatureSource(),[
    {kind:"rectangle",id:"outline",name:"Outline",plane:"XY",width:100,height:80},
    {kind:"extrude",id:"plate",name:"Plate",profileId:"outline",distance:6},
    {kind:"hole",id:"hole1",name:"Hole",bodyId:"plate",x:15,y:15,diameter:4,extent:"through"},
    {kind:"linearPattern",id:"pattern1",name:"First pattern",bodyId:"plate",sourceHoleId:"hole1",count:2,spacingX:15,spacingY:0},
  ]);
  let updated="";
  render(<PartCommandUI context={{projectId:"p",documentId:"d",revisionId:"r"}} baseSource={base} source={base.source} onSource={value=>{updated=value;}} readonly={false} busy={false} previewReady={false} onPreview={()=>{}} onCommit={()=>{}} onSketchDirty={()=>{}}/>);
  chooseCategory("Features");fireEvent.click(within(commands()).getByRole("button",{name:"Linear Pattern"}));
  fireEvent.change(within(commands()).getByLabelText("spacingY"),{target:{value:"20"}});
  fireEvent.click(within(commands()).getByRole("button",{name:"Add feature"}));
  expect(readFeatures({...base,source:updated}).map(feature=>feature.id)).toEqual(["outline","plate","hole1","pattern1","pattern2"]);
});
