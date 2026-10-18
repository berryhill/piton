import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import Module, { type ManifoldToplevel } from "manifold-3d";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import ProjectWorkspace from "../src/ProjectWorkspace";
import { WorkspaceApplication, type WorkspaceStore, isFeaturePart } from "../src/workspace";
import { evaluateFeatureSource } from "../src/modeling/evaluator";
import { readFeatures, type ProfileFeature } from "../src/modeling/source";

vi.mock("../src/components/Viewport", () => ({ default: () => null }));
vi.mock("../src/modeling/client",async importOriginal=>{
  const actual=await importOriginal<typeof import("../src/modeling/client")>();
  return {...actual,evaluateFeatureSourceInWorker:async (source:Parameters<typeof evaluateFeatureSource>[0])=>evaluateFeatureSource(source,kernel)};
});
let kernel: ManifoldToplevel;
beforeAll(async () => { kernel = await Module(); kernel.setup(); });
afterEach(() => cleanup());
class Store implements WorkspaceStore {
  row: { version: number; json: string } | null = null;
  async readWorkspace() { return structuredClone(this.row); }
  async writeWorkspace(version: number, json: string) { if (version !== (this.row?.version ?? 0)) throw new Error("stale"); this.row = { version: version + 1, json }; }
}
async function setup() {
  const app = new WorkspaceApplication(new Store(), async source => evaluateFeatureSource(source, kernel));
  const projectId = await app.createProject("Two sketches"), documentId = await app.createPart(projectId, "Plate");
  history.replaceState(null, "", `/projects/${projectId}/documents/${documentId}`);
  render(<ProjectWorkspace application={app} />);
  await screen.findByRole("region", { name: "Part commands" });
  return { app, documentId };
}
const bar = () => screen.getByRole("region", { name: "Part commands" });
const properties = () => screen.getByRole("complementary", { name: "Change request" });
const source = () => (screen.getByTestId("feature-source-input") as HTMLTextAreaElement).value;
const features = () => readFeatures({ authorityProfile: "browser-typescript/v1", units: "mm", source: source() });
function sketch(shape: "Rectangle" | "Circle", plane = "XY", support?: string, offset?: number) {
  fireEvent.click(within(bar()).getByRole("tab", { name: "Sketch" }));
  fireEvent.change(within(bar()).getByRole("combobox", { name: "Sketch plane" }), { target: { value: plane } });
  if (support) fireEvent.change(within(bar()).getByRole("combobox", { name: "Sketch support" }), { target: { value: support } });
  if (offset !== undefined) fireEvent.change(within(bar()).getByRole("spinbutton", { name: "Sketch offset" }), { target: { value: String(offset) } });
  fireEvent.click(within(bar()).getByRole("button", { name: "New Sketch" }));
  fireEvent.click(within(bar()).getByRole("button", { name: shape }));
  fireEvent.click(within(properties()).getByRole("button", { name: "Apply to sketch" }));
  fireEvent.click(within(bar()).getByRole("button", { name: "Finish Sketch" }));
}
function extrude(tool: "Extrude" | "Cut Extrude", distance: number, direction = "forward", endCondition = "blind") {
  fireEvent.click(within(bar()).getByRole("tab", { name: "Features" }));
  fireEvent.click(within(bar()).getByRole("button", { name: new RegExp(`^${tool}$`) }));
  fireEvent.change(within(properties()).getByLabelText("distance"), { target: { value: String(distance) } });
  fireEvent.change(within(properties()).getByLabelText("Direction"), { target: { value: direction } });
  if (tool === "Cut Extrude") fireEvent.change(within(properties()).getByLabelText("End condition"), { target: { value: endCondition } });
  fireEvent.click(within(properties()).getByRole("button", { name: "Add feature" }));
}
async function previewCommit(app: WorkspaceApplication) {
  const before = await app.read();
  fireEvent.click(within(bar()).getByRole("button", { name: "Preview features" }));
  await screen.findByTestId("feature-preview");
  expect(await app.read()).toEqual(before);
  fireEvent.click(within(bar()).getByRole("button", { name: "Commit feature revision" }));
  await waitFor(async () => expect((await app.read()).projects[0].documents[0].part.currentRevisionId).not.toBeNull());
}
it.each(["boss", "pocket"] as const)("commits separate base and %s revisions with unique profile IDs and preceding body target", async kind => {
  const { app } = await setup();
  sketch("Rectangle"); extrude("Extrude", 6); await previewCommit(app);
  const baseline = await app.read();
  fireEvent.click(within(bar()).getByRole("tab",{name:"Sketch"}));
  await waitFor(() => expect(within(bar()).getByRole("combobox", {name:"Sketch support"}).querySelector('option[value="extrude1:end"]')).not.toBeNull());
  sketch(kind === "boss" ? "Rectangle" : "Circle", "XY", "extrude1:end");
  expect(await app.read()).toEqual(baseline);
  extrude(kind === "boss" ? "Extrude" : "Cut Extrude", kind === "boss" ? 4 : 3, kind === "boss" ? "forward" : "reverse");
  const f = features();
  expect(f.map(x => x.id)).toEqual(["sketchProfile1", "extrude1", "sketchProfile2", "extrude2"]);
  expect(f[2]).toMatchObject({ support: { kind: "extrusionCap", featureId: "extrude1", side: "end" } });
  expect(f[3]).toMatchObject({ profileId: "sketchProfile2", targetBodyId: "extrude1", operation: kind === "boss" ? "add" : "cut", distance: kind === "boss" ? 4 : 3 });
  await previewCommit(app);
  const part = (await app.read()).projects[0].documents[0].part;
  if (!isFeaturePart(part)) throw new Error("missing feature part");
  expect(readFeatures(part.revisions.at(-1)!.authored)).toEqual(f);
  expect(part.revisions.at(-1)).toMatchObject({ reviewState: "needs_human_review", fabricationRelease: false, machineActuation: false });
});
it("preserves dirty source across a finished sketch handoff, and feature Cancel does not alter it", async () => {
  await setup(); sketch("Rectangle"); extrude("Extrude", 6);
  const dirty = source();
  sketch("Circle", "XY", "extrude1:end", 0);
  fireEvent.click(within(bar()).getByRole("tab", { name: "Features" }));
  fireEvent.click(within(bar()).getByRole("button", { name: "Cut Extrude" }));
  fireEvent.click(within(properties()).getByRole("button", { name: "Cancel" }));
  expect(source()).toBe(dirty);
  fireEvent.click(within(bar()).getByRole("button", { name: "Cut Extrude" }));
  fireEvent.click(within(properties()).getByRole("button", { name: "Add feature" }));
  expect(features()).toHaveLength(4);
});
it("invalidates an older solid proposal when a new sketch starts, without committing hidden intent", async () => {
  const {app}=await setup();sketch("Rectangle");extrude("Extrude",6);
  fireEvent.click(within(bar()).getByRole("button",{name:"Preview features"}));await screen.findByTestId("feature-preview");
  expect(within(bar()).getByRole("button",{name:"Commit feature revision"})).toBeEnabled();
  const before=await app.read();
  fireEvent.click(within(bar()).getByRole("tab",{name:"Sketch"}));
  fireEvent.click(within(bar()).getByRole("button",{name:"New Sketch"}));
  expect(within(bar()).getByRole("button",{name:"Commit feature revision"})).toBeDisabled();
  await waitFor(()=>expect(screen.queryByTestId("feature-preview")).toBeNull());
  expect(await app.read()).toEqual(before);
  fireEvent.click(within(bar()).getByRole("button",{name:"Cancel Sketch"}));
  expect(within(bar()).getByRole("button",{name:"Commit feature revision"})).toBeDisabled();
});
it("exposes real origin and driving dimensions in sketch properties", async () => {
  await setup();
  fireEvent.change(within(bar()).getByRole("combobox", { name: "Sketch plane" }), { target: { value: "XY" } });
  fireEvent.click(within(bar()).getByRole("button", { name: "New Sketch" }));
  fireEvent.click(within(bar()).getByRole("button", { name: "Rectangle" }));
  fireEvent.click(within(properties()).getByRole("button", { name: "Apply to sketch" }));
  expect(within(properties()).getByLabelText("Driving width")).toBeInTheDocument();
  fireEvent.click(within(properties()).getByRole("button", { name: "Constrain origin" }));
  fireEvent.click(within(properties()).getByRole("button", { name: "Drive width" }));
  fireEvent.click(within(bar()).getByRole("button", { name: "Finish Sketch" }));
  extrude("Extrude", 6);
  expect((features()[0] as ProfileFeature).sketchIntent?.constraints.map(c => c.kind)).toEqual(["origin", "dimension"]);
});
