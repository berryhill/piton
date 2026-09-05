import { describe, expect, it } from "vitest";
import {
  beginFixtureReviewMeasurement,
  cancelFixtureReviewMeasurement,
  createFixtureSession,
  recordFixtureReviewMeasurementPoint,
  updateFixtureReviewMeasurementHover,
} from "../src/fixture";

describe("R14/G two-point review-mesh measurement state", () => {
  it("starts clean, retains endpoint A through misses, and computes Euclidean millimetres", () => {
    let session = beginFixtureReviewMeasurement(createFixtureSession(), "bench-clamp.assembly");
    expect(session.documentStates["bench-clamp.assembly"]).toMatchObject({
      measurement: { phase: "armed" }, reviewMeasurementMm: null,
    });

    session = recordFixtureReviewMeasurementPoint(session, "bench-clamp.assembly", [1, 2, 3]);
    session = updateFixtureReviewMeasurementHover(session, "bench-clamp.assembly", [4, 6, 3]);
    expect(session.documentStates["bench-clamp.assembly"].measurement).toEqual({
      phase: "endpoint-a", endpointA: [1, 2, 3], hoverEndpoint: [4, 6, 3],
    });

    session = updateFixtureReviewMeasurementHover(session, "bench-clamp.assembly", null);
    expect(session.documentStates["bench-clamp.assembly"].measurement).toEqual({
      phase: "endpoint-a", endpointA: [1, 2, 3], hoverEndpoint: null,
    });

    session = recordFixtureReviewMeasurementPoint(session, "bench-clamp.assembly", [4, 6, 15]);
    expect(session.documentStates["bench-clamp.assembly"]).toMatchObject({
      measurement: { phase: "complete", endpointA: [1, 2, 3], endpointB: [4, 6, 15] },
      reviewMeasurementMm: 13,
    });
  });

  it("restarts and cancels without mutating authored or release state", () => {
    const original = createFixtureSession();
    let session = beginFixtureReviewMeasurement(original, "bench-clamp.assembly");
    session = recordFixtureReviewMeasurementPoint(session, "bench-clamp.assembly", [0, 0, 0]);
    session = beginFixtureReviewMeasurement(session, "bench-clamp.assembly");
    expect(session.documentStates["bench-clamp.assembly"].measurement).toEqual({ phase: "armed" });
    expect(session.documentStates["bench-clamp.assembly"].reviewMeasurementMm).toBeNull();

    session = cancelFixtureReviewMeasurement(session, "bench-clamp.assembly");
    expect(session.documentStates["bench-clamp.assembly"].measurement).toEqual({ phase: "idle" });
    expect(session.documentStates["bench-clamp.assembly"].reviewMeasurementMm).toBeNull();
    expect(session.openDocumentIds).toEqual(original.openDocumentIds);
    expect(session.requestSession).toEqual(original.requestSession);
  });

  it("rejects stale document context, non-finite points, and points outside an active measurement", () => {
    const session = createFixtureSession();
    expect(() => beginFixtureReviewMeasurement(session, "base-plate.part")).toThrow(/stale or inactive/);
    expect(() => recordFixtureReviewMeasurementPoint(session, "bench-clamp.assembly", [0, 0, 0])).toThrow(/not active/);
    const armed = beginFixtureReviewMeasurement(session, "bench-clamp.assembly");
    expect(() => recordFixtureReviewMeasurementPoint(armed, "bench-clamp.assembly", [0, Number.NaN, 0])).toThrow(/finite/);
  });
});
