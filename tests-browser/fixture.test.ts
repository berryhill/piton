import { describe, expect, it } from "vitest";
import {
  R14_FIXTURE,
  activateFixtureDocument,
  closeFixtureDocument,
  createFixtureSession,
  dispatchFixtureReviewCommand,
  fixtureCommandCategories,
  fixtureModelTree,
  openFixtureDocument,
  setFixtureCommandCategory,
  setFixtureTreeInteraction,
  setFixtureViewportSelection,
  updateFixtureDocumentView,
} from "../src/fixture";

describe("accepted R14 Bench Clamp fixture", () => {
  it("exposes the exact ordered document identities and static parameter metadata", () => {
    expect(R14_FIXTURE).toMatchObject({
      id: "bench-clamp-fixture",
      name: "Bench Clamp Fixture",
      kind: "container",
      fileTypes: ["part", "assembly"],
    });
    expect(R14_FIXTURE.documents.map(({ id, fileName, kind }) => ({ id, fileName, kind }))).toEqual([
      { id: "base-plate.part", fileName: "Base Plate.part", kind: "part" },
      { id: "clamp-jaw.part", fileName: "Clamp Jaw.part", kind: "part" },
      { id: "guide-pin.part", fileName: "Guide Pin.part", kind: "part" },
      { id: "bench-clamp.assembly", fileName: "Bench Clamp.assembly", kind: "assembly" },
    ]);
    expect(R14_FIXTURE.documents[0].parameters).toEqual({
      width_mm: 120, depth_mm: 80, thickness_mm: 12, corner_radius_mm: 8,
      hole_diameter_mm: 9, hole_inset_mm: 14,
    });
    expect(R14_FIXTURE.documents[0].metadata).toEqual({
      hole_centers_mm: [[-46, -26], [-46, 26], [46, -26], [46, 26]],
    });
    expect(R14_FIXTURE.documents[1].parameters).toEqual({
      width_mm: 30, depth_mm: 28, height_mm: 45, foot_width_mm: 46, foot_height_mm: 8,
    });
    expect(R14_FIXTURE.documents[2].parameters).toEqual({
      diameter_mm: 10, height_mm: 48, head_diameter_mm: 18, head_height_mm: 5,
    });
    expect(R14_FIXTURE.documents[3].parameters).toEqual({ instance_count: 4 });
    expect(R14_FIXTURE.claimScope).toMatch(/static fixture metadata/i);
    expect(R14_FIXTURE.claimScope).toMatch(/not exact-kernel realization/i);
  });

  it("starts with the exact R14 tabs and independent default document state", () => {
    const session = createFixtureSession();
    expect(session.openDocumentIds).toEqual(["base-plate.part", "bench-clamp.assembly"]);
    expect(session.activeDocumentId).toBe("bench-clamp.assembly");
    expect(session.documentStates["bench-clamp.assembly"]).toMatchObject({
      selection: null, selectionMode: "smart", viewPreset: "iso", commandCategory: "inspect",
      approximateSourceVisible: false, measurement: { phase: "idle" }, stl: { state: "idle" },
    });
    expect(session.documentStates["base-plate.part"]).not.toBe(session.documentStates["bench-clamp.assembly"]);
  });

  it("opens, activates, and closes tabs with bounded neighbor selection and final-tab recovery", () => {
    let session = createFixtureSession();
    session = openFixtureDocument(session, "guide-pin.part");
    expect(session.openDocumentIds).toEqual(["base-plate.part", "bench-clamp.assembly", "guide-pin.part"]);
    expect(session.activeDocumentId).toBe("guide-pin.part");

    session = closeFixtureDocument(session, "guide-pin.part");
    expect(session.activeDocumentId).toBe("bench-clamp.assembly");
    session = closeFixtureDocument(session, "bench-clamp.assembly");
    expect(session.activeDocumentId).toBe("base-plate.part");
    session = closeFixtureDocument(session, "base-plate.part");
    expect(session.openDocumentIds).toEqual(["base-plate.part", "bench-clamp.assembly"]);
    expect(session.activeDocumentId).toBe("bench-clamp.assembly");
  });

  it("preserves independent state when switching documents and clears only transient measurement preview", () => {
    let session = createFixtureSession();
    session = setFixtureTreeInteraction(session, "bench-clamp.assembly", { selectionId: "component:clamp-jaw:1" });
    session = setFixtureCommandCategory(session, "bench-clamp.assembly", "mates");
    session = updateFixtureDocumentView(session, "bench-clamp.assembly", {
      selectionMode: "component",
      viewPreset: "front",
      approximateSourceVisible: true,
      stl: { state: "ready", artifactId: "review-mesh:bench-clamp" },
      camera: { position: [8, 9, 10], target: [1, 2, 3], up: [0, 0, 1] },
    });
    session = activateFixtureDocument(session, "base-plate.part");
    session = setFixtureTreeInteraction(session, "base-plate.part", { selectionId: "face:top" });
    session = updateFixtureDocumentView(session, "base-plate.part", { selectionMode: "face" });
    session = activateFixtureDocument(session, "bench-clamp.assembly");

    expect(session.documentStates["bench-clamp.assembly"]).toMatchObject({
      selection: "component:clamp-jaw:1", selectionMode: "component", viewPreset: "front",
      commandCategory: "mates", approximateSourceVisible: true,
      measurement: { phase: "idle" },
      stl: { state: "ready", artifactId: "review-mesh:bench-clamp" },
      camera: { position: [8, 9, 10], target: [1, 2, 3], up: [0, 0, 1] },
    });
    expect(session.documentStates["base-plate.part"]).toMatchObject({ selection: "face:top", selectionMode: "face" });
  });

  it("declares the exact deterministic Part and Assembly semantic hierarchies", () => {
    const basePlate = fixtureModelTree("base-plate.part");
    expect(basePlate.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: "document:base-plate.part", label: "Base Plate.part" },
    ]);
    expect(basePlate[0].children.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: "base-plate.part:origin", label: "Origin" },
      { id: "base-plate.part:body", label: "Body" },
    ]);
    expect(basePlate[0].children[0].children.map(({ label }) => label)).toEqual(["Front plane", "Top plane", "Right plane"]);
    expect(basePlate[0].children[1].children.map(({ label }) => label)).toEqual([
      "Sketch 1", "Extrude 1", "Sketch 2", "Hole Pattern 1", "Review surfaces",
    ]);
    expect(fixtureModelTree("clamp-jaw.part")[0].children[1].children.map(({ label }) => label)).toEqual([
      "Sketch 1", "Extrude 1", "Review surfaces",
    ]);
    expect(fixtureModelTree("guide-pin.part")[0].children[1].children.map(({ label }) => label)).toEqual([
      "Sketch 1", "Revolve 1", "Review surfaces",
    ]);

    const assembly = fixtureModelTree("bench-clamp.assembly")[0];
    expect(assembly.children.map(({ label }) => label)).toEqual(["Components", "Mates"]);
    expect(assembly.children[0].children.map(({ label }) => label)).toEqual([
      "Base Plate:1 (Fixed)", "Clamp Jaw:1", "Clamp Jaw:2", "Guide Pin:1",
    ]);
    expect(assembly.children[1].children.map(({ label }) => label)).toEqual([
      "Distance Mate · Jaw spacing · review-only", "Concentric Mate · Guide Pin · review-only",
    ]);
    for (const occurrence of assembly.children[0].children) {
      expect(occurrence.children[0]).toMatchObject({ kind: "source-reference", sourceDocumentId: expect.stringMatching(/\.part$/) });
      expect(occurrence.children.slice(1).every(({ id, kind }) => id.startsWith(`contextual-face:${occurrence.id}:`) && kind === "review-surface")).toBe(true);
    }
  });

  it("admits command categories by active document kind and preserves independent category state", () => {
    expect(fixtureCommandCategories("base-plate.part")).toEqual(["features", "sketch", "inspect"]);
    expect(fixtureCommandCategories("bench-clamp.assembly")).toEqual(["assembly", "mates", "inspect"]);
    let session = createFixtureSession();
    const unchanged = session;
    expect(() => setFixtureCommandCategory(session, "bench-clamp.assembly", "features")).toThrow(/not admitted/);
    expect(session).toBe(unchanged);
    session = setFixtureCommandCategory(session, "bench-clamp.assembly", "mates");
    session = activateFixtureDocument(session, "base-plate.part");
    session = setFixtureCommandCategory(session, "base-plate.part", "features");
    session = activateFixtureDocument(session, "bench-clamp.assembly");
    expect(session.documentStates["bench-clamp.assembly"].commandCategory).toBe("mates");
    expect(session.documentStates["base-plate.part"].commandCategory).toBe("features");
  });

  it("fails closed for stale, unavailable, forged, unsupported, ambiguous, and missing review commands", () => {
    const original = createFixtureSession();
    const cases = [
      { expectedDocumentId: "base-plate.part", category: "inspect", command: "measure", selectionId: "component:base-plate:1" },
      { expectedDocumentId: "bench-clamp.assembly", category: "features", command: "measure", selectionId: "component:base-plate:1" },
      { expectedDocumentId: "bench-clamp.assembly", category: "inspect", command: "extrude", selectionId: "component:base-plate:1" },
      { expectedDocumentId: "bench-clamp.assembly", category: "inspect", command: "measure", selectionId: "forged:triangle:42" },
      { expectedDocumentId: "bench-clamp.assembly", category: "inspect", command: "open-part", selectionId: "mate:jaw-spacing" },
      { expectedDocumentId: "bench-clamp.assembly", category: "inspect", command: "open-part", selectionId: "association:component:missing:source" },
    ] as const;
    for (const request of cases) {
      expect(() => dispatchFixtureReviewCommand(original, request as never)).toThrow();
      expect(original).toEqual(createFixtureSession());
    }

    const staleSelection = setFixtureTreeInteraction(original, "bench-clamp.assembly", { selectionId: "component:clamp-jaw:1" });
    expect(() => dispatchFixtureReviewCommand(staleSelection, {
      expectedDocumentId: "bench-clamp.assembly", category: "inspect", command: "open-part",
      selectionId: "component:clamp-jaw:2",
    })).toThrow(/stale selection/);
    const staleCategory = setFixtureCommandCategory(staleSelection, "bench-clamp.assembly", "mates");
    expect(() => dispatchFixtureReviewCommand(staleCategory, {
      expectedDocumentId: "bench-clamp.assembly", category: "inspect", command: "open-part",
      selectionId: "component:clamp-jaw:1",
    })).toThrow(/stale command category/);

    const unsupportedSelection = setFixtureTreeInteraction(original, "bench-clamp.assembly", { selectionId: "document:bench-clamp.assembly" });
    expect(() => dispatchFixtureReviewCommand(unsupportedSelection, {
      expectedDocumentId: "bench-clamp.assembly", category: "inspect", command: "measure",
      selectionId: "document:bench-clamp.assembly",
    })).toThrow(/selection kind/);
    const unsupportedKinds = ["component:clamp-jaw:1", "association:component:clamp-jaw:1:source", "mate:jaw-spacing"];
    for (const selectionId of unsupportedKinds) {
      const selected = setFixtureTreeInteraction(original, "bench-clamp.assembly", { selectionId });
      expect(() => dispatchFixtureReviewCommand(selected, {
        expectedDocumentId: "bench-clamp.assembly", category: "inspect", command: "measure", selectionId,
      })).toThrow(/selection kind/);
    }
    expect(() => updateFixtureDocumentView(original, "bench-clamp.assembly", {
      selection: "component:clamp-jaw:1", commandCategory: "inspect", reviewMeasurementMm: 999,
    } as never)).toThrow(/protected fixture review state/);
    expect(() => updateFixtureDocumentView(original, "base-plate.part", { viewPreset: "top" })).toThrow(/stale or inactive/);
    expect(() => setFixtureTreeInteraction(original, "base-plate.part", { selectionId: "face:top" })).toThrow(/stale or inactive/);

    let forgedMeasurement = activateFixtureDocument(original, "base-plate.part");
    forgedMeasurement = setFixtureTreeInteraction(forgedMeasurement, "base-plate.part", { selectionId: "face:top" });
    forgedMeasurement = dispatchFixtureReviewCommand(forgedMeasurement, {
      expectedDocumentId: "base-plate.part", category: "inspect", command: "measure",
      selectionId: "face:top", measurementMm: 999,
    } as never);
    expect(forgedMeasurement.documentStates["base-plate.part"].reviewMeasurementMm).toBe(80);
  });

  it("admits only conditional review consequences in the active document", () => {
    let session = activateFixtureDocument(createFixtureSession(), "base-plate.part");
    session = setFixtureTreeInteraction(session, "base-plate.part", { selectionId: "face:top" });
    session = dispatchFixtureReviewCommand(session, {
      expectedDocumentId: "base-plate.part", category: "inspect", command: "measure",
      selectionId: "face:top",
    });
    expect(session.documentStates["base-plate.part"].reviewMeasurementMm).toBe(80);
    session = dispatchFixtureReviewCommand(session, {
      expectedDocumentId: "base-plate.part", category: "inspect", command: "clear-measurement",
    });
    expect(session.documentStates["base-plate.part"].reviewMeasurementMm).toBeNull();
    expect(() => dispatchFixtureReviewCommand(session, {
      expectedDocumentId: "base-plate.part", category: "inspect", command: "clear-measurement",
    })).toThrow(/no measurement/);
    session = activateFixtureDocument(session, "bench-clamp.assembly");
    session = setFixtureTreeInteraction(session, "bench-clamp.assembly", { selectionId: "component:clamp-jaw:2" });
    session = dispatchFixtureReviewCommand(session, {
      expectedDocumentId: "bench-clamp.assembly", category: "inspect", command: "open-part",
      selectionId: "component:clamp-jaw:2",
    });
    expect(session.activeDocumentId).toBe("clamp-jaw.part");
  });

  it("admits canonical viewport picks into active-document review state without toggling repeated picks", () => {
    let session = createFixtureSession();
    session = setFixtureViewportSelection(session, "bench-clamp.assembly", "component:clamp-jaw:2");
    session = setFixtureViewportSelection(session, "bench-clamp.assembly", "component:clamp-jaw:2");
    expect(session.documentStates["bench-clamp.assembly"]).toMatchObject({
      selection: "component:clamp-jaw:2",
      treeFocusId: "component:clamp-jaw:2",
      reviewMeasurementMm: null,
    });

    session = setFixtureViewportSelection(session, "bench-clamp.assembly", "contextual-face:component:clamp-jaw:2:jaw-grip");
    expect(session.documentStates["bench-clamp.assembly"].selection).toBe("contextual-face:component:clamp-jaw:2:jaw-grip");
    expect(() => setFixtureViewportSelection(session, "bench-clamp.assembly", "contextual-face:forged")).toThrow(/unknown viewport/);
    expect(() => setFixtureViewportSelection(session, "base-plate.part", "face:top")).toThrow(/stale or inactive/);

    session = setFixtureCommandCategory(session, "bench-clamp.assembly", "mates");
    expect(() => setFixtureViewportSelection(session, "bench-clamp.assembly", "component:clamp-jaw:1")).toThrow(/requires Inspect/);
  });
});
