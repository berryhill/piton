import { describe, expect, it } from "vitest";
import {
  R14_FIXTURE,
  activateFixtureDocument,
  closeFixtureDocument,
  createFixtureSession,
  openFixtureDocument,
  updateActiveDocumentState,
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
    session = updateActiveDocumentState(session, (state) => ({
      ...state,
      selection: "component:clamp-jaw:1",
      selectionMode: "component",
      viewPreset: "front",
      commandCategory: "mates",
      treeExpandedIds: ["assembly-components"],
      treeFocusId: "component:clamp-jaw:1",
      approximateSourceVisible: true,
      measurement: { phase: "endpoint-a", endpointA: [1, 2, 3], hoverEndpoint: [4, 5, 6] },
      stl: { state: "ready", artifactId: "review-mesh:bench-clamp" },
      camera: { position: [8, 9, 10], target: [1, 2, 3], up: [0, 0, 1] },
    }));
    session = activateFixtureDocument(session, "base-plate.part");
    session = updateActiveDocumentState(session, (state) => ({ ...state, selection: "face:top", selectionMode: "face" }));
    session = activateFixtureDocument(session, "bench-clamp.assembly");

    expect(session.documentStates["bench-clamp.assembly"]).toMatchObject({
      selection: "component:clamp-jaw:1", selectionMode: "component", viewPreset: "front",
      commandCategory: "mates", approximateSourceVisible: true,
      measurement: { phase: "endpoint-a", endpointA: [1, 2, 3], hoverEndpoint: null },
      stl: { state: "ready", artifactId: "review-mesh:bench-clamp" },
      camera: { position: [8, 9, 10], target: [1, 2, 3], up: [0, 0, 1] },
    });
    expect(session.documentStates["base-plate.part"]).toMatchObject({ selection: "face:top", selectionMode: "face" });
  });
});
