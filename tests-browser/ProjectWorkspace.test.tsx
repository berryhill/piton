import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { within } from "@testing-library/react";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal=function () { this.setAttribute("open", ""); this.querySelector<HTMLInputElement>("input")?.focus(); };
  HTMLDialogElement.prototype.close=function () { this.removeAttribute("open"); };
});
it("opens a named modal and cancels without creating, with a fresh draft on reopen", async () => {
  const {app}=await fixture(false);
  const before=await app.read();
  const opener=screen.getByRole("button",{name:"Create project"});
  expect(screen.queryByRole("textbox",{name:"Project name"})).not.toBeInTheDocument();
  fireEvent.click(opener);
  const dialog=screen.getByRole("dialog",{name:"Create project"});
  expect(within(dialog).getByLabelText("Project name")).toHaveFocus();
  fireEvent.change(within(dialog).getByLabelText("Project name"),{target:{value:"Discard me"}});
  fireEvent.click(within(dialog).getByRole("button",{name:"Cancel"}));
  expect(opener).toHaveFocus();
  expect(await app.read()).toEqual(before);
  fireEvent.click(opener);
  expect(screen.getByLabelText("Project name")).toHaveValue("");
});
import ProjectWorkspace from "../src/ProjectWorkspace";
import { WorkspaceApplication, type WorkspaceStore } from "../src/workspace";
import { DEFAULT_PARAMETERS } from "../src/domain";
import { CadApplication } from "../src/application";
import { MemoryProjectRepository } from "../src/storage/repository";

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
  const legacy=new CadApplication(new MemoryProjectRepository());await legacy.open();
  const projectId=await app.importCustody(await legacy.exportPortableCustody());
  const documentId=(await app.read()).projects[0].documents[0].id;
  await app.renameProject(projectId,"Mounts");await app.renamePart(projectId,documentId,"Bracket");
  history.replaceState(null,"",editor?`/projects/${projectId}/documents/${documentId}`:"/projects");
  const view=render(<ProjectWorkspace application={app}/>);
  await screen.findByText(editor?"Parameters (mm)":/Recent projects/);
  return {app,projectId,documentId,...view};
}
async function revise(app:WorkspaceApplication,projectId:string,documentId:string,length:number) {
  const d=(await app.read()).projects.find(p=>p.id===projectId)!.documents.find(d=>d.id===documentId)!;
  const p={projectId,documentId,expectedRevisionId:Object.keys(d.revisionIds).find(id=>d.revisionIds[id]===d.part.currentRevisionId)!,idempotencyKey:crypto.randomUUID(),parameters:{...DEFAULT_PARAMETERS,leg_length_mm:length}};
  await app.propose(p); await app.commit(p);
}
it("keeps creation errors in the modal across refreshes and clears them on reopen",async()=>{
  const {app}=await fixture(false);
  vi.spyOn(app,"createProject").mockRejectedValueOnce(new Error("Storage unavailable"));
  const opener=screen.getByRole("button",{name:"Create project"});
  fireEvent.click(opener);
  fireEvent.change(screen.getByLabelText("Project name"),{target:{value:"Retry me"}});
  fireEvent.submit(within(screen.getByRole("dialog")).getByRole("button",{name:"Create project"}).closest("form")!);
  expect(await screen.findByRole("alert")).toHaveTextContent("Storage unavailable");
  await act(async()=>{await app.createProject("External project");});
  expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent("Storage unavailable");
  expect(screen.getByLabelText("Project name")).toHaveValue("Retry me");
  fireEvent(screen.getByRole("dialog"),new Event("cancel",{bubbles:false,cancelable:true}));
  expect(opener).toHaveFocus();
  fireEvent.click(opener);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Project name")).toHaveValue("");
});
it("shows API-created projects in the mounted registry", async()=>{
  const {app}=await fixture(false);
  await act(async()=>{await app.createProject("Automation project");});
  expect(await screen.findByRole("link",{name:"Automation project"})).toBeVisible();
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
  expect(await screen.findByRole("link",{name:"Newest state"})).toBeVisible();
  await act(async()=>pending.resolve(old));
  expect(screen.getByRole("link",{name:"Newest state"})).toBeVisible();
});
it("admits one GUI create and never navigates late after leaving its page",async()=>{
  const {app,projectId}=await fixture(false); const pending=deferred<string>();
  const create=vi.spyOn(app,"createProject").mockImplementation(()=>pending.promise);
  fireEvent.click(screen.getByRole("button",{name:"Create project"}));
  fireEvent.change(screen.getByLabelText("Project name"),{target:{value:"Delayed"}});
  const form=within(screen.getByRole("dialog")).getByRole("button",{name:"Create project"}).closest("form")!;
  fireEvent.submit(form); fireEvent.submit(form);
  expect(create).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button",{name:"Cancel"}));
  fireEvent.click(screen.getByRole("link",{name:"Mounts"}));
  await act(async()=>pending.resolve(crypto.randomUUID()));
  expect(location.pathname).toBe(`/projects/${projectId}`);
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
  fireEvent.click(screen.getByRole("button",{name:"Create project"}));
  fireEvent.change(screen.getByLabelText("Project name"),{target:{value:"Delayed"}});
  fireEvent.submit(within(screen.getByRole("dialog")).getByRole("button",{name:"Create project"}).closest("form")!);
  unmount(); history.replaceState(null,"","/demo");
  await act(async()=>pending.resolve(crypto.randomUUID()));
  expect(location.pathname).toBe("/demo");
});

