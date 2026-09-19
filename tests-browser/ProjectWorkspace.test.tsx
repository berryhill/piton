import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ProjectWorkspace from "../src/ProjectWorkspace";
import { WorkspaceApplication, type WorkspaceStore } from "../src/workspace";
import { DEFAULT_PARAMETERS } from "../src/domain";

vi.mock("../src/components/Viewport", () => ({ default: ({authoritativeBase,onReviewMesh,onBuildStatus}: {authoritativeBase:{id:string};onReviewMesh:(mesh:{sourceRevisionId:string})=>void;onBuildStatus:(status:{state:string})=>void}) => <button onClick={()=>{onReviewMesh({sourceRevisionId:authoritativeBase.id});onBuildStatus({state:"ready"});}}>Finish review mesh</button> }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
class Store implements WorkspaceStore {
  row: {version:number;json:string}|null=null;
  async readWorkspace() { return structuredClone(this.row); }
  async writeWorkspace(version:number,json:string) {
    if(version !== (this.row?.version??0)) throw new Error("stale workspace");
    this.row={version:version+1,json};
  }
}
function deferred<T>() { let resolve!: (value:T)=>void; const promise=new Promise<T>(r=>{resolve=r;}); return {promise,resolve}; }
async function fixture(editor=true) {
  const app=new WorkspaceApplication(new Store());
  const projectId=await app.createProject("Mounts");
  const documentId=await app.createPart(projectId,"Bracket");
  history.replaceState(null,"",editor?`/projects/${projectId}/documents/${documentId}`:"/projects");
  const view=render(<ProjectWorkspace application={app}/>);
  await screen.findByText(editor?"Parameters (mm)":"Recent projects");
  return {app,projectId,documentId,...view};
}
async function revise(app:WorkspaceApplication,projectId:string,documentId:string,length:number) {
  const d=(await app.read()).projects.find(p=>p.id===projectId)!.documents.find(d=>d.id===documentId)!;
  const p={projectId,documentId,expectedRevisionId:Object.keys(d.revisionIds).find(id=>d.revisionIds[id]===d.part.currentRevisionId)!,idempotencyKey:crypto.randomUUID(),parameters:{...DEFAULT_PARAMETERS,leg_length_mm:length}};
  await app.propose(p); await app.commit(p);
}
it("shows API-created projects in the mounted registry", async()=>{
  const {app}=await fixture(false);
  await act(async()=>{await app.createProject("Automation project");});
  expect(await screen.findByRole("button",{name:"Automation project"})).toBeVisible();
});
it("refreshes a clean editor after an API revision commit", async()=>{
  const {app,projectId,documentId}=await fixture();
  await act(async()=>{await revise(app,projectId,documentId,120);});
  await waitFor(()=>expect(screen.getByLabelText("leg_length_mm")).toHaveValue(120));
});
it("preserves a dirty draft and blocks authoring until explicit reload",async()=>{
  const {app,projectId,documentId}=await fixture();
  fireEvent.change(screen.getByLabelText("leg_length_mm"),{target:{value:"110"}});
  await act(async()=>{await revise(app,projectId,documentId,120);});
  expect(await screen.findByRole("alert")).toHaveTextContent(/changed.*reload/i);
  expect(screen.getByLabelText("leg_length_mm")).toHaveValue(110);
  expect(screen.getByRole("button",{name:"Commit revision"})).toBeDisabled();
  expect(screen.getByRole("button",{name:"Propose and preview"})).toBeDisabled();
  fireEvent.click(screen.getByRole("button",{name:"Reload latest revision"}));
  expect(screen.getByLabelText("leg_length_mm")).toHaveValue(120);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
it("ignores an older refresh resolving after a newer committed state",async()=>{
  const {app}=await fixture(false);
  const old=await app.read(); const pending=deferred<typeof old>();
  vi.spyOn(app,"read").mockImplementationOnce(()=>pending.promise);
  act(()=>window.dispatchEvent(new PopStateEvent("popstate")));
  await act(async()=>{await app.createProject("Newest state");});
  expect(await screen.findByRole("button",{name:"Newest state"})).toBeVisible();
  await act(async()=>pending.resolve(old));
  expect(screen.getByRole("button",{name:"Newest state"})).toBeVisible();
});
it("admits one GUI create and never navigates late after leaving its page",async()=>{
  const {app}=await fixture(false); const pending=deferred<string>();
  const create=vi.spyOn(app,"createProject").mockImplementation(()=>pending.promise);
  fireEvent.change(screen.getByLabelText("Project name"),{target:{value:"Delayed"}});
  const form=screen.getByRole("button",{name:"Create project"}).closest("form")!;
  fireEvent.submit(form); fireEvent.submit(form);
  expect(create).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button",{name:"All projects"}));
  await act(async()=>pending.resolve(crypto.randomUUID()));
  expect(location.pathname).toBe("/projects");
});
it("notifies only after persistence and isolates failing observers",async()=>{
  const store=new Store(), app=new WorkspaceApplication(store), observed=vi.fn(()=>{expect(store.row).not.toBeNull();});
  const unsubscribe=app.subscribe(observed); app.subscribe(()=>{throw new Error("observer failure");});
  await app.createProject("Persisted"); expect(observed).toHaveBeenCalledTimes(1);
  await expect(app.createProject("")).rejects.toThrow();expect(observed).toHaveBeenCalledTimes(1);
  vi.spyOn(store,"writeWorkspace").mockRejectedValueOnce(new Error("storage unavailable"));
  await expect(app.createProject("Rejected")).rejects.toThrow("storage unavailable");expect(observed).toHaveBeenCalledTimes(1);
  unsubscribe();await app.createProject("After unsubscribe");expect(observed).toHaveBeenCalledTimes(1);
});
it("commits GUI previews once without treating its own commit as a conflict",async()=>{
  const {app}=await fixture();
  fireEvent.change(screen.getByLabelText("leg_length_mm"),{target:{value:"110"}});
  await act(async()=>fireEvent.click(screen.getByRole("button",{name:"Propose and preview"})));
  fireEvent.click(screen.getByRole("button",{name:"Finish review mesh"}));
  const original=app.commit.bind(app), gate=deferred<void>();
  const commit=vi.spyOn(app,"commit").mockImplementation(async p=>{await gate.promise;return original(p);});
  const button=screen.getByRole("button",{name:"Commit revision"});
  fireEvent.click(button);fireEvent.click(button);
  expect(commit).toHaveBeenCalledTimes(1);
  await act(async()=>gate.resolve());
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByLabelText("leg_length_mm")).toHaveValue(110);
  expect(screen.queryByText("Preview only · not committed")).not.toBeInTheDocument();
  expect((await app.read()).projects[0].documents[0].part.revisions).toHaveLength(2);
});
it("preserves structured text on external revision and a rename draft on external rename",async()=>{
  const {app,projectId,documentId}=await fixture();
  fireEvent.change(screen.getByLabelText("Structured change request"),{target:{value:'{"unfinished":'}});
  await act(async()=>revise(app,projectId,documentId,120));
  expect(screen.getByRole("alert")).toHaveTextContent("Document changed");
  expect(screen.getByLabelText("Structured change request")).toHaveValue('{"unfinished":');
  fireEvent.click(screen.getByRole("button",{name:"Reload latest revision"}));
  fireEvent.change(screen.getByLabelText("Part name"),{target:{value:"Local name"}});
  await act(async()=>app.renamePart(projectId,documentId,"API name"));
  expect(screen.getByLabelText("Part name")).toHaveValue("Local name");
  expect(screen.getByRole("button",{name:"Rename Part"})).toBeDisabled();
});
it("keeps the latest editor revision when a stale document read resolves last",async()=>{
  const {app,projectId,documentId}=await fixture();const old=await app.read(), pending=deferred<typeof old>();
  vi.spyOn(app,"read").mockImplementationOnce(()=>pending.promise);
  act(()=>window.dispatchEvent(new PopStateEvent("popstate")));
  await act(async()=>revise(app,projectId,documentId,120));
  await act(async()=>pending.resolve(old));
  expect(screen.getByLabelText("leg_length_mm")).toHaveValue(120);
  expect(screen.getByRole("button",{name:"Revision 2 · current"})).toBeVisible();
});
it("does not resurrect a delayed proposal after an API revision invalidates it",async()=>{
  const {app,projectId,documentId}=await fixture();
  const original=app.propose.bind(app), gate=deferred<void>();
  vi.spyOn(app,"propose").mockImplementationOnce(async p=>{const result=await original(p);await gate.promise;return result;});
  fireEvent.change(screen.getByLabelText("leg_length_mm"),{target:{value:"110"}});
  fireEvent.click(screen.getByRole("button",{name:"Propose and preview"}));
  await act(async()=>revise(app,projectId,documentId,120));
  await act(async()=>gate.resolve());
  expect(screen.getByRole("alert")).toHaveTextContent("Document changed");
  expect(screen.queryByText("Preview only · not committed")).not.toBeInTheDocument();
  expect(screen.getByLabelText("leg_length_mm")).toHaveValue(110);
});
it("does not navigate after an in-flight create is unmounted",async()=>{
  const {app,unmount}=await fixture(false); const pending=deferred<string>();
  vi.spyOn(app,"createProject").mockImplementation(()=>pending.promise);
  fireEvent.change(screen.getByLabelText("Project name"),{target:{value:"Delayed"}});
  fireEvent.submit(screen.getByRole("button",{name:"Create project"}).closest("form")!);
  unmount(); history.replaceState(null,"","/demo");
  await act(async()=>pending.resolve(crypto.randomUUID()));
  expect(location.pathname).toBe("/demo");
});
