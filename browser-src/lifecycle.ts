import type { CandidateCommand } from "./domain";

/** Closed browser-authority lifecycle records. Each kind has distinct SQLite custody. */
export type ChangeProposal = Readonly<{
  kind: "change_proposal";
  id: string;
  projectId: string;
  baseRevisionId: string;
  command: CandidateCommand;
  createdAt: string;
}>;

export type ProposalDisposition = Readonly<{
  kind: "proposal_disposition";
  id: string;
  projectId: string;
  proposalId: string;
  disposition: "changes_requested" | "accepted_for_build" | "accepted_for_review";
  reason: string;
  createdAt: string;
}>;

export type BuildAttempt = Readonly<{
  kind: "build_attempt";
  id: string;
  projectId: string;
  revisionId: string;
  recipeDigest: string;
  state: "admitted" | "running" | "succeeded" | "failed" | "blocked";
  createdAt: string;
}>;

export type EvidenceClosure = Readonly<{
  kind: "evidence_closure";
  id: string;
  projectId: string;
  revisionId: string;
  buildAttemptId: string;
  requirementIds: readonly string[];
  artifactDigests: readonly string[];
  createdAt: string;
}>;

export type ChannelPointer = Readonly<{
  kind: "channel_pointer";
  projectId: string;
  channel: "workspace" | "candidate" | "review";
  revisionId: string;
  version: number;
  updatedAt: string;
}>;

/** Stage 1 can record only rejection or deferral; it cannot issue approval. */
export type ApprovalRecord = Readonly<{
  kind: "approval_record";
  id: string;
  projectId: string;
  revisionId: string;
  evidenceClosureId: string;
  decision: "rejected" | "deferred";
  reason: string;
  createdAt: string;
}>;

export type DraftExport = Readonly<{
  kind: "draft_export";
  id: string;
  projectId: string;
  revisionId: string;
  evidenceClosureId: string;
  manifestDigest: string;
  releaseState: "unreleased";
  createdAt: string;
}>;

/** A Stage 1 release record is a durable rejection receipt, never a release grant. */
export type FabricationRelease = Readonly<{
  kind: "fabrication_release";
  id: string;
  projectId: string;
  revisionId: string;
  approvalRecordId: string;
  draftExportId: string;
  fabricationRelease: false;
  machineActuation: false;
  createdAt: string;
}>;

export type ReleasedPackageProjection = Readonly<{
  kind: "released_package_projection";
  id: string;
  projectId: string;
  fabricationReleaseId: string;
  packageDigest: string;
  fabricationRelease: false;
  machineActuation: false;
  createdAt: string;
}>;

export type LifecycleRecord =
  | ChangeProposal
  | ProposalDisposition
  | BuildAttempt
  | EvidenceClosure
  | ChannelPointer
  | ApprovalRecord
  | DraftExport
  | FabricationRelease
  | ReleasedPackageProjection;

export function assertLifecycleRecord(record: LifecycleRecord): void {
  if (!record || typeof record !== "object" || !("kind" in record)) throw new Error("invalid lifecycle record");
  const common = record as LifecycleRecord & { projectId?: string; createdAt?: string; updatedAt?: string };
  if (!common.projectId) throw new Error("lifecycle project id is invalid");
  const timestamp = common.createdAt ?? common.updatedAt;
  if (!timestamp || Number.isNaN(Date.parse(timestamp))) throw new Error("lifecycle timestamp is invalid");
  const digest = (value: string, label: string) => {
    if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(`${label} is not a canonical sha256 digest`);
  };
  const revision = (value: string) => {
    if (!/^rev-[0-9a-f]{64}$/.test(value)) throw new Error("lifecycle revision id is invalid");
  };
  const identity = (value: string, prefix: string) => {
    if (!new RegExp(`^${prefix}-[0-9a-f]{64}$`).test(value)) throw new Error(`lifecycle ${prefix} id is invalid`);
  };
  switch (record.kind) {
    case "change_proposal":
      identity(record.id, "proposal"); revision(record.baseRevisionId);
      if (record.command.type !== "set-leg-length" || !Number.isFinite(record.command.value)
        || record.command.value < 40 || record.command.value > 160) throw new Error("proposal command is invalid");
      break;
    case "proposal_disposition":
      identity(record.id, "disposition"); identity(record.proposalId, "proposal");
      if (!["changes_requested", "accepted_for_build", "accepted_for_review"].includes(record.disposition)) {
        throw new Error("proposal disposition is invalid");
      }
      if (!record.reason) throw new Error("proposal disposition reason is required");
      break;
    case "build_attempt":
      identity(record.id, "attempt"); revision(record.revisionId); digest(record.recipeDigest, "recipe digest");
      if (!["admitted", "running", "succeeded", "failed", "blocked"].includes(record.state)) {
        throw new Error("build attempt state is invalid");
      }
      break;
    case "evidence_closure":
      identity(record.id, "evidence"); revision(record.revisionId); identity(record.buildAttemptId, "attempt");
      if (!record.requirementIds.length || new Set(record.requirementIds).size !== record.requirementIds.length) {
        throw new Error("evidence requirements are invalid");
      }
      if (!record.artifactDigests.length) throw new Error("evidence artifacts are invalid");
      record.artifactDigests.forEach((value) => digest(value, "artifact digest"));
      break;
    case "channel_pointer":
      revision(record.revisionId);
      if (!["workspace", "candidate", "review"].includes(record.channel)) throw new Error("channel is invalid");
      if (!Number.isInteger(record.version) || record.version < 1) throw new Error("channel pointer version is invalid");
      break;
    case "approval_record":
      identity(record.id, "approval"); revision(record.revisionId); identity(record.evidenceClosureId, "evidence");
      break;
    case "draft_export":
      identity(record.id, "export"); revision(record.revisionId); identity(record.evidenceClosureId, "evidence");
      digest(record.manifestDigest, "manifest digest");
      if (record.releaseState !== "unreleased") throw new Error("lifecycle root truth is invalid");
      break;
    case "fabrication_release":
      if (record.fabricationRelease !== false || record.machineActuation !== false) throw new Error("lifecycle root truth is invalid");
      identity(record.id, "release"); revision(record.revisionId);
      break;
    case "released_package_projection":
      if (record.fabricationRelease !== false || record.machineActuation !== false) throw new Error("lifecycle root truth is invalid");
      identity(record.id, "projection"); digest(record.packageDigest, "package digest");
      break;
    default: {
      const unreachable: never = record;
      throw new Error(`unsupported lifecycle record ${(unreachable as { kind?: string }).kind ?? "unknown"}`);
    }
  }
}
