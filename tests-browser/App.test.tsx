import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App from "../src/App";
import { CadApplication } from "../src/application";
import { MemoryProjectRepository } from "../src/storage/repository";
import { deriveGeometryBinding } from "../src/geometry/binding";

describe("Piton workbench", () => {
  function application(repository = new MemoryProjectRepository()) {
    return new CadApplication(repository);
  }

  it("shows safety truth and a preview diff before commit", async () => {
    render(<App application={application()} geometryDisabled />);
    expect(await screen.findByText("Accepted immutable revision")).toBeVisible();
    expect(screen.getByText("PITON")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Piton Workbench" })).toBeVisible();
    expect(screen.getByTestId("fabrication-release")).toHaveTextContent("false");
    expect(screen.getByTestId("machine-actuation")).toHaveTextContent("false");
    for (const parameter of [
      "Leg width",
      "Base length",
      "Base thickness",
      "Leg thickness",
      "Hole diameter",
    ]) {
      expect(screen.getByText(parameter)).toBeVisible();
    }

    fireEvent.change(screen.getByLabelText("Leg length (mm)"), { target: { value: "92" } });
    expect(screen.getByText("80 mm → 92 mm")).toBeVisible();
    expect(screen.getByText("Preview only · not committed")).toBeVisible();
  });

  it("exposes the R14 shell hierarchy, keyboard paths, and persistent root truth", async () => {
    render(<App application={application()} geometryDisabled />);
    await screen.findByText("Accepted immutable revision");

    const shell = screen.getByTestId("workbench-shell");
    expect(Array.from(shell.children).map((child) => child.tagName)).toEqual([
      "A", "A", "HEADER", "NAV", "DIV", "FOOTER",
    ]);
    expect(screen.getByRole("navigation", { name: "Document commands" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Skip to model workspace" })).toHaveAttribute("href", "#model-workspace");
    expect(screen.getByRole("link", { name: "Skip to revision custody" })).toHaveAttribute("href", "#revision-custody");
    expect(screen.getByRole("region", { name: "Model workspace" })).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("complementary", { name: "Revision custody" })).toHaveAttribute("tabindex", "-1");

    const footer = screen.getByRole("contentinfo", { name: "Persistent safety truth" });
    expect(within(footer).getByTestId("fabrication-release")).toHaveTextContent("false");
    expect(within(footer).getByTestId("machine-actuation")).toHaveTextContent("false");
  });

  it("provides bounded responsive panel toggles without changing authored authority", async () => {
    render(<App application={application()} geometryDisabled />);
    await screen.findByText("Accepted immutable revision");

    const modelToggle = screen.getByRole("button", { name: "Model panel" });
    const custodyToggle = screen.getByRole("button", { name: "Revision custody panel" });
    expect(modelToggle).toHaveAttribute("aria-expanded", "false");
    expect(custodyToggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(modelToggle);
    expect(modelToggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("complementary", { name: "Model and source controls" })).toHaveClass("open");
    fireEvent.click(custodyToggle);
    expect(custodyToggle).toHaveAttribute("aria-expanded", "true");
    expect(modelToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("complementary", { name: "Revision custody" })).toHaveClass("open");
    expect(screen.getByTestId("fabrication-release")).toHaveTextContent("false");
  });

  it("commits a candidate while retaining the accepted revision", async () => {
    const repository = new MemoryProjectRepository();
    render(<App application={application(repository)} geometryDisabled />);
    await screen.findByText("Accepted immutable revision");
    fireEvent.change(screen.getByLabelText("Leg length (mm)"), { target: { value: "90" } });
    fireEvent.click(screen.getByRole("button", { name: "Commit candidate" }));
    expect(await screen.findByText("Candidate committed locally" )).toBeVisible();
    const reopened = await repository.load();
    expect(reopened?.revisions).toHaveLength(2);
    expect(reopened?.revisions[0].parameters.leg_length_mm).toBe(80);
    expect(reopened?.revisions[1].parameters.leg_length_mm).toBe(90);
  });

  it("uses the closed command API rather than saving caller-assembled project state", async () => {
    const repository = new MemoryProjectRepository();
    const commitCandidate = vi.spyOn(repository, "commitCandidate");
    render(<App application={application(repository)} geometryDisabled />);
    await screen.findByText("Accepted immutable revision");
    fireEvent.change(screen.getByLabelText("Leg length (mm)"), { target: { value: "95" } });
    fireEvent.click(screen.getByRole("button", { name: "Commit candidate" }));
    await screen.findByText("Candidate committed locally");

    expect(commitCandidate).toHaveBeenCalledWith(expect.stringMatching(/^rev-/), { type: "set-leg-length", value: 95 });
    expect(await repository.load()).toEqual(await commitCandidate.mock.results[0].value);
  });

  it("discloses recovered durable preview status without treating stale status as authority", async () => {
    const repository = new MemoryProjectRepository();
    const seeded = await repository.initialize();
    await repository.saveBuildStatus({
      projectId: seeded.id,
      requestId: 4,
      binding: deriveGeometryBinding(seeded.revisions[0], seeded.revisions[0].parameters),
      state: "ready",
      message: "durable prior preview",
    });
    await repository.commitCandidate(seeded.currentRevisionId, { type: "set-leg-length", value: 90 });

    render(<App application={application(repository)} geometryDisabled />);

    expect(await screen.findByText(/Durable preview status · stale disclosure only/)).toBeVisible();
    expect(screen.getByText(/durable prior preview/)).toBeVisible();
    expect(screen.getByText("Current revision").parentElement?.querySelector("code")?.textContent).not.toBe(seeded.currentRevisionId);
  });

  it("does not display an invalid raw input as rendered bbox truth", async () => {
    render(<App application={application()} geometryDisabled />);
    await screen.findByText("Accepted immutable revision");
    fireEvent.click(screen.getByRole("button", { name: "Part fixture" }));
    fireEvent.click(screen.getByRole("button", { name: "Top review face" }));
    fireEvent.click(screen.getByRole("button", { name: "Measure selected review entity" }));
    expect(screen.getByTestId("review-measurement")).toHaveTextContent("80 mm");
    fireEvent.change(screen.getByLabelText("Leg length (mm)"), { target: { value: "999" } });
    expect(screen.getByText("BBOX awaiting admitted review geometry")).toBeVisible();
    expect(screen.queryByText(/1007 mm/)).not.toBeInTheDocument();
    expect(screen.getByTestId("review-measurement")).toHaveTextContent("select an entity");
    expect(screen.getByText("Validation / issues")).toBeVisible();
  });

  it("exposes R14 fixture, semantic navigation, and selection vocabulary without authoring an Assembly", async () => {
    render(<App application={application()} geometryDisabled />);
    await screen.findByText("Accepted immutable revision");

    expect(screen.getByRole("button", { name: "Assembly fixture" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Part fixture" }));
    expect(screen.getByRole("button", { name: "Part fixture" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Assembly fixture" }));
    expect(screen.getByText(/review-only interaction evidence/i)).toBeVisible();
    expect(screen.getByText(/cannot author occurrences, mates, transforms, or Assembly revisions/i)).toBeVisible();

    expect(screen.getByRole("tree", { name: "Model tree" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /Source-Part/ }));
    expect(screen.getByTestId("navigation-context")).toHaveTextContent("Source-Part");
    fireEvent.click(screen.getByRole("button", { name: /Displayed occurrence/ }));
    expect(screen.getByTestId("navigation-context")).toHaveTextContent("Displayed occurrence");

    for (const mode of ["Smart", "Face", "Component"]) {
      expect(screen.getByRole("button", { name: mode })).toBeVisible();
    }
    fireEvent.click(screen.getByRole("button", { name: "Component" }));
    expect(screen.getByRole("button", { name: "Component" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Smart" })).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps current selection separate from explicitly attached review context", async () => {
    render(<App application={application()} geometryDisabled />);
    await screen.findByText("Accepted immutable revision");

    fireEvent.click(screen.getByRole("button", { name: "Part fixture" }));
    fireEvent.click(screen.getByRole("button", { name: "Top review face" }));
    expect(screen.getByTestId("current-selection")).toHaveTextContent("Top review face");
    fireEvent.click(screen.getByRole("button", { name: "Attach current selection" }));
    expect(screen.getByTestId("attached-context")).toHaveTextContent("Top review face");

    fireEvent.click(within(screen.getByRole("tree", { name: "Model tree" })).getByRole("button", { name: "Origin" }));
    expect(screen.getByTestId("current-selection")).toHaveTextContent("Origin");
    expect(screen.getByTestId("attached-context")).toHaveTextContent("Top review face");
    fireEvent.click(screen.getByRole("button", { name: "Clear current selection" }));
    expect(screen.getByTestId("current-selection")).toHaveTextContent("None");
    expect(screen.getByTestId("attached-context")).toHaveTextContent("Top review face");
  });

  it("labels all fixture-local highlight categories and measurement as review-only", async () => {
    render(<App application={application()} geometryDisabled />);
    await screen.findByText("Accepted immutable revision");

    for (const selection of ["Top review face", "Component / reference", "Origin", "Top plane", "Review mate"]) {
      expect(screen.getByRole("button", { name: selection })).toBeVisible();
    }
    fireEvent.click(screen.getByRole("button", { name: "Part fixture" }));
    fireEvent.click(screen.getByRole("button", { name: "Top review face" }));
    fireEvent.click(screen.getByRole("button", { name: "Measure selected review entity" }));
    expect(screen.getByTestId("review-measurement")).toHaveTextContent(/mm/);
    expect(screen.getByTestId("review-measurement")).toHaveTextContent(/review-mesh/i);
    expect(screen.getByText(/fixture-local review IDs.*not durable topology/i)).toBeVisible();
  });

  it("renders the static four-occurrence Assembly scene and exact source/relationship review semantics", async () => {
    render(<App application={application()} geometryDisabled />);
    await screen.findByText("Accepted immutable revision");

    const viewport = screen.getByTestId("assembly-viewport");
    expect(viewport).toHaveAttribute("data-scene-name", "Assembly scene · Bench Clamp");
    expect(viewport).toHaveAttribute("data-occurrence-count", "4");
    expect(viewport).toHaveAttribute("data-cad-z-min", "0");
    expect(viewport).toHaveAttribute("data-build-plane-z", "0");
    expect(viewport).toHaveAttribute("data-cad-world-mapping", "CAD Z=Three.js world Z");

    for (const occurrence of ["Base Plate:1 (Fixed)", "Clamp Jaw:1", "Clamp Jaw:2", "Guide Pin:1"]) {
      expect(screen.getByRole("button", { name: `◇ ${occurrence}` })).toBeVisible();
    }
    fireEvent.click(screen.getByRole("button", { name: /Distance Mate · Jaw spacing · review-only/ }));
    expect(screen.getByTestId("current-selection")).toHaveTextContent("Distance Mate · Jaw spacing");
    fireEvent.click(screen.getByRole("button", { name: "◇ Clamp Jaw:2" }));
    expect(screen.getByTestId("current-selection")).toHaveTextContent("Clamp Jaw:2");
    fireEvent.click(screen.getByRole("button", { name: "▱ Contextual review face · Clamp Jaw:2" }));
    expect(screen.getByTestId("current-selection")).toHaveTextContent("contextual-face:component:clamp-jaw:2:jaw-grip");

    fireEvent.click(screen.getByRole("button", { name: "Open source · Clamp Jaw.part · from Clamp Jaw:2" }));
    expect(screen.getByRole("tab", { name: /Clamp Jaw\.part/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("navigation-context")).toHaveTextContent("Clamp Jaw.part · from Clamp Jaw:2");
  });

  it("renders exact fixture files and unique tab lifecycle with independent document controls", async () => {
    render(<App application={application()} geometryDisabled />);
    await screen.findByText("Accepted immutable revision");

    expect(screen.getByText("Project container · review fixture metadata")).toBeVisible();
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(screen.getByRole("tab", { name: /Bench Clamp\.assembly/ })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("button", { name: /PRT · Clamp Jaw\.part/ }));
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Face" }));
    fireEvent.click(screen.getByRole("button", { name: "Top review face" }));
    const fixtureView = screen.getByRole("group", { name: "Fixture view preset" });
    fireEvent.click(within(fixtureView).getByRole("button", { name: "Top" }));

    fireEvent.click(screen.getByRole("tab", { name: /Bench Clamp\.assembly/ }));
    expect(screen.getByRole("button", { name: "Smart" })).toHaveAttribute("aria-pressed", "true");
    expect(within(fixtureView).getByRole("button", { name: "Iso" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("current-selection")).toHaveTextContent("None");

    fireEvent.click(screen.getByRole("tab", { name: /Clamp Jaw\.part/ }));
    expect(screen.getByRole("button", { name: "Face" })).toHaveAttribute("aria-pressed", "true");
    expect(within(fixtureView).getByRole("button", { name: "Top" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("current-selection")).toHaveTextContent("None");
    fireEvent.click(screen.getByRole("button", { name: "Close Clamp Jaw.part" }));
    expect(screen.queryByRole("tab", { name: /Clamp Jaw\.part/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /PRT · Clamp Jaw\.part/ })).toBeVisible();
  });

  it("keeps approximate source and validated STL output local to the active document", async () => {
    const createObjectURL = vi.fn(() => "blob:piton-review-mesh");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL }));
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    render(<App application={application()} geometryDisabled />);
    await screen.findByText("Accepted immutable revision");

    expect(screen.getByText(/Review-mesh STL not generated for Bench Clamp\.assembly/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "View approximate source" }));
    expect(screen.getByTestId("fixture-approximate-source")).toHaveTextContent("Bench Clamp.assembly");
    expect(screen.getByTestId("fixture-approximate-source")).toHaveTextContent("Clamp Jaw:2");
    fireEvent.click(screen.getByRole("button", { name: "Download review-mesh STL" }));
    expect(screen.getByText(/Ready · validated nonempty ASCII STL/)).toBeVisible();
    expect(screen.getByTestId("fixture-stl-status")).toHaveTextContent(/CAD Z min 0 mm/);
    expect(anchorClick).toHaveBeenCalledOnce();
    expect(createObjectURL).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: /PRT · Guide Pin\.part/ }));
    expect(screen.getByText(/Review-mesh STL not generated for Guide Pin\.part/)).toBeVisible();
    expect(screen.queryByTestId("fixture-approximate-source")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View approximate source" }));
    expect(screen.getByTestId("fixture-approximate-source")).toHaveTextContent("Cylinder(5, 43)");
    expect(screen.getByTestId("fixture-approximate-source")).not.toHaveTextContent("Clamp Jaw:2");

    fireEvent.click(screen.getByRole("tab", { name: /Bench Clamp\.assembly/ }));
    expect(screen.getByTestId("fixture-approximate-source")).toHaveTextContent("Clamp Jaw:2");
    expect(screen.getByText(/Ready · validated nonempty ASCII STL/)).toBeVisible();
    expect(screen.getByTestId("fabrication-release")).toHaveTextContent("false");
    expect(screen.getByTestId("machine-actuation")).toHaveTextContent("false");
  });

  it("supports hierarchical roving focus, selection toggle, and document-aware command controls", async () => {
    render(<App application={application()} geometryDisabled />);
    await screen.findByText("Accepted immutable revision");

    const tree = screen.getByRole("tree", { name: "Model tree" });
    const root = within(tree).getByRole("treeitem", { name: /Bench Clamp\.assembly/ });
    expect(root).toHaveAttribute("tabindex", "0");
    expect(root).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(root, { key: "ArrowDown" });
    expect(within(tree).getByRole("treeitem", { name: /Components/ })).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(within(tree).getByRole("treeitem", { name: /Components/ }), { key: "End" });
    expect(within(tree).getByRole("treeitem", { name: /Concentric Mate/ })).toHaveAttribute("tabindex", "0");

    const jaw = within(tree).getByRole("button", { name: "◇ Clamp Jaw:1" });
    fireEvent.click(jaw);
    expect(screen.getByTestId("current-selection")).toHaveTextContent("Clamp Jaw:1");
    expect(screen.getByRole("button", { name: "Open Part" })).toBeEnabled();
    fireEvent.click(jaw);
    expect(screen.getByTestId("current-selection")).toHaveTextContent("None");

    const categories = screen.getByRole("group", { name: "Review command categories" });
    expect(within(categories).getByRole("button", { name: "Inspect" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(categories).getByRole("button", { name: "Assembly" }));
    for (const command of ["Insert Component", "Move Component", "Fix/Float"]) {
      expect(screen.getByRole("button", { name: command })).toBeDisabled();
    }
    fireEvent.click(within(categories).getByRole("button", { name: "Inspect" }));
    fireEvent.doubleClick(jaw);
    expect(screen.getByRole("tab", { name: /Clamp Jaw\.part/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("navigation-context")).toHaveTextContent("Clamp Jaw.part · from Clamp Jaw:1");
    expect(screen.getByTestId("fabrication-release")).toHaveTextContent("false");
    expect(screen.getByTestId("machine-actuation")).toHaveTextContent("false");
  });

  it("admits measurement only for an exact active-document tree selection in Inspect", async () => {
    render(<App application={application()} geometryDisabled />);
    await screen.findByText("Accepted immutable revision");

    const persistentMeasure = screen.getByRole("button", { name: "Measure selected review entity" });
    fireEvent.click(screen.getByRole("button", { name: "Top review face" }));
    expect(persistentMeasure).toBeDisabled();
    expect(screen.getByRole("button", { name: /^Measure$/ })).toBeDisabled();
    fireEvent.click(persistentMeasure);
    expect(screen.getByTestId("review-measurement")).toHaveTextContent("select an entity");

    fireEvent.click(screen.getByRole("button", { name: "Part fixture" }));
    fireEvent.click(screen.getByRole("button", { name: "Top review face" }));
    expect(persistentMeasure).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Features" }));
    expect(persistentMeasure).toBeDisabled();
    fireEvent.click(persistentMeasure);
    expect(screen.getByTestId("review-measurement")).toHaveTextContent("select an entity");

    fireEvent.click(screen.getByRole("button", { name: "Inspect" }));
    fireEvent.click(persistentMeasure);
    expect(screen.getByTestId("review-measurement")).toHaveTextContent(/review-mesh distance 80 mm/i);
  });
});
