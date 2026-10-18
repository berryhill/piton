import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import Module, { type ManifoldToplevel } from "manifold-3d";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import ProjectWorkspace from "../src/ProjectWorkspace";
import { WorkspaceApplication, type WorkspaceStore, isFeaturePart } from "../src/workspace";
import { evaluateFeatureSource } from "../src/modeling/evaluator";
import { readFeatures } from "../src/modeling/source";

vi.mock("../src/components/Viewport", () => ({ default: () => null }));
let kernel: ManifoldToplevel;
beforeAll(async () => { kernel = await Module(); kernel.setup(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
class Store implements WorkspaceStore {
  row: { version: number; json: string } | null = null;
  async readWorkspace() { return structuredClone(this.row); }
  async writeWorkspace(version: number, json: string) {
    if (version !== (this.row?.version ?? 0)) throw new Error("stale");
    this.row = { version: version + 1, json };
  }
}
async function setup() {
  const store = new Store();
  const app = new WorkspaceApplication(store, async source => evaluateFeatureSource(source, kernel));
  const projectId = await app.createProject("Mirror trim controls");
  const documentId = await app.createPart(projectId, "Profile");
  history.replaceState(null, "", `/projects/${projectId}/documents/${documentId}`);
  render(<ProjectWorkspace application={app}/>);
  await screen.findByRole("tablist", { name: "Part command categories" });
  const bar = screen.getByRole("region", { name: "Part commands" });
  fireEvent.change(within(bar).getByRole("combobox", { name: "Sketch plane" }), { target: { value: "XY" } });
  fireEvent.click(within(bar).getByRole("button", { name: "New Sketch" }));
  return { app, bar };
}
function form(name: string) { return screen.getByRole("form", { name: `${name} parameters` }); }
function point(bar: HTMLElement, x: number, y: number) {
  fireEvent.click(within(bar).getByRole("button", { name: "Line" }));
  fireEvent.change(within(form("Line")).getByLabelText("x"), { target: { value: String(x) } });
  fireEvent.change(within(form("Line")).getByLabelText("y"), { target: { value: String(y) } });
  fireEvent.click(within(form("Line")).getByRole("button", { name: "Apply to sketch" }));
}
function outline() { return screen.getByRole("img", { name: "Sketch-only 2D preview" }); }

it("trims a numeric half-chain, mirrors across local V and commits its actual extruded mesh", async () => {
  const { app, bar } = await setup();
  const initial = await app.read();
  for (const [x,y] of [[0,0],[20,0],[20,10],[10,20],[0,20],[0,30]]) point(bar,x,y);
  expect(outline().querySelector("polyline")).toHaveAttribute("points", "0,0 20,0 20,10 10,20 0,20 0,30");
  fireEvent.click(within(bar).getByRole("button", { name: "Trim" }));
  fireEvent.change(within(form("Trim")).getByLabelText("Edge index"), { target: { value: "4" } });
  fireEvent.change(within(form("Trim")).getByLabelText("Keep side"), { target: { value: "start" } });
  expect(outline().querySelector('[data-sketch-selected-edge="4"]')).toBeInTheDocument();
  fireEvent.click(within(form("Trim")).getByRole("button", { name: "Apply to sketch" }));
  expect(outline().querySelector("polyline")).toHaveAttribute("points", "0,0 20,0 20,10 10,20 0,20");
  fireEvent.click(within(bar).getByRole("button", { name: "Mirror" }));
  expect(outline().querySelector('[data-sketch-selected-axis="V"]')).toBeInTheDocument();
  fireEvent.click(within(form("Mirror")).getByRole("button", { name: "Apply to sketch" }));
  expect(outline().querySelector("polygon")).toHaveAttribute("points", "0,0 20,0 20,10 10,20 0,20 -10,20 -20,10 -20,0");
  expect(await app.read()).toEqual(initial);
  fireEvent.click(within(bar).getByRole("button", { name: "Finish Sketch" }));
  fireEvent.click(within(bar).getByRole("tab", { name: "Features" }));
  fireEvent.click(within(bar).getByRole("button", { name: "Extrude" }));
  fireEvent.change(within(form("Extrude")).getByLabelText("distance"), { target: { value: "6" } });
  fireEvent.click(within(form("Extrude")).getByRole("button", { name: "Add feature" }));
  expect(await app.read()).toEqual(initial);
  fireEvent.click(within(bar).getByRole("button", { name: "Preview features" }));
  expect(await screen.findByTestId("feature-preview")).toHaveTextContent("Preview only");
  fireEvent.click(within(bar).getByRole("button", { name: "Commit feature revision" }));
  await waitFor(async () => expect(isFeaturePart((await app.read()).projects[0].documents[0].part)).toBe(true));
  const part = (await app.read()).projects[0].documents[0].part;
  if (!isFeaturePart(part)) throw new Error("missing saved Part");
  const saved = part.revisions[0];
  expect(saved).toMatchObject({ reviewState: "needs_human_review", fabricationRelease: false, machineActuation: false });
  expect(readFeatures(saved.authored).map(f => f.kind)).toEqual(["polygon", "extrude"]);
  const geometry = evaluateFeatureSource(saved.authored, kernel);
  expect(geometry.bounds).toEqual({ min: [-20,0,0], max: [20,20,6] });
  expect(geometry.volumeMm3).toBeCloseTo(4200, 2);
});

it("keeps last valid draft on cancel, invalid axis endpoints and unsupported closed trim", async () => {
  const { app, bar } = await setup();
  for (const [x,y] of [[1,0],[20,0],[20,10],[0,20]]) point(bar,x,y);
  const unchanged = outline().querySelector("polyline")?.getAttribute("points");
  fireEvent.click(within(bar).getByRole("button", { name: "Mirror" }));
  expect(within(form("Mirror")).getByLabelText("Mirror axis")).toHaveValue("V");
  fireEvent.click(within(form("Mirror")).getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("form", { name: "Mirror parameters" })).not.toBeInTheDocument();
  expect(outline().querySelector("polyline")).toHaveAttribute("points", unchanged);
  fireEvent.click(within(bar).getByRole("button", { name: "Mirror" }));
  fireEvent.click(within(form("Mirror")).getByRole("button", { name: "Apply to sketch" }));
  expect(within(bar).getByRole("alert")).toHaveTextContent(/endpoints.*axis/i);
  expect(outline().querySelector("polyline")).toHaveAttribute("points", unchanged);
  fireEvent.click(within(bar).getByRole("button", { name: "Close Line" }));
  fireEvent.click(within(bar).getByRole("button", { name: "Trim" }));
  expect(form("Trim")).toHaveTextContent(/closed contour trim.*unsupported/i);
  fireEvent.click(within(form("Trim")).getByRole("button", { name: "Apply to sketch" }));
  expect(within(bar).getByRole("alert")).toHaveTextContent(/open Line chain/i);
  expect(outline().querySelector("polygon")).toBeInTheDocument();
  expect((await app.read()).projects[0].documents[0].part.currentRevisionId).toBeNull();
});
