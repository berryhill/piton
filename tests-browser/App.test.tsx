import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App from "../browser-src/App";
import { MemoryProjectRepository } from "../browser-src/storage/repository";
import { deriveGeometryBinding } from "../browser-src/geometry/binding";

describe("Piton workbench", () => {
  it("shows safety truth and a preview diff before commit", async () => {
    render(<App repository={new MemoryProjectRepository()} geometryDisabled />);
    expect(await screen.findByText("Accepted immutable revision")).toBeVisible();
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

  it("commits a candidate while retaining the accepted revision", async () => {
    const repository = new MemoryProjectRepository();
    render(<App repository={repository} geometryDisabled />);
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
    render(<App repository={repository} geometryDisabled />);
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

    render(<App repository={repository} geometryDisabled />);

    expect(await screen.findByText(/Durable preview status · stale disclosure only/)).toBeVisible();
    expect(screen.getByText(/durable prior preview/)).toBeVisible();
    expect(screen.getByText("Current revision").parentElement?.querySelector("code")?.textContent).not.toBe(seeded.currentRevisionId);
  });

  it("does not display an invalid raw input as rendered bbox truth", async () => {
    render(<App repository={new MemoryProjectRepository()} geometryDisabled />);
    await screen.findByText("Accepted immutable revision");
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
    render(<App repository={new MemoryProjectRepository()} geometryDisabled />);
    await screen.findByText("Accepted immutable revision");

    expect(screen.getByRole("button", { name: "Part fixture" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Assembly fixture" }));
    expect(screen.getByText(/review-only interaction evidence/i)).toBeVisible();
    expect(screen.getByText(/cannot author occurrences, mates, transforms, or Assembly revisions/i)).toBeVisible();

    expect(screen.getByRole("navigation", { name: "Model tree" })).toBeVisible();
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
    render(<App repository={new MemoryProjectRepository()} geometryDisabled />);
    await screen.findByText("Accepted immutable revision");

    fireEvent.click(screen.getByRole("button", { name: "Top review face" }));
    expect(screen.getByTestId("current-selection")).toHaveTextContent("Top review face");
    fireEvent.click(screen.getByRole("button", { name: "Attach current selection" }));
    expect(screen.getByTestId("attached-context")).toHaveTextContent("Top review face");

    fireEvent.click(screen.getByRole("button", { name: "Origin" }));
    expect(screen.getByTestId("current-selection")).toHaveTextContent("Origin");
    expect(screen.getByTestId("attached-context")).toHaveTextContent("Top review face");
    fireEvent.click(screen.getByRole("button", { name: "Clear current selection" }));
    expect(screen.getByTestId("current-selection")).toHaveTextContent("None");
    expect(screen.getByTestId("attached-context")).toHaveTextContent("Top review face");
  });

  it("labels all fixture-local highlight categories and measurement as review-only", async () => {
    render(<App repository={new MemoryProjectRepository()} geometryDisabled />);
    await screen.findByText("Accepted immutable revision");

    for (const selection of ["Top review face", "Component / reference", "Origin", "Top plane", "Review mate"]) {
      expect(screen.getByRole("button", { name: selection })).toBeVisible();
    }
    fireEvent.click(screen.getByRole("button", { name: "Top review face" }));
    fireEvent.click(screen.getByRole("button", { name: "Measure selected review entity" }));
    expect(screen.getByTestId("review-measurement")).toHaveTextContent(/mm/);
    expect(screen.getByTestId("review-measurement")).toHaveTextContent(/review-mesh/i);
    expect(screen.getByText(/fixture-local review IDs.*not durable topology/i)).toBeVisible();
  });
});