import { describe, expect, it } from "vitest";
import {
  SAFETY_TRUTH,
  assertProjectIntegrity,
  assertRevisionIntegrity,
  deriveCandidateRevision,
  seedProject,
} from "../browser-src/domain";

describe("browser authority domain", () => {
  it("derives an immutable candidate without mutating the accepted revision", () => {
    const project = seedProject();
    const accepted = project.revisions[0];
    const candidate = deriveCandidateRevision(accepted, "leg_length_mm", 92);

    expect(accepted.parameters.leg_length_mm).toBe(80);
    expect(candidate.parameters.leg_length_mm).toBe(92);
    expect(candidate.parentRevisionId).toBe(accepted.id);
    expect(candidate.id).not.toBe(accepted.id);
    expect(candidate.reviewState).toBe("needs_human_review");
  });

  it("rejects an out-of-bounds mutation", () => {
    const accepted = seedProject().revisions[0];
    expect(() => deriveCandidateRevision(accepted, "leg_length_mm", 201)).toThrow(
      "leg_length_mm must be between 40 and 160 mm",
    );
  });

  it("cannot escalate release or machine truth during derivation", () => {
    const candidate = deriveCandidateRevision(seedProject().revisions[0], "leg_length_mm", 90);
    expect(candidate.fabricationRelease).toBe(false);
    expect(candidate.machineActuation).toBe(false);
    expect(candidate.releaseState).toBe("unreleased");
    expect(SAFETY_TRUTH).toEqual({
      reviewState: "needs_human_review",
      fabricationRelease: false,
      machineActuation: false,
      releaseState: "unreleased",
    });
  });

  it("uses a canonical collision-resistant digest and rejects a forged identity", () => {
    const seeded = seedProject();
    expect(seeded.revisions[0].id).toBe("rev-ae7359f7614394cf32a8eb929559886712e9461712d0f8096570704772c36c75");
    const candidate = deriveCandidateRevision(seeded.revisions[0], "leg_length_mm", 90);
    expect(candidate.id).toMatch(/^rev-[0-9a-f]{64}$/);
    expect(() => assertRevisionIntegrity({ ...candidate, parameters: { ...candidate.parameters, leg_length_mm: 91 } })).toThrow(
      "revision digest does not match its body",
    );
  });

  it("rejects invalid project pointers and parent links", () => {
    const project = seedProject();
    expect(() => assertProjectIntegrity({ ...project, currentRevisionId: "rev-missing" })).toThrow("current revision pointer is invalid");
    expect(() => assertProjectIntegrity({
      ...project,
      revisions: [{ ...project.revisions[0], parentRevisionId: "rev-missing" }],
    })).toThrow();
    expect(() => assertProjectIntegrity({ ...project, revisions: [...project.revisions, project.revisions[0]] })).toThrow(
      "conflicting revision identity",
    );
  });
});