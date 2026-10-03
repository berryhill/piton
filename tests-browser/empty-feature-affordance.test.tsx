import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ProjectWorkspace from "../src/ProjectWorkspace";
import { WorkspaceApplication, type WorkspaceStore } from "../src/workspace";

vi.mock("../src/components/Viewport", () => ({ default: () => <div data-testid="authored-viewport" /> }));

class Store implements WorkspaceStore {
  row: { version: number; json: string } | null = null;
  async readWorkspace() { return structuredClone(this.row); }
  async writeWorkspace(version: number, json: string) {
    if (version !== (this.row?.version ?? 0)) throw new Error("stale workspace");
    this.row = { version: version + 1, json };
  }
}

// Inject the synchronous node Manifold evaluator used by the modeling suite;
// the production app uses the worker-based evaluator. The affordance contract
// is the same: WorkspaceApplication.proposeFeatures / commitFeatures.
async function setup() {
  const store = new Store();
  // The default export uses evaluateFeatureSourceInWorker, which requires a Web
  // Worker global. jsdom does not expose Worker; spy on the application's two
  // feature commands to verify the affordance drives the correct call sequence.
  const app = new WorkspaceApplication(store);
  const projectId = await app.createProject("Affordance project");
  const documentId = await app.createPart(projectId, "Plate");
  return { app, store, projectId, documentId };
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});

it("renders the named first-feature source affordance only on an empty Part", async () => {
  const { app, projectId, documentId } = await setup();
  // 1) Project-only route: no active document, affordance must NOT render
  history.replaceState(null, "", `/projects/${projectId}`);
  render(<ProjectWorkspace application={app} />);
  await screen.findByRole("heading", { name: "Documents" });
  expect(screen.queryByTestId("empty-feature-authoring")).not.toBeInTheDocument();
  // The project-level entry that links to the first empty Part must render.
  expect(await screen.findByTestId("open-first-empty-part")).toBeVisible();
  // 2) Open the empty Part tab: the named affordance renders inside the change
  // request panel and stays a real, enabled button, never a placeholder.
  fireEvent.click(screen.getByRole("button", { name: "Plate" }));
  const section = await screen.findByTestId("empty-feature-authoring");
  expect(section).toHaveAttribute("aria-label", "First feature source");
  expect(within(section).getByRole("heading", { name: "First feature source" })).toBeVisible();
  const textarea = screen.getByTestId("feature-source-input");
  expect(textarea).toBeInTheDocument();
  expect(textarea).not.toBeDisabled();
  const button = screen.getByTestId("submit-first-feature");
  expect(button).toHaveTextContent("Preview features");
  expect(button).not.toBeDisabled();
  // The canonical placeholder source must be visible to the user.
  expect((textarea as HTMLTextAreaElement).value).toMatch(/part\.rectangle/);
  expect((textarea as HTMLTextAreaElement).value).toMatch(/part\.extrude/);
});

it("previews without committing until explicit confirmation", async () => {
  const { app, projectId, documentId } = await setup();
  history.replaceState(null, "", `/projects/${projectId}/documents/${documentId}`);
  render(<ProjectWorkspace application={app} />);
  await screen.findByTestId("empty-feature-authoring");

  const propose = vi.spyOn(app, "proposeFeatures").mockResolvedValue({
    proposal: {
      projectId, documentId,
      expectedRevisionId: null,
      idempotencyKey: "test-key",
      units: "mm",
      features: [],
    },
    candidate: { id: "rev-test", parentRevisionId: null, createdAt: new Date().toISOString(), authorityProfile: "browser-typescript/v1", authored: { authorityProfile: "browser-typescript/v1", units: "mm", source: "" }, reviewState: "needs_human_review", fabricationRelease: false, machineActuation: false, releaseState: "unreleased" },
    geometry: { sourceDigest: "sha256-0", environmentDigest: "sha256-0", claimScope: "review-mesh-only", units: "mm", fabricationRelease: false, machineActuation: false, reviewState: "needs_human_review", releaseState: "unreleased", bounds: { min: [0, 0, 0], max: [80, 50, 6] }, volumeMm3: 80 * 50 * 6, vertices: [], triangles: [], checks: [] },
  });
  const commit = vi.spyOn(app, "commitFeatures").mockResolvedValue("rev-test-uuid");

  fireEvent.click(screen.getByTestId("submit-first-feature"));

  await waitFor(() => {
    expect(propose).toHaveBeenCalledTimes(1);
  });
  const proposal = propose.mock.calls[0][0] as { projectId: string; documentId: string; units: string; features: unknown[] };
  expect(proposal.projectId).toBe(projectId);
  expect(proposal.documentId).toBe(documentId);
  expect(proposal.units).toBe("mm");
  expect(proposal.features.length).toBeGreaterThan(0);
  await screen.findByTestId("feature-preview");
  expect(commit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Commit feature revision" }));
  await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
});

it("shows an error alert when the source cannot be parsed into features", async () => {
  const { app, projectId, documentId } = await setup();
  history.replaceState(null, "", `/projects/${projectId}/documents/${documentId}`);
  render(<ProjectWorkspace application={app} />);
  await screen.findByTestId("empty-feature-authoring");
  // Replace the canonical placeholder with text that has no part.<kind>({...}) calls.
  fireEvent.change(screen.getByTestId("feature-source-input"), { target: { value: "// not a feature source\n" } });
  fireEvent.click(screen.getByTestId("submit-first-feature"));
  expect(await screen.findByTestId("empty-feature-error")).toHaveTextContent(/Invalid browser TypeScript source or units/);
});

// Local helper: re-exported here so the test file stands on its own.
import { within } from "@testing-library/react";

it("keeps first-feature source drafts document-local when switching Parts", async () => {
  const { app, projectId, documentId } = await setup();
  const secondId = await app.createPart(projectId, "Second plate");
  history.replaceState(null, "", `/projects/${projectId}/documents/${documentId}`);
  render(<ProjectWorkspace application={app} />);
  const firstSource = await screen.findByTestId("feature-source-input");
  const original = (firstSource as HTMLTextAreaElement).value;
  const draft = original.replace('"width":80', '"width":90');
  fireEvent.change(firstSource, { target: { value: draft } });
  fireEvent.click(within(screen.getByRole("navigation", { name: "Project Files" })).getByRole("button", { name: "Second plate" }));
  await waitFor(() => expect(location.pathname).toContain(secondId));
  expect(screen.getByTestId("feature-source-input")).toHaveValue(original);
  fireEvent.click(screen.getByRole("tab", { name: /^Plate$/ }));
  expect(screen.getByTestId("feature-source-input")).toHaveValue(draft);
});

it("rejects a malformed operation rather than silently previewing a valid subset", async () => {
  const { app, projectId, documentId } = await setup();
  const propose = vi.spyOn(app, "proposeFeatures");
  history.replaceState(null, "", `/projects/${projectId}/documents/${documentId}`);
  render(<ProjectWorkspace application={app} />);
  const input = await screen.findByTestId("feature-source-input");
  fireEvent.change(input, { target: { value: (input as HTMLTextAreaElement).value + 'part.hole({broken});\n' } });
  fireEvent.click(screen.getByTestId("submit-first-feature"));
  await screen.findByTestId("empty-feature-error");
  expect(propose).not.toHaveBeenCalled();
});