it("creates an empty project directly into the R7 workbench without seeding documents",async()=>{
  const app=new WorkspaceApplication(new Store());
  const createPart=vi.spyOn(app,"createPart");
  history.replaceState(null,"","/projects");
  const view=render(<ProjectWorkspace application={app}/>);
  await screen.findByRole("button",{name:"Create project"});
  fireEvent.click(screen.getByRole("button",{name:"Create project"}));
  fireEvent.change(screen.getByLabelText("Project name"),{target:{value:"Empty design"}});
  fireEvent.submit(within(screen.getByRole("dialog")).getByRole("button",{name:"Create project"}).closest("form")!);
  expect(await screen.findByTestId("empty-project-viewport")).toBeVisible();
  expect(screen.getByRole("heading",{name:"Documents"})).toBeVisible();
  expect(screen.getByRole("heading",{name:"Change Request"})).toBeVisible();
  expect(screen.getByRole("button",{name:"Send"})).toBeDisabled();
  expect(screen.getByRole("button",{name:"Generate STL"})).toBeDisabled();
  expect(screen.getByRole("button",{name:"New Assembly"})).toBeDisabled();
  expect(screen.queryByRole("button",{name:"Finish review mesh"})).not.toBeInTheDocument();
  const projects=(await app.read()).projects;
  expect(projects).toHaveLength(1);expect(projects[0].documents).toEqual([]);
  expect(location.pathname).toBe(`/projects/${projects[0].id}`);
  expect(createPart).not.toHaveBeenCalled();
  view.unmount();render(<ProjectWorkspace application={app}/>);
  await screen.findByTestId("empty-project-viewport");
  expect((await app.read()).projects[0].documents).toEqual([]);
  fireEvent.click(screen.getByRole("button",{name:"All projects"}));
  const link=await screen.findByRole("link",{name:"Empty design"});
  expect(link).toHaveAttribute("href",`/projects/${projects[0].id}`);
  fireEvent.click(link);
  await screen.findByTestId("empty-project-viewport");
  expect(createPart).not.toHaveBeenCalled();
});
it("opens existing user Parts from the workbench and retains their revisions",async()=>{
  const {app,projectId,documentId}=await fixture(false);
  const before=await app.read();
  fireEvent.click(screen.getByRole("link",{name:"Mounts"}));
  await screen.findByRole("heading",{name:"Documents"});
  fireEvent.click(screen.getByRole("button",{name:"Bracket"}));
  await screen.findByText("Parameters (mm)");
  expect(location.pathname).toBe(`/projects/${projectId}/documents/${documentId}`);
  expect(await app.read()).toEqual(before);
  fireEvent.click(screen.getByRole("button",{name:"Project overview"}));
  await screen.findByTestId("empty-project-viewport");
  expect(screen.getByRole("button",{name:"Bracket"})).toBeVisible();
});
it("creates a Part only after the explicit Create Part action",async()=>{
  const app=new WorkspaceApplication(new Store());const id=await app.createProject("Explicit authoring");
  history.replaceState(null,"",`/projects/${id}`);render(<ProjectWorkspace application={app}/>);
  await screen.findByTestId("empty-project-viewport");
  expect((await app.read()).projects[0].documents).toEqual([]);
  fireEvent.change(screen.getByLabelText("Part name"),{target:{value:"My bracket"}});
  fireEvent.submit(screen.getByRole("button",{name:"Create Part"}).closest("form")!);
  await screen.findByText("Empty Part");
  const document=(await app.read()).projects[0].documents[0];
  expect((await app.read()).projects[0].documents).toHaveLength(1);
  expect(document.part.revisions).toEqual([]);
  expect(document.part.currentRevisionId).toBeNull();
  expect(screen.getByRole("tab",{name:"My bracket"})).toHaveAttribute("aria-selected","true");
  expect(screen.queryByRole("button",{name:"Finish review mesh"})).not.toBeInTheDocument();
});
it("preserves parameter, structured and rename drafts across tabs and history, then explicitly discards on close",async()=>{
  const {app,projectId,documentId}=await fixture();
  const before=(await app.read()).projects[0].documents[0];
  await act(async()=>{await app.createPart(projectId,"Empty sibling");});
  fireEvent.change(screen.getByLabelText("leg_length_mm"),{target:{value:"111"}});
  fireEvent.change(screen.getByLabelText("Structured change request"),{target:{value:'{"unfinished":'}});
  fireEvent.change(screen.getByLabelText("Part name"),{target:{value:"Draft name"}});
  fireEvent.click(within(screen.getByRole("navigation",{name:"Project Files"})).getByRole("button",{name:"Empty sibling"}));
  expect(screen.getByText("Empty Part")).toBeVisible();
  expect(screen.queryByRole("button",{name:"Finish review mesh"})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("tab",{name:"Bracket"}));
  expect(screen.getByLabelText("leg_length_mm")).toHaveValue(111);
  expect(screen.getByLabelText("Structured change request")).toHaveValue('{"unfinished":');
  expect(screen.getByLabelText("Part name")).toHaveValue("Draft name");
  fireEvent.click(screen.getByRole("button",{name:"Revision 1 · current"}));
  expect(location.pathname).toBe(`/projects/${projectId}/documents/${documentId}/revisions/${Object.keys(before.revisionIds)[0]}`);
  expect(screen.getAllByRole("tab")).toHaveLength(2);
  expect(screen.getByLabelText("leg_length_mm")).toBeDisabled();
  fireEvent.click(screen.getByRole("button",{name:"Open current revision"}));
  expect(screen.getByLabelText("leg_length_mm")).toHaveValue(111);
  const confirm=vi.spyOn(window,"confirm").mockReturnValue(false);
  fireEvent.click(screen.getByRole("button",{name:"Close Bracket"}));
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Discard unsaved changes"));
  expect(screen.getByRole("tab",{name:"Bracket"})).toHaveAttribute("aria-selected","true");
  confirm.mockReturnValue(true);fireEvent.click(screen.getByRole("button",{name:"Close Bracket"}));
  expect(screen.queryByRole("tab",{name:"Bracket"})).not.toBeInTheDocument();
  expect((await app.read()).projects[0].documents[0]).toEqual(before);
  fireEvent.click(within(screen.getByRole("navigation",{name:"Project Files"})).getByRole("button",{name:"Bracket"}));
  expect(screen.getByLabelText("leg_length_mm")).toHaveValue(DEFAULT_PARAMETERS.leg_length_mm);
  expect(screen.getByLabelText("Structured change request")).toHaveValue("");
});


it("keeps pending Part operations scoped when switching and blocks closing until they settle",async()=>{
  const {app,projectId}=await fixture();await act(async()=>{await app.createPart(projectId,"Sibling");});
  const original=app.propose.bind(app),gate=deferred<void>();
  vi.spyOn(app,"propose").mockImplementationOnce(async input=>{const result=await original(input);await gate.promise;return result;});
  fireEvent.change(screen.getByLabelText("leg_length_mm"),{target:{value:"113"}});
  fireEvent.click(screen.getByRole("button",{name:"Propose and preview"}));
  fireEvent.click(screen.getByRole("button",{name:"Close Bracket"}));
  expect(screen.getByRole("alert")).toHaveTextContent("Wait for this Part");
  fireEvent.click(within(screen.getByRole("navigation",{name:"Project Files"})).getByRole("button",{name:"Sibling"}));
  await act(async()=>gate.resolve());
  expect(screen.getByText("Empty Part")).toBeVisible();expect(screen.queryByText("Preview only · not committed")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("tab",{name:"Bracket"}));
  expect(screen.getByText("Preview only · not committed")).toBeVisible();
  expect(screen.getByLabelText("leg_length_mm")).toHaveValue(113);
});
