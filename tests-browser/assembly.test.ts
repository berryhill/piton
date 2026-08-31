import { describe, expect, it } from "vitest";
import {
  R14_ASSEMBLY,
  assemblyContextualFaceId,
  assemblySourceReference,
} from "../src/assembly";
import { createAssemblyReviewRoot, inspectAssemblyReviewRoot } from "../src/components/AssemblyViewport";

describe("R14 static Bench Clamp Assembly review contract", () => {
  it("locks the four independently addressable occurrences and their transforms", () => {
    expect(R14_ASSEMBLY.occurrences).toEqual([
      {
        id: "component:base-plate:1", label: "Base Plate:1", sourceDocumentId: "base-plate.part",
        transform: { translationMm: [0, 0, 0], rotationDeg: [0, 0, 0] }, fixed: true, suppressed: false,
      },
      {
        id: "component:clamp-jaw:1", label: "Clamp Jaw:1", sourceDocumentId: "clamp-jaw.part",
        transform: { translationMm: [-36, 0, 12], rotationDeg: [0, 0, 0] }, fixed: false, suppressed: false,
      },
      {
        id: "component:clamp-jaw:2", label: "Clamp Jaw:2", sourceDocumentId: "clamp-jaw.part",
        transform: { translationMm: [36, 0, 12], rotationDeg: [0, 0, 180] }, fixed: false, suppressed: false,
      },
      {
        id: "component:guide-pin:1", label: "Guide Pin:1", sourceDocumentId: "guide-pin.part",
        transform: { translationMm: [0, 0, 12], rotationDeg: [0, 0, 0] }, fixed: false, suppressed: false,
      },
    ]);
    expect(new Set(R14_ASSEMBLY.occurrences.map(({ id }) => id)).size).toBe(4);
    expect(R14_ASSEMBLY.occurrences.filter(({ fixed }) => fixed).map(({ id }) => id)).toEqual(["component:base-plate:1"]);
    expect(R14_ASSEMBLY.occurrences.every(({ suppressed }) => !suppressed)).toBe(true);
  });

  it("preserves exact source associations, occurrence-qualified faces, and review-only relationships", () => {
    expect(R14_ASSEMBLY.sourceReferences.map(({ id, parentOccurrenceId, sourceDocumentId }) => ({ id, parentOccurrenceId, sourceDocumentId }))).toEqual([
      { id: "association:component:base-plate:1:source", parentOccurrenceId: "component:base-plate:1", sourceDocumentId: "base-plate.part" },
      { id: "association:component:clamp-jaw:1:source", parentOccurrenceId: "component:clamp-jaw:1", sourceDocumentId: "clamp-jaw.part" },
      { id: "association:component:clamp-jaw:2:source", parentOccurrenceId: "component:clamp-jaw:2", sourceDocumentId: "clamp-jaw.part" },
      { id: "association:component:guide-pin:1:source", parentOccurrenceId: "component:guide-pin:1", sourceDocumentId: "guide-pin.part" },
    ]);
    expect(assemblySourceReference("component:clamp-jaw:2").sourceDocumentId).toBe("clamp-jaw.part");
    expect(assemblyContextualFaceId("component:clamp-jaw:2", "face:jaw-grip")).toBe("contextual-face:component:clamp-jaw:2:jaw-grip");
    expect(R14_ASSEMBLY.relationships).toEqual([
      {
        id: "mate:jaw-spacing", label: "Distance Mate · Jaw spacing", kind: "distance",
        relatedOccurrenceIds: ["component:clamp-jaw:1", "component:clamp-jaw:2"], distanceMm: 72, status: "review-only",
      },
      {
        id: "mate:pin-concentric", label: "Concentric Mate · Guide Pin", kind: "concentric",
        relatedOccurrenceIds: ["component:guide-pin:1", "component:base-plate:1"], status: "review-only",
      },
    ]);
    expect(R14_ASSEMBLY.claimScope).toMatch(/not exact geometry/i);
    expect(R14_ASSEMBLY.fabricationRelease).toBe(false);
    expect(R14_ASSEMBLY.machineActuation).toBe(false);
  });

  it("derives CAD Z=0 contact from the realized Three.js review geometry", () => {
    const root = createAssemblyReviewRoot();
    const evidence = inspectAssemblyReviewRoot(root);
    expect(root.name).toBe("Assembly scene · Bench Clamp");
    expect(root.children.map(({ userData }) => userData.occurrenceId)).toEqual(R14_ASSEMBLY.occurrences.map(({ id }) => id));
    expect(evidence.occurrenceCount).toBe(4);
    expect(evidence.cadZMinMm).toBe(0);
    expect(evidence.gridWorldZMm).toBe(0);
    expect(evidence.bounds.min.z).toBe(0);
    expect(evidence.size.x).toBeGreaterThan(0);
    expect(evidence.size.y).toBeGreaterThan(0);
    expect(evidence.size.z).toBeGreaterThan(0);
  });

  it("declares deterministic CAD Z=0 build-plane evidence", () => {
    expect(R14_ASSEMBLY.sceneEvidence).toEqual({
      cadAxisUp: "Z", worldAxisUp: "Z", cadZMinMm: 0, gridWorldZMm: 0,
      physicalBuildPlane: true, occurrenceCount: 4,
    });
  });
});
