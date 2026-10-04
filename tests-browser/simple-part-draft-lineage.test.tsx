import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import Module, { type ManifoldToplevel } from "manifold-3d";
import ProjectWorkspace from "../src/ProjectWorkspace";
import { WorkspaceApplication, type FeatureProposal, type WorkspaceStore } from "../src/workspace";
import { appendFeatures, readFeatures, type PartFeature } from "../src/modeling/source";
import { evaluateFeatureSource } from "../src/modeling/evaluator";

vi.mock("../src/components/Viewport", () => ({ default: () => null }));
vi.mock("../src/modeling/client", async importOriginal => ({ ...await importOriginal<typeof import("../src/modeling/client")>(), evaluateFeatureSourceInWorker: async (source: Parameters<typeof evaluateFeatureSource>[0]) => evaluateFeatureSource(source, kernel) }));
vi.mock("../src/modeling/FeatureMeshViewport", () => ({ default: ({ revisionId }: { revisionId: string }) => <section data-testid="feature-mesh-viewport" data-revision-id={revisionId} /> }));
let kernel: ManifoldToplevel;
beforeAll(async () => { kernel = await Module(); kernel.setup(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
class Store implements WorkspaceStore {
  row: { version: number; json: string } | null = null;
  async readWorkspace() { return structuredClone(this.row); }
  async writeWorkspace(version: number, json: string) {
    if (version !== (this.row?.version ?? 0)) throw new Error("stale workspace");
    this.row = { version: version + 1, json };
  }
}
const profile: PartFeature = { kind: "rectangle", id: "outline", name: "Outline", plane: "XY", width: 30, height: 20 };
const body: PartFeature = { kind: "extrude", id: "body", name: "Thickness", profileId: "outline", distance: 4 };
const localHole: PartFeature = { kind: "hole", id: "local", name: "Local hole", bodyId: "body", x: 15, y: 10, diameter: 2, extent: "through" };
const externalHole: PartFeature = { ...localHole, id: "external", name: "External hole", x: 5, y: 5 };
async function setup() {
  const app = new WorkspaceApplication(new Store(), async source => evaluateFeatureSource(source, kernel));
  const projectId = await app.createProject("Draft lineage"), documentId = await app.createPart(projectId, "Plate");
  const proposal = (features: readonly PartFeature[], expectedRevisionId: string | null): FeatureProposal => ({ projectId, documentId, features, expectedRevisionId, units: "mm", idempotencyKey: crypto.randomUUID() });
  const initial = await app.proposeFeatures(proposal([profile, body], null));
  const pointer = await app.commitFeatures(initial.proposal);
  history.replaceState(null, "", `/projects/${projectId}/documents/${documentId}`);
  render(<ProjectWorkspace application={app} />);
  await screen.findByTestId("feature-source-input");
  await waitFor(() => expect(screen.getByTestId("feature-mesh-viewport")).toHaveAttribute("data-revision-id", initial.candidate.id));
  const localSource = appendFeatures(initial.candidate.authored, [localHole]).source;
  return { app, proposal, pointer, initial, localSource };
}

it("retains a dirty source's original revision and blocks silent replacement after external advancement", async () => {
  const { app, proposal, pointer, initial, localSource } = await setup();
  fireEvent.change(screen.getByTestId("feature-source-input"), { target: { value: localSource } });
  const propose = vi.spyOn(app, "proposeFeatures");
  await act(async () => {
    const external = await app.proposeFeatures(proposal([externalHole], pointer));
    await app.commitFeatures(external.proposal);
  });
  await waitFor(() => expect(screen.getByRole("region", { name: "Named feature tree" })).toHaveTextContent("External hole"));
  expect(screen.getByTestId("feature-source-input")).toHaveValue(localSource);
  expect(screen.getByTestId("submit-first-feature")).toBeDisabled();
  expect(screen.getByRole("alert")).toHaveTextContent(/changed|stale|conflict/i);
  const before = await app.read();
  fireEvent.click(screen.getByTestId("submit-first-feature"));
  expect(propose).toHaveBeenCalledTimes(1);
  expect(await app.read()).toEqual(before);
  fireEvent.click(screen.getByRole("button", { name: "Reload latest revision" }));
  expect(screen.getByTestId("feature-source-input")).toHaveValue(appendFeatures(initial.candidate.authored, [externalHole]).source);
  expect(screen.getByTestId("feature-source-input")).not.toHaveValue(localSource);
  expect(screen.getByTestId("submit-first-feature")).toBeEnabled();
});

it("shows historical geometry without a current draft preview and restores that preview on return", async () => {
  const { app, initial, localSource } = await setup();
  fireEvent.change(screen.getByTestId("feature-source-input"), { target: { value: localSource } });
  fireEvent.click(screen.getByTestId("submit-first-feature"));
  await screen.findByTestId("feature-preview");
  const candidateId = screen.getByTestId("feature-mesh-viewport").getAttribute("data-revision-id");
  const before = await app.read();
  fireEvent.click(screen.getByRole("button", { name: "Revision 1" }));
  await waitFor(() => expect(screen.getByTestId("feature-source-input")).toBeDisabled());
  await waitFor(() => expect(screen.getByTestId("feature-mesh-viewport")).toHaveAttribute("data-revision-id", initial.candidate.id));
  expect(screen.queryByTestId("feature-preview")).not.toBeInTheDocument();
  expect(screen.getByTestId("feature-source-input")).toHaveValue(initial.candidate.authored.source);
  fireEvent.click(screen.getByRole("button", { name: "Open current revision" }));
  await waitFor(() => expect(screen.getByTestId("feature-source-input")).toHaveValue(localSource));
  expect(screen.getByTestId("feature-preview")).toHaveTextContent(candidateId!);
  await waitFor(() => expect(screen.getByTestId("feature-mesh-viewport")).toHaveAttribute("data-revision-id", candidateId));
  expect(within(screen.getByRole("region", { name: "Part commands" })).getByRole("button", { name: "Commit feature revision" })).toBeEnabled();
  expect(await app.read()).toEqual(before);
  expect(readFeatures(initial.candidate.authored)).toEqual([profile, body]);
});
