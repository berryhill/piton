import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import Module, { type ManifoldToplevel } from "manifold-3d";
import ProjectWorkspace from "../src/ProjectWorkspace";
import { WorkspaceApplication, type WorkspaceStore } from "../src/workspace";
import { evaluateFeatureSource } from "../src/modeling/evaluator";
import { evaluateFeatureSourceInWorker } from "../src/modeling/client";
import { featureReviewStl } from "../src/partExport";
import { appendFeatures, emptyFeatureSource } from "../src/modeling/source";
import { CadApplication } from "../src/application";
import { MemoryProjectRepository } from "../src/storage/repository";

vi.mock("../src/components/Viewport",()=>({default:()=>null}));
vi.mock("../src/modeling/client",async importOriginal=>({...await importOriginal<typeof import("../src/modeling/client")>(),evaluateFeatureSourceInWorker:vi.fn()}));
let kernel:ManifoldToplevel;
beforeAll(async()=>{kernel=await Module();kernel.setup();});
afterEach(()=>{cleanup();vi.clearAllMocks();});
class Store implements WorkspaceStore {
  row:{version:number;json:string}|null=null;
  async readWorkspace(){return structuredClone(this.row);}
  async writeWorkspace(version:number,json:string){this.row={version:version+1,json};}
}
const features=[
  {kind:"rectangle" as const,id:"outline",name:"Outline",plane:"XY" as const,width:80,height:50},
  {kind:"extrude" as const,id:"body",name:"Body",profileId:"outline",distance:6},
];
async function setup(mode:"none"|"empty"|"feature"="feature",historical=false){
  const app=new WorkspaceApplication(new Store(),async source=>evaluateFeatureSource(source,kernel));
  const projectId=await app.createProject("Outputs"),documentId=mode==="none"?null:await app.createPart(projectId,"Plate");
  let pointer:string|null=null,source=appendFeatures(emptyFeatureSource(),features),mesh=await evaluateFeatureSource(source,kernel);
  if(mode==="feature"&&documentId){
    const p=await app.proposeFeatures({projectId,documentId,expectedRevisionId:null,idempotencyKey:crypto.randomUUID(),units:"mm",features});
    pointer=await app.commitFeatures(p.proposal);
  }

  history.replaceState(null,"",`/projects/${projectId}${documentId?`/documents/${documentId}${historical?`/revisions/${pointer}`:""}`:""}`);
  render(<ProjectWorkspace application={app}/>);
  await screen.findByRole("region",{name:"Active document outputs"});
  return {app,projectId,documentId,pointer,source,mesh};
}
const outputs=()=>within(screen.getByRole("region",{name:"Active document outputs"}));
it("keeps an empty project and empty Part in one persistent Files → Outputs → Model slot with reasons",async()=>{
  await setup("none");
  expect(outputs().getByRole("button",{name:"Generated source"})).toBeDisabled();
  expect(outputs().getByRole("button",{name:"Generated source"})).toHaveAttribute("title","Open a Part first");
  expect(screen.getAllByRole("heading",{name:/Outputs · active document/})).toHaveLength(1);
  const sidebar=screen.getByRole("complementary",{name:"Project documents and model"});
  const headings=within(sidebar).getAllByRole("heading").map(element=>element.textContent);
  expect(headings.indexOf("Files · Part / Assembly")).toBeLessThan(headings.indexOf("Outputs · active document"));
  expect(headings.indexOf("Outputs · active document")).toBeLessThan(headings.indexOf("Model tree"));
});
it("empty Part has no generated feature source or mesh and cannot export",async()=>{
  await setup("empty");
  expect(outputs().getByRole("button",{name:/Download generated source/})).toBeDisabled();
  expect(outputs().getByRole("button",{name:/Download feature review STL/})).toBeDisabled();
  expect(outputs().getByRole("button",{name:/Download feature review STL/})).toHaveAttribute("title",expect.stringMatching(/No authored source/));
  expect(outputs().getByText(/no authored feature source/i)).toBeInTheDocument();
});
it("shows committed and historical authored source with revision pointer; loading and rejected meshes never export",async()=>{
  vi.mocked(evaluateFeatureSourceInWorker).mockImplementation(()=>new Promise(()=>{}));
  const {pointer,source}=await setup();
  expect(outputs().getByText(new RegExp(`revision ${pointer}`))).toHaveTextContent("Current committed");
  expect(outputs().getByRole("button",{name:/Download generated source/})).toBeEnabled();
  expect(outputs().getByRole("button",{name:/Download feature review STL/})).toBeDisabled();
  fireEvent.click(outputs().getByText(/Generated source · Current committed/));
  expect(outputs().getByTestId("generated-feature-source").textContent).toBe(source.source);
  cleanup();vi.mocked(evaluateFeatureSourceInWorker).mockRejectedValue(new Error("worker rejected"));
  await setup("feature",true);
  await waitFor(()=>expect(outputs().getByRole("button",{name:/Download feature review STL/})).toHaveAttribute("title","Review geometry rejected by worker"));
  expect(outputs().getByText("Generated source · Historical committed")).toBeInTheDocument();
  expect(outputs().getByRole("button",{name:/Download generated source/})).toBeEnabled();
});
it("exports an admitted CAD-mm feature mesh without changing coordinates and rejects invalid source/indices",async()=>{
  const source=appendFeatures(emptyFeatureSource(),features),mesh=await evaluateFeatureSource(source,kernel);
  const stl=featureReviewStl(source,mesh);
  expect(stl).toContain("vertex 80 50 6");
  expect(()=>featureReviewStl(emptyFeatureSource(),mesh)).toThrow();
  expect(()=>featureReviewStl(source,{...mesh,triangles:[...mesh.triangles.slice(0,-1),mesh.vertices.length/3]})).toThrow();
  expect(()=>featureReviewStl(source,{...mesh,vertices:[...mesh.vertices.slice(0,-1),NaN]})).toThrow();
});
it("preview source and review mesh are explicitly uncommitted, with no saved revision claim",async()=>{
  vi.mocked(evaluateFeatureSourceInWorker).mockImplementation(()=>new Promise(()=>{}));
  const {app,projectId,documentId,source}=await setup("empty");
  const preview=await app.proposeFeatures({projectId,documentId:documentId!,expectedRevisionId:null,idempotencyKey:crypto.randomUUID(),units:"mm",features});
  vi.spyOn(app,"proposeFeatures").mockResolvedValueOnce(preview);
  const advanced=screen.getByTestId("empty-feature-authoring");
  fireEvent.click(within(advanced).getByText(/^Advanced ·/));
  fireEvent.change(screen.getByTestId("feature-source-input"),{target:{value:source.source}});
  fireEvent.click(screen.getByTestId("submit-first-feature"));
  await waitFor(()=>expect(outputs().getByText(/Uncommitted preview ·/)).toBeInTheDocument());
  expect(outputs().getByRole("button",{name:/Download feature review STL/})).toBeEnabled();
  expect(outputs().getByText(/Uncommitted preview ·/)).toHaveTextContent(preview.candidate.id);
  expect(outputs().getByText(/Uncommitted preview ·/)).not.toHaveTextContent("revision ");
  fireEvent.change(screen.getByTestId("feature-source-input"),{target:{value:source.source+"\n// edit"}});
  expect(outputs().getByRole("button",{name:/Download feature review STL/})).toBeDisabled();
  expect(outputs().getByRole("button",{name:/Download generated source/})).toBeDisabled();
});
it("consolidates imported Part custody and stale-gated STL in the same Outputs slot",async()=>{
  const legacy=new CadApplication(new MemoryProjectRepository());
  await legacy.open();
  const app=new WorkspaceApplication(new Store());
  const projectId=await app.importCustody(await legacy.exportPortableCustody());
  const documentId=(await app.read()).projects[0].documents[0].id;
  history.replaceState(null,"",`/projects/${projectId}/documents/${documentId}`);
  render(<ProjectWorkspace application={app}/>);
  await screen.findByRole("region",{name:"Active document outputs"});
  const slot=outputs();
  expect(slot.getByRole("button",{name:"Export Part custody"})).toBeEnabled();
  expect(slot.getByRole("button",{name:"Download Part review STL (unreleased)"})).toBeDisabled();
  expect(slot.getByRole("button",{name:"Download Part review STL (unreleased)"})).toHaveAttribute("title","Revision-matched admitted review geometry required");
  expect(screen.getAllByRole("heading",{name:/Outputs · active document/})).toHaveLength(1);
  expect(screen.getAllByRole("heading",{name:/Model tree/})).toHaveLength(1);
  expect(screen.getByRole("complementary",{name:"Project documents and model"}).textContent).toMatch(/Files · Part \/ Assembly[\s\S]*Outputs · active document[\s\S]*Model tree/);
  expect(screen.getAllByRole("button",{name:"Export Part custody"})).toHaveLength(1);
});
