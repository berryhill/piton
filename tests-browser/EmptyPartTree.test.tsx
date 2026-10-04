import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ProjectWorkspace from "../src/ProjectWorkspace";
import { WorkspaceApplication, type WorkspaceStore } from "../src/workspace";
vi.mock("../src/components/Viewport",()=>({default:()=> <div/>}));
afterEach(()=>cleanup());
class Store implements WorkspaceStore {
  row:{version:number;json:string}|null=null;
  async readWorkspace(){return structuredClone(this.row);}
  async writeWorkspace(version:number,json:string){this.row={version:version+1,json};}
}
async function setup(){
  const app=new WorkspaceApplication(new Store());const id=await app.createProject("Tree project");
  const a=await app.createPart(id,"Alpha");await app.createPart(id,"Beta");
  history.replaceState(null,"",`/projects/${id}/documents/${a}`);render(<ProjectWorkspace application={app}/>);
  await screen.findByRole("tab",{name:"Alpha"});return app;
}
const item=(name:string)=>within(screen.getByRole("tree")).getByRole("treeitem",{name});
it("shows Files, Outputs, then a truthful document tree",async()=>{
  const app=await setup(),before=await app.read();
  const tree=screen.getByRole("tree",{name:"Alpha model tree"});
  expect(item("Alpha · Part")).toHaveAttribute("aria-expanded","true");
  expect(item("Features (0)")).toBeVisible();expect(item("Solid Bodies (0)")).toBeVisible();
  const files=screen.getByRole("navigation",{name:"Project Files"}),outputs=screen.getByRole("region",{name:"Active document outputs"});
  expect(files.compareDocumentPosition(outputs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(outputs.compareDocumentPosition(tree) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByText("Project settings & recovery").closest("details")).not.toHaveAttribute("open");
  expect(screen.getByRole("button",{name:"New Sketch"})).toBeDisabled();
  fireEvent.click(item("Features (0)"));expect(screen.getByRole("region",{name:"Model selection details"})).toHaveTextContent("No authored features");
  expect(await app.read()).toEqual(before);
});
it("supports roving keyboard focus, expansion and explicit selection without inventing geometry",async()=>{
  await setup();const root=item("Alpha · Part");root.focus();
  fireEvent.keyDown(root,{key:"ArrowDown"});expect(item("Origin · reference")).toHaveFocus();
  fireEvent.keyDown(item("Origin · reference"),{key:"ArrowRight"});
  expect(item("Front Plane · reference")).toBeVisible();
  fireEvent.keyDown(item("Origin · reference"),{key:"ArrowRight"});expect(item("Front Plane · reference")).toHaveFocus();
  fireEvent.keyDown(item("Front Plane · reference"),{key:" "});expect(item("Front Plane · reference")).toHaveAttribute("aria-selected","true");
  expect(screen.getByRole("region",{name:"Model selection details"})).toHaveTextContent("not an authored feature");
  fireEvent.keyDown(item("Front Plane · reference"),{key:"ArrowLeft"});expect(item("Origin · reference")).toHaveFocus();
  fireEvent.keyDown(item("Origin · reference"),{key:"ArrowLeft"});expect(screen.queryByRole("treeitem",{name:"Front Plane · reference"})).not.toBeInTheDocument();
  fireEvent.keyDown(item("Origin · reference"),{key:"End"});expect(item("Solid Bodies (0)")).toHaveFocus();
  fireEvent.keyDown(item("Solid Bodies (0)"),{key:"Home"});expect(root).toHaveFocus();
  fireEvent.keyDown(root,{key:"ArrowLeft"});expect(screen.getAllByRole("treeitem")).toHaveLength(1);
  fireEvent.keyDown(root,{key:"ArrowRight"});expect(item("Features (0)")).toBeVisible();
});
it("keeps selection and expansion local to each open Part and clears on close",async()=>{
  await setup();fireEvent.click(item("Features (0)"));fireEvent.keyDown(item("Origin · reference"),{key:"ArrowRight"});
  const files=within(screen.getByRole("navigation",{name:"Project Files"}));
  fireEvent.click(files.getByRole("button",{name:"Beta"}));
  expect(item("Beta · Part")).toHaveAttribute("aria-selected","true");expect(item("Origin · reference")).toHaveAttribute("aria-expanded","false");
  fireEvent.click(item("Solid Bodies (0)"));
  fireEvent.click(screen.getByRole("tab",{name:"Alpha"}));expect(item("Features (0)")).toHaveAttribute("aria-selected","true");expect(item("Origin · reference")).toHaveAttribute("aria-expanded","true");
  expect(screen.getByRole("region",{name:"Model selection details"})).toHaveTextContent("Features (0)");
  fireEvent.click(screen.getByRole("button",{name:"Close Alpha"}));fireEvent.click(files.getByRole("button",{name:"Alpha"}));
  expect(item("Alpha · Part")).toHaveAttribute("aria-selected","true");
});
