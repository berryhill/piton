import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CadApplication } from "../src/application";
import { MemoryProjectRepository } from "../src/storage/repository";
import ProjectWorkspace from "../src/ProjectWorkspace";
import { WorkspaceApplication, type WorkspaceStore } from "../src/workspace";
import type { FixtureReviewMeasurement, FixtureReviewPoint } from "../src/fixture";

vi.mock("../src/components/Viewport", () => ({ default: ({ measurement, onMeasurementPoint, onMeasurementHover, onMeasurementCancel, onReviewMesh, onBuildStatus, authoritativeBase }: {
  measurement: FixtureReviewMeasurement; onMeasurementPoint: (point: FixtureReviewPoint) => void;
  onMeasurementHover: (point: FixtureReviewPoint | null) => void; onMeasurementCancel: () => void;
  onReviewMesh: (mesh: unknown) => void; onBuildStatus: (status: { state: "ready" }) => void;
  authoritativeBase: { id: string };
}) => <section data-testid="imported-renderer" data-phase={measurement.phase} data-revision={authoritativeBase.id}>
  <button onClick={() => { onReviewMesh({ sourceRevisionId: authoritativeBase.id }); onBuildStatus({ state: "ready" }); }}>Admit review mesh</button>
  <button onClick={() => onMeasurementPoint([0, 0, 0])}>Pick A</button>
  <button onClick={() => onMeasurementHover([1, 2, 0])}>Hover B</button>
  <button onClick={() => onMeasurementPoint([3, 4, 0])}>Pick B</button>
  <button onClick={onMeasurementCancel}>Escape mesh</button>
</section> }));

class Store implements WorkspaceStore {
  row: { version: number; json: string } | null = null;
  async readWorkspace() { return structuredClone(this.row); }
  async writeWorkspace(version: number, json: string) { if (version !== (this.row?.version ?? 0)) throw Error("stale"); this.row = { version: version + 1, json }; }
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
async function setup() {
  const legacy = new CadApplication(new MemoryProjectRepository()); await legacy.open();
  const app = new WorkspaceApplication(new Store());
  const projectId = await app.importCustody(await legacy.exportPortableCustody());
  const documentId = (await app.read()).projects[0].documents[0].id;
  history.replaceState(null, "", `/projects/${projectId}/documents/${documentId}`);
  render(<ProjectWorkspace application={app} />);
  await screen.findByTestId("imported-renderer");
  return { app, projectId, documentId };
}
const inspect = () => screen.getByRole("group", { name: "Imported review inspection" });
const admit = () => fireEvent.click(screen.getByRole("button", { name: "Admit review mesh" }));
it("arms, hovers, measures and clears only the imported review mesh, without changing custody", async () => {
  const { app, projectId } = await setup(); const initial = await app.exportProject(projectId);
  expect(within(inspect()).getByRole("button", { name: "Measure" })).toBeDisabled();
  admit();
  fireEvent.click(within(inspect()).getByRole("button", { name: "Measure" }));
  expect(screen.getByTestId("imported-renderer")).toHaveAttribute("data-phase", "armed");
  fireEvent.click(screen.getByRole("button", { name: "Pick A" }));
  fireEvent.click(screen.getByRole("button", { name: "Hover B" }));
  expect(screen.getByTestId("imported-measurement")).toHaveTextContent("second point");
  fireEvent.click(screen.getByRole("button", { name: "Pick B" }));
  expect(screen.getByTestId("imported-measurement")).toHaveTextContent("5.00 mm · review-only, not exact B-rep");
  fireEvent.click(within(inspect()).getByRole("button", { name: "Clear" }));
  expect(screen.getByTestId("imported-renderer")).toHaveAttribute("data-phase", "idle");
  fireEvent.click(within(inspect()).getByRole("button", { name: "Measure" }));
  fireEvent.click(screen.getByRole("button", { name: "Escape mesh" }));
  expect(within(inspect()).getByRole("button", { name: "Clear" })).toBeDisabled();
  expect(await app.exportProject(projectId)).toEqual(initial);
});
it("drops invisible picks across revision, preview invalidation and document tabs", async () => {
  const { app, projectId } = await setup(); admit();
  fireEvent.click(within(inspect()).getByRole("button", { name: "Measure" }));
  fireEvent.click(screen.getByRole("button", { name: "Pick A" }));
  const historyButton = screen.getAllByRole("button", { name: /Revision 1/ })[0];
  fireEvent.click(historyButton);
  await waitFor(() => expect(screen.getByTestId("imported-renderer")).toHaveAttribute("data-phase", "idle"));
  admit(); fireEvent.click(within(inspect()).getByRole("button", { name: "Measure" }));
  fireEvent.click(screen.getByRole("button", { name: "Pick A" }));
  fireEvent.click(screen.getByRole("button", { name: "Open current revision" }));
  await waitFor(() => expect(screen.getByTestId("imported-renderer")).toHaveAttribute("data-phase", "idle"));
  admit(); fireEvent.click(within(inspect()).getByRole("button", { name: "Measure" }));
  fireEvent.change(screen.getByRole("spinbutton", { name: "base_length_mm" }), { target: { value: "90" } });
  expect(screen.getByTestId("imported-renderer")).toHaveAttribute("data-phase", "idle");
  const other = await act(() => app.createPart(projectId, "Other"));
  fireEvent.click(within(screen.getByRole("navigation", { name: "Project Files" })).getByRole("button", { name: "Other" }));
  await waitFor(() => expect(location.pathname).toContain(other));
  fireEvent.click(screen.getByRole("tab", { name: /L-bracket/i }));
  expect(screen.getByTestId("imported-renderer")).toHaveAttribute("data-phase", "idle");
  expect(within(inspect()).getByRole("button", { name: "Clear" })).toBeDisabled();
});
it("binds a proposed parameter candidate to its own review mesh and drops the prior revision measurement", async () => {
  const { app, projectId } = await setup(); const initial = await app.exportProject(projectId);
  admit(); fireEvent.click(within(inspect()).getByRole("button", { name: "Measure" }));
  fireEvent.click(screen.getByRole("button", { name: "Pick A" }));
  fireEvent.click(screen.getByRole("button", { name: "Pick B" }));
  const previous = screen.getByTestId("imported-renderer").getAttribute("data-revision");
  fireEvent.change(screen.getByRole("spinbutton", { name: "base_length_mm" }), { target: { value: "90" } });
  fireEvent.click(screen.getByRole("button", { name: "Propose and preview" }));
  await screen.findByRole("heading", { name: "Preview only · not committed" });
  await waitFor(() => expect(screen.getByTestId("imported-renderer").getAttribute("data-revision")).not.toBe(previous));
  expect(screen.getByTestId("imported-renderer")).toHaveAttribute("data-phase", "idle");
  expect(within(inspect()).getByRole("button", { name: "Measure" })).toBeDisabled();
  admit(); fireEvent.click(within(inspect()).getByRole("button", { name: "Measure" }));
  fireEvent.click(screen.getByRole("button", { name: "Pick A" }));
  fireEvent.click(screen.getByRole("button", { name: "Pick B" }));
  expect(screen.getByTestId("imported-measurement")).toHaveTextContent("5.00 mm");
  expect(await app.exportProject(projectId)).toEqual(initial);
  fireEvent.click(screen.getByRole("button", { name: "Discard preview" }));
  expect(screen.getByTestId("imported-renderer")).toHaveAttribute("data-phase", "idle");
});
