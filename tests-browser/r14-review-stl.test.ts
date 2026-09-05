import { describe, expect, it } from "vitest";
import {
  R14_FIXTURE,
  activateFixtureDocument,
  createFixtureSession,
  generateFixtureApproximateSource,
  generateFixtureReviewMeshStl,
  openFixtureDocument,
  updateFixtureDocumentView,
} from "../src/fixture";

describe("R14/H document-specific review STL acceptance", () => {
  it("derives distinct approximate source from each canonical document", () => {
    const sourceByDocument = R14_FIXTURE.documents.map(({ id, fileName }) => ({
      id,
      fileName,
      source: generateFixtureApproximateSource(id),
    }));

    expect(new Set(sourceByDocument.map(({ source }) => source)).size).toBe(sourceByDocument.length);
    for (const { fileName, source } of sourceByDocument) {
      expect(source).toContain(fileName);
      expect(source).toContain("document-specific approximate review source");
      expect(source).toContain("review_state=needs_human_review");
      expect(source).toContain("fabrication_release=false");
      expect(source).toContain("machine_actuation=false");
      expect(source).toContain("not exact B-rep or fabrication source");
    }
  });

  it("emits deterministic validated ASCII review-mesh STL for every canonical document", () => {
    const artifacts = R14_FIXTURE.documents.map(({ id }) => generateFixtureReviewMeshStl(id));

    expect(new Set(artifacts.map(({ text }) => text)).size).toBe(artifacts.length);
    for (const [index, artifact] of artifacts.entries()) {
      const document = R14_FIXTURE.documents[index];
      expect(artifact.documentId).toBe(document.id);
      expect(artifact.filename).toBe(`${document.id}-review-mesh.stl`);
      expect(artifact.byteLength).toBeGreaterThan(0);
      expect(artifact.facetCount).toBeGreaterThan(0);
      expect(artifact.text).toMatch(/^solid piton_/);
      expect(artifact.text).toMatch(/facet normal/);
      expect(artifact.text).toMatch(/endsolid piton_/);
      expect(artifact.text).toMatch(/^[\x00-\x7F]+$/);
      expect(artifact.bounds.min[2]).toBe(0);
      expect(artifact.validation).toEqual({
        ascii: true,
        nonempty: true,
        finite: true,
        cadZMinOnBuildPlane: true,
      });
      expect(artifact.claimScope).toMatch(/review mesh only/i);
      expect(artifact.claimScope).toMatch(/not fabrication release/i);
      expect(generateFixtureReviewMeshStl(document.id)).toEqual(artifact);
    }
  });

  it("keeps approximate-source visibility and STL evidence document-local", () => {
    let session = openFixtureDocument(createFixtureSession(), "guide-pin.part");
    const artifact = generateFixtureReviewMeshStl("guide-pin.part");
    session = updateFixtureDocumentView(session, "guide-pin.part", {
      approximateSourceVisible: true,
      stl: {
        state: "ready",
        artifactId: "review-mesh:guide-pin.part",
        filename: artifact.filename,
        byteLength: artifact.byteLength,
        facetCount: artifact.facetCount,
        cadZMinMm: artifact.bounds.min[2],
        message: "Ready · validated nonempty ASCII STL",
      },
    });
    session = activateFixtureDocument(session, "bench-clamp.assembly");

    expect(session.documentStates["guide-pin.part"]).toMatchObject({
      approximateSourceVisible: true,
      stl: { state: "ready", filename: "guide-pin.part-review-mesh.stl", cadZMinMm: 0 },
    });
    expect(session.documentStates["bench-clamp.assembly"]).toMatchObject({
      approximateSourceVisible: false,
      stl: { state: "idle" },
    });
  });
});
