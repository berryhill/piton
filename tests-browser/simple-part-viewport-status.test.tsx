import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import Module, { type ManifoldToplevel } from "manifold-3d";
import ProjectWorkspace from "../src/ProjectWorkspace";
import { WorkspaceApplication, type WorkspaceStore } from "../src/workspace";
import { evaluateFeatureSource } from "../src/modeling/evaluator";
import { evaluateFeatureSourceInWorker } from "../src/modeling/client";
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
async function setup(historical=false){
  const app=new WorkspaceApplication(new Store(),async source=>evaluateFeatureSource(source,kernel));
  const projectId=await app.createProject("Viewport status"),documentId=await app.createPart(projectId,"Saved plate");
  const p=await app.proposeFeatures({projectId,documentId,expectedRevisionId:null,idempotencyKey:crypto.randomUUID(),units:"mm",features:[
    {kind:"rectangle",id:"outline",name:"Outline",plane:"XY",width:80,height:50},
    {kind:"extrude",id:"body",name:"Body",profileId:"outline",distance:6},
  ]});
  const pointer=await app.commitFeatures(p.proposal);
  history.replaceState(null,"",`/projects/${projectId}/documents/${documentId}${historical?`/revisions/${pointer}`:""}`);
  render(<ProjectWorkspace application={app}/>);
  await screen.findByTestId("workbench-viewport-body");
  return app;
}
it("shows loading saved geometry in the primary body instead of claiming the Part is empty",async()=>{
  vi.mocked(evaluateFeatureSourceInWorker).mockImplementation(()=>new Promise(()=>{}));
  const app=await setup(),saved=await app.read();
  const body=screen.getByTestId("workbench-viewport-body");
  expect(within(body).getByRole("status")).toHaveTextContent(/loading.*review geometry/i);
  expect(within(body).queryByText("Empty Part")).not.toBeInTheDocument();
  expect(await app.read()).toEqual(saved);
});
it("shows historical loading truth without changing readonly source or history",async()=>{
  vi.mocked(evaluateFeatureSourceInWorker).mockImplementation(()=>new Promise(()=>{}));
  const app=await setup(true),saved=await app.read();
  expect(within(screen.getByTestId("workbench-viewport-body")).getByRole("status")).toHaveTextContent(/historical.*review geometry/i);
  expect(screen.getByTestId("feature-source-input")).toBeDisabled();
  expect(screen.queryByText("Empty Part")).not.toBeInTheDocument();
  expect(await app.read()).toEqual(saved);
});
it("puts rejected-worker truth in the primary body while retaining saved revisions",async()=>{
  vi.mocked(evaluateFeatureSourceInWorker).mockRejectedValue(new Error("Test-only geometry failure"));
  const app=await setup(),saved=await app.read();
  await act(async()=>{});
  const body=screen.getByTestId("workbench-viewport-body");
  await waitFor(()=>expect(within(body).getByRole("alert")).toHaveTextContent(/review geometry.*unavailable/i));
  expect(within(body).queryByText("Empty Part")).not.toBeInTheDocument();
  expect(await app.read()).toEqual(saved);
});
