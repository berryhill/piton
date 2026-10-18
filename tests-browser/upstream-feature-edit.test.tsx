import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import Module, { type ManifoldToplevel } from "manifold-3d";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import ProjectWorkspace from "../src/ProjectWorkspace";
import { WorkspaceApplication, type WorkspaceStore, isFeaturePart } from "../src/workspace";
import { evaluateFeatureSource } from "../src/modeling/evaluator";
import { readFeatures, type PartFeature } from "../src/modeling/source";

vi.mock("../src/components/Viewport", () => ({ default: () => null }));
vi.mock("../src/modeling/client", async original => ({ ...await original<typeof import("../src/modeling/client")>(), evaluateFeatureSourceInWorker: async (source: Parameters<typeof evaluateFeatureSource>[0]) => evaluateFeatureSource(source, kernel) }));
vi.mock("../src/modeling/FeatureMeshViewport", () => ({ default: () => <section data-testid="mesh" /> }));
let kernel: ManifoldToplevel;
beforeAll(async () => { kernel = await Module(); kernel.setup(); });
afterEach(() => cleanup());
class Store implements WorkspaceStore {
  row: { version: number; json: string } | null = null;
  async readWorkspace() { return structuredClone(this.row); }
  async writeWorkspace(version: number, json: string) { if (version !== (this.row?.version ?? 0)) throw new Error("stale"); this.row = { version: version + 1, json }; }
}
const original: PartFeature[] = [
  { kind: "rectangle", id: "baseSketch", name: "Base profile", plane: "XY", width: 30, height: 20 },
  { kind: "extrude", id: "baseBody", name: "Base extrusion", profileId: "baseSketch", distance: 4 },
  { kind: "rectangle", id: "capSketch", name: "Cap profile", plane: "XY", width: 10, height: 10, support: { kind: "extrusionCap", featureId: "baseBody", side: "end" } },
  { kind: "extrude", id: "capBody", name: "Cap boss", profileId: "capSketch", targetBodyId: "baseBody", operation: "add", distance: 3 },
];
async function setup() {
  const app = new WorkspaceApplication(new Store(), async source => evaluateFeatureSource(source, kernel));
  const projectId = await app.createProject("Upstream edit"), documentId = await app.createPart(projectId, "Plate");
  const first = await app.proposeFeatures({ projectId, documentId, expectedRevisionId: null, features: original, units: "mm", idempotencyKey: crypto.randomUUID() });
  const pointer = await app.commitFeatures(first.proposal);
  history.replaceState(null, "", `/projects/${projectId}/documents/${documentId}`);
  render(<ProjectWorkspace application={app} />);
  const tree = await screen.findByRole("tree", { name: "Plate model tree" });
  fireEvent.keyDown(within(tree).getByRole("treeitem", { name: "Features (4)" }), { key: "ArrowRight" });
  return { app, pointer, first, tree };
}
const bar = () => screen.getByRole("region", { name: "Part commands" });
const properties = () => screen.getByRole("complementary", { name: "Change request" });
function select(tree: HTMLElement, name: string) { fireEvent.click(within(tree).getByRole("treeitem", { name: new RegExp(name) })); }
function source() { return (screen.getByTestId("feature-source-input") as HTMLTextAreaElement).value; }

it("edits an upstream committed sketch by identity and rebuilds the downstream boss through preview then commit", async () => {
  const { app, first, tree } = await setup();
  select(tree, "Base profile");
  fireEvent.click(within(properties()).getByRole("button", { name: "Edit Sketch" }));
  fireEvent.click(within(bar()).getByRole("button", { name: "Dimension" }));
  fireEvent.change(within(properties()).getByLabelText("width"), { target: { value: "40" } });
  fireEvent.click(within(properties()).getByRole("button", { name: "Apply to sketch" }));
  fireEvent.click(within(bar()).getByRole("button", { name: "Finish Sketch" }));
  expect(readFeatures({ ...first.candidate.authored, source: source() }).map(f => f.id)).toEqual(original.map(f => f.id));
  expect(await app.read()).toMatchObject({ projects: [{ documents: [{ part: { currentRevisionId: first.candidate.id } }] }] });
  fireEvent.click(within(bar()).getByRole("button", { name: "Preview features" }));
  await screen.findByTestId("feature-preview");
  const previewText = screen.getByTestId("feature-preview").textContent!;
  expect(previewText).not.toContain(first.candidate.id);
  fireEvent.click(within(bar()).getByRole("button", { name: "Commit feature revision" }));
  await waitFor(async () => {
    const part = (await app.read()).projects[0].documents[0].part;
    expect(isFeaturePart(part) && part.revisions.length).toBe(2);
  });
  const part = (await app.read()).projects[0].documents[0].part;
  if (!isFeaturePart(part)) throw Error("feature part missing");
  expect(part.revisions[0].authored.source).toBe(first.candidate.authored.source);
  expect(readFeatures(part.revisions[1].authored).map(f => f.id)).toEqual(original.map(f => f.id));
  const rebuilt = evaluateFeatureSource(part.revisions[1].authored, kernel);
  expect(rebuilt.bounds.max[0]).toBeGreaterThan(first.geometry.bounds.max[0]);
});

it("cancels an upstream feature editor without touching source or revision and applies same-ID depth when requested", async () => {
  const { app, first, tree } = await setup();
  select(tree, "Base extrusion");
  fireEvent.click(within(properties()).getByRole("button", { name: "Edit Feature" }));
  const form = within(properties()).getByRole("form", { name: "Edit Feature parameters" });
  expect(within(form).getByLabelText("distance")).toHaveValue(4);
  fireEvent.change(within(form).getByLabelText("distance"), { target: { value: "6" } });
  fireEvent.click(within(form).getByRole("button", { name: "Cancel" }));
  expect(source()).toBe(first.candidate.authored.source);
  expect((await app.read()).projects[0].documents[0].part.currentRevisionId).toBe(first.candidate.id);
  fireEvent.click(within(properties()).getByRole("button", { name: "Edit Feature" }));
  fireEvent.change(within(properties()).getByLabelText("distance"), { target: { value: "6" } });
  fireEvent.click(within(properties()).getByRole("button", { name: "Apply Edit" }));
  expect(readFeatures({ ...first.candidate.authored, source: source() })[1]).toMatchObject({ id: "baseBody", distance: 6 });
  expect(readFeatures({ ...first.candidate.authored, source: source() })[3]).toMatchObject({ id: "capBody", targetBodyId: "baseBody" });
});
