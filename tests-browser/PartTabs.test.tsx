import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ProjectWorkspace from "../src/ProjectWorkspace";
import { WorkspaceApplication, type WorkspaceStore } from "../src/workspace";
vi.mock("../src/components/Viewport",()=>({default:()=> <div data-testid="authored-viewport"/>}));
afterEach(()=>{cleanup();vi.restoreAllMocks();});
class Store implements WorkspaceStore {
  row:{version:number;json:string}|null=null;
  async readWorkspace(){return structuredClone(this.row);}
  async writeWorkspace(version:number,json:string){this.row={version:version+1,json};}
}
async function setup(){
  const app=new WorkspaceApplication(new Store());const id=await app.createProject("Tabbed project");
  const a=await app.createPart(id,"Alpha"),b=await app.createPart(id,"Beta");
  history.replaceState(null,"",`/projects/${id}`);render(<ProjectWorkspace application={app}/>);
  await screen.findByRole("heading",{name:"Documents"});return {app,id,a,b};
}
function open(name:string){fireEvent.click(within(screen.getByRole("navigation",{name:"Project Files"})).getByRole("button",{name}));}
it("opens deduplicated empty Part tabs in the shell, closes without deleting and never auto-opens a fixture",async()=>{
  const {app}=await setup();const before=await app.read();
  open("Alpha");expect(await screen.findByRole("tab",{name:"Alpha"})).toHaveAttribute("aria-selected","true");
  expect(screen.getByText("Empty Part")).toBeVisible();expect(screen.queryByTestId("authored-viewport")).not.toBeInTheDocument();
  open("Beta");open("Alpha");expect(screen.getAllByRole("tab")).toHaveLength(2);
  fireEvent.click(screen.getByRole("button",{name:"Close Alpha"}));
  expect(screen.getByRole("tab",{name:"Beta"})).toHaveAttribute("aria-selected","true");
  fireEvent.click(screen.getByRole("button",{name:"Close Beta"}));
  expect(screen.queryByRole("tab")).not.toBeInTheDocument();expect(screen.getAllByText("No open document").length).toBeGreaterThan(0);
  expect(await app.read()).toEqual(before);open("Alpha");expect(screen.getAllByRole("tab")).toHaveLength(1);
});
it("supports roving tab keyboard navigation and route-driven activation",async()=>{
  const {id,a,b}=await setup();open("Alpha");open("Beta");
  fireEvent.keyDown(screen.getByRole("tab",{name:"Beta"}),{key:"Home"});
  expect(screen.getByRole("tab",{name:"Alpha"})).toHaveFocus();
  fireEvent.keyDown(screen.getByRole("tab",{name:"Alpha"}),{key:"ArrowLeft"});expect(screen.getByRole("tab",{name:"Beta"})).toHaveFocus();
  fireEvent.keyDown(screen.getByRole("tab",{name:"Beta"}),{key:"ArrowRight"});expect(screen.getByRole("tab",{name:"Alpha"})).toHaveFocus();
  fireEvent.keyDown(screen.getByRole("tab",{name:"Alpha"}),{key:"End"});expect(screen.getByRole("tab",{name:"Beta"})).toHaveFocus();
  fireEvent.keyDown(screen.getByRole("tab",{name:"Beta"}),{key:"Delete"});expect(screen.queryByRole("tab",{name:"Beta"})).not.toBeInTheDocument();
  await act(async()=>{history.pushState(null,"",`/projects/${id}/documents/${b}`);window.dispatchEvent(new PopStateEvent("popstate"));});
  expect(await screen.findByRole("tab",{name:"Beta"})).toHaveAttribute("aria-selected","true");
  await act(async()=>{history.replaceState(null,"",`/projects/${id}/documents/${a}`);window.dispatchEvent(new PopStateEvent("popstate"));});
  expect(screen.getByRole("tab",{name:"Alpha"})).toHaveAttribute("aria-selected","true");
  const panel=screen.getByRole("tabpanel");expect(panel).toHaveAttribute("aria-labelledby",screen.getByRole("tab",{name:"Alpha"}).id);
});

it("reopens the routed empty document after remount without creating geometry or revisions",async()=>{
  const {app,id,a}=await setup();open("Alpha");
  cleanup();render(<ProjectWorkspace application={app}/>);
  expect(await screen.findByRole("tab",{name:"Alpha"})).toHaveAttribute("aria-selected","true");
  expect(screen.getAllByRole("tab")).toHaveLength(1);expect(screen.getByText("Empty Part")).toBeVisible();
  expect(location.pathname).toBe(`/projects/${id}/documents/${a}`);
  expect(screen.queryByTestId("authored-viewport")).not.toBeInTheDocument();
  expect((await app.read()).projects[0].documents[0].part.revisions).toEqual([]);
});
