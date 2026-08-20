import { describe, expect, it } from "vitest";
import {
  SAFETY_TRUTH,
  assertProjectIntegrity,
  assertPortableCustodyPacket,
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

  it("rejects malformed revision values before trusting a matching digest", () => {
    const revision = seedProject().revisions[0];
    expect(() => assertRevisionIntegrity({ ...revision, createdAt: "not-a-timestamp" })).toThrow(
      "revision timestamp is invalid",
    );
    expect(() => assertRevisionIntegrity({
      ...revision,
      parameters: { ...revision.parameters, base_thickness_mm: -1 },
    })).toThrow("revision parameter base_thickness_mm is invalid");
    expect(() => assertRevisionIntegrity({
      ...revision,
      parameters: { ...revision.parameters, leg_length_mm: 200 },
    })).toThrow("leg_length_mm must be between 40 and 160 mm");
    expect(() => assertRevisionIntegrity({
      ...revision,
      parameters: { ...revision.parameters, hole_diameter_mm: 20 },
    })).toThrow("hole_diameter_mm must leave at least 0.5 mm wall");
  });

  it("rejects unsafe lifecycle and foreign build evidence in portable custody", () => {
    const project = seedProject();
    const packet: Record<string, unknown> = {
      format: "piton-custody/v1",
      schema_version: 4,
      project: {
        id: project.id,
        name: project.name,
        accepted_revision_id: project.acceptedRevisionId,
        current_revision_id: project.currentRevisionId,
      },
      revisions: project.revisions,
      build_status: null,
      lifecycle_projection: [{
        kind: "fabrication_release",
        id: `release-${"1".repeat(64)}`,
        projectId: project.id,
        revisionId: project.currentRevisionId,
        approvalRecordId: `approval-${"2".repeat(64)}`,
        draftExportId: `export-${"3".repeat(64)}`,
        fabricationRelease: true,
        machineActuation: false,
        createdAt: "2026-08-20T00:00:00.000Z",
      }],
      environment_digest: `sha256-${"4".repeat(64)}`,
      exported_at: "2026-08-20T00:00:00.000Z",
    };
    expect(() => assertPortableCustodyPacket(packet)).toThrow("lifecycle root truth is invalid");

    packet.lifecycle_projection = [];
    packet.build_status = {
      projectId: "foreign-project",
      requestId: 1,
      binding: { baseRevisionId: project.currentRevisionId, previewDigest: project.currentRevisionId },
      state: "ready",
      message: "forged ready evidence",
    };
    expect(() => assertPortableCustodyPacket(packet)).toThrow("build status project authority mismatch");
  });

  it("rejects lifecycle references that cross revision custody", () => {
    const seeded = seedProject();
    const accepted = seeded.revisions[0];
    const candidate = deriveCandidateRevision(accepted, "leg_length_mm", 92);
    const hex = (character: string) => character.repeat(64);
    const packet = {
      format: "piton-custody/v1",
      schema_version: 4,
      project: {
        id: seeded.id,
        name: seeded.name,
        accepted_revision_id: accepted.id,
        current_revision_id: candidate.id,
      },
      revisions: [accepted, candidate],
      build_status: null,
      lifecycle_projection: [
        {
          kind: "build_attempt", id: `attempt-${hex("1")}`, projectId: seeded.id,
          revisionId: accepted.id, recipeDigest: hex("2"), state: "succeeded",
          createdAt: "2026-08-20T00:00:00.000Z",
        },
        {
          kind: "evidence_closure", id: `evidence-${hex("3")}`, projectId: seeded.id,
          revisionId: accepted.id, buildAttemptId: `attempt-${hex("1")}`,
          requirementIds: ["AC-01"], artifactDigests: [hex("4")],
          createdAt: "2026-08-20T00:01:00.000Z",
        },
        {
          kind: "approval_record", id: `approval-${hex("5")}`, projectId: seeded.id,
          revisionId: candidate.id, evidenceClosureId: `evidence-${hex("3")}`,
          decision: "deferred", reason: "requires human review",
          createdAt: "2026-08-20T00:02:00.000Z",
        },
      ],
      environment_digest: `sha256-${hex("6")}`,
      exported_at: "2026-08-20T00:03:00.000Z",
    };
    expect(() => assertPortableCustodyPacket(packet)).toThrow("approval evidence binding is invalid");
  });
});