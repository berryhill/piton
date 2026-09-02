import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  assemblySelectionOccurrenceIds,
  createAssemblyReviewRoot,
  resolveAssemblyReviewPick,
} from "../src/components/AssemblyViewport";
import { R14_ASSEMBLY } from "../src/assembly";

function reviewMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) meshes.push(object);
  });
  return meshes;
}

describe("Assembly viewport semantic picking", () => {
  it("maps every visible review primitive to its canonical occurrence in Smart and Component modes", () => {
    const root = createAssemblyReviewRoot();
    const meshes = reviewMeshes(root);

    for (const occurrence of R14_ASSEMBLY.occurrences) {
      const primitive = meshes.find(({ userData }) => userData.occurrenceId === occurrence.id);
      expect(primitive, occurrence.id).toBeDefined();
      const intersections = [{ object: primitive! }];
      expect(resolveAssemblyReviewPick(intersections, "smart")).toBe(occurrence.id);
      expect(resolveAssemblyReviewPick(intersections, "component")).toBe(occurrence.id);
    }

    const jawIds = meshes
      .filter(({ userData }) => userData.sourceDocumentId === "clamp-jaw.part")
      .map((object) => resolveAssemblyReviewPick([{ object }], "component"));
    expect(new Set(jawIds)).toEqual(new Set(["component:clamp-jaw:1", "component:clamp-jaw:2"]));
  });

  it("emits only predeclared occurrence-qualified contextual faces in Face mode", () => {
    const root = createAssemblyReviewRoot();
    for (const primitive of reviewMeshes(root)) {
      const picked = resolveAssemblyReviewPick([{ object: primitive }], "face");
      expect(R14_ASSEMBLY.contextualFaces.some(({ id }) => id === picked)).toBe(true);
      expect(picked).toMatch(`contextual-face:${primitive.userData.occurrenceId}:`);
    }

    const unmapped = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    unmapped.userData = { occurrenceId: "component:clamp-jaw:1", contextualFaceId: "contextual-face:invented" };
    expect(resolveAssemblyReviewPick([{ object: unmapped }], "face")).toBeNull();
    expect(resolveAssemblyReviewPick([], "face")).toBeNull();
  });

  it("resolves occurrence and contextual-face highlights without conflating repeated Parts", () => {
    expect(assemblySelectionOccurrenceIds("component:clamp-jaw:1")).toEqual(["component:clamp-jaw:1"]);
    expect(assemblySelectionOccurrenceIds("contextual-face:component:clamp-jaw:2:jaw-grip")).toEqual(["component:clamp-jaw:2"]);
    expect(assemblySelectionOccurrenceIds("mate:jaw-spacing")).toEqual([
      "component:clamp-jaw:1",
      "component:clamp-jaw:2",
    ]);
    expect(assemblySelectionOccurrenceIds("contextual-face:component:clamp-jaw:3:jaw-grip")).toEqual([]);
  });
});
