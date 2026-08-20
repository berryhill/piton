import type { LifecycleRecord } from "./lifecycle";
import { assertLifecycleRecord } from "./lifecycle";

export const SAFETY_TRUTH = Object.freeze({
  reviewState: "needs_human_review" as const,
  fabricationRelease: false as const,
  machineActuation: false as const,
  releaseState: "unreleased" as const,
});

export interface LBracketParameters {
  leg_length_mm: number;
  leg_width_mm: number;
  base_length_mm: number;
  base_thickness_mm: number;
  leg_thickness_mm: number;
  hole_diameter_mm: number;
}

export function validateLBracketParameters(value: Readonly<object>): string | null {
  const input = value as Readonly<Record<string, unknown>>;
  const bounds: Readonly<Record<keyof LBracketParameters, readonly [number, number]>> = {
    leg_length_mm: [40, 160],
    leg_width_mm: [5, 300],
    base_length_mm: [5, 300],
    base_thickness_mm: [1, 50],
    leg_thickness_mm: [1.5, 50],
    hole_diameter_mm: [0.5, 49],
  };
  for (const key of Object.keys(bounds) as (keyof LBracketParameters)[]) {
    const parameter = input[key];
    if (typeof parameter !== "number" || !Number.isFinite(parameter) || parameter <= 0) {
      return `revision parameter ${key} is invalid`;
    }
    const [minimum, maximum] = bounds[key];
    if (parameter < minimum || parameter > maximum) {
      return key === "leg_length_mm"
        ? "leg_length_mm must be between 40 and 160 mm"
        : `${key} must be between ${minimum} and ${maximum} mm`;
    }
  }
  const parameters = value as unknown as LBracketParameters;
  if (parameters.base_thickness_mm >= parameters.leg_length_mm) {
    return "base_thickness_mm must be less than leg_length_mm";
  }
  if (parameters.leg_thickness_mm >= parameters.base_length_mm) {
    return "leg_thickness_mm must be less than base_length_mm";
  }
  if (parameters.hole_diameter_mm > parameters.leg_thickness_mm - 1) {
    return "hole_diameter_mm must leave at least 0.5 mm wall in the vertical leg";
  }
  if (parameters.hole_diameter_mm >= Math.min(parameters.leg_width_mm, parameters.leg_length_mm * 0.7)) {
    return "hole_diameter_mm does not fit within the vertical leg";
  }
  return null;
}

export interface DesignRevision {
  id: string;
  parentRevisionId: string | null;
  createdAt: string;
  authorityProfile: "browser-typescript/v1";
  parameters: Readonly<LBracketParameters>;
  reviewState: "needs_human_review";
  fabricationRelease: false;
  machineActuation: false;
  releaseState: "unreleased";
}

export interface BrowserProject {
  id: string;
  name: string;
  acceptedRevisionId: string;
  currentRevisionId: string;
  revisions: DesignRevision[];
}

export type CandidateCommand = Readonly<{ type: "set-leg-length"; value: number }>;

export const PORTABLE_CUSTODY_FORMAT = "piton-custody/v1" as const;

export interface PortableCustodyProject {
  id: string;
  name: string;
  accepted_revision_id: string;
  current_revision_id: string;
}

export interface PortableCustodyPacket {
  format: typeof PORTABLE_CUSTODY_FORMAT;
  schema_version: number;
  project: PortableCustodyProject;
  revisions: DesignRevision[];
  build_status: unknown;
  lifecycle_projection: ReadonlyArray<unknown>;
  environment_digest: string;
  exported_at: string;
}

export interface PortableCustodyEnvelope extends PortableCustodyPacket {
  fingerprint: string;
}

export interface CadCommandRequest {
  format: "piton-command/v1";
  projectId: string;
  expectedCurrentRevisionId: string;
  idempotencyKey: string;
  command: Readonly<{
    type: "set-leg-length";
    quantity: Readonly<{ value: number; unit: "mm" }>;
  }>;
}

export interface CadCommandReceipt {
  format: "piton-command-receipt/v1";
  projectId: string;
  baseRevisionId: string;
  resultingRevisionId: string;
  canonicalRequestDigest: string;
  authorityProfile: "browser-typescript/v1";
  reviewState: "needs_human_review";
  fabricationRelease: false;
  machineActuation: false;
  releaseState: "unreleased";
}

export const DEFAULT_PARAMETERS: Readonly<LBracketParameters> = Object.freeze({
  leg_length_mm: 80,
  leg_width_mm: 40,
  base_length_mm: 120,
  base_thickness_mm: 8,
  leg_thickness_mm: 8,
  hole_diameter_mm: 6.5,
});

function canonicalRevisionBody(revision: Omit<DesignRevision, "id">): string {
  const parameters = Object.entries(revision.parameters).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify({
    parentRevisionId: revision.parentRevisionId,
    createdAt: revision.createdAt,
    authorityProfile: revision.authorityProfile,
    parameters,
    reviewState: revision.reviewState,
    fabricationRelease: revision.fabricationRelease,
    machineActuation: revision.machineActuation,
    releaseState: revision.releaseState,
  });
}

// Synchronous SHA-256 keeps content-addressed revision construction usable during React render
// while providing a collision-resistant digest in browsers without a Node.js dependency.
export function sha256Hex(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const rotate = (value: number, amount: number) => (value >>> amount) | (value << (32 - amount));
  const w = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotate(w[i - 15], 7) ^ rotate(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotate(w[i - 2], 17) ^ rotate(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i += 1) {
      const s1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + s1 + ch + k[i] + w[i]) >>> 0;
      const s0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    [a, b, c, d, e, f, g, hh].forEach((value, i) => { h[i] = (h[i] + value) >>> 0; });
  }
  return h.map((value) => value.toString(16).padStart(8, "0")).join("");
}

function revisionId(revision: Omit<DesignRevision, "id">): string {
  return `rev-${sha256Hex(canonicalRevisionBody(revision))}`;
}

function makeRevision(parentRevisionId: string | null, parameters: LBracketParameters, createdAt: string): DesignRevision {
  const body = {
    parentRevisionId,
    createdAt,
    authorityProfile: "browser-typescript/v1" as const,
    parameters: Object.freeze({ ...parameters }),
    ...SAFETY_TRUTH,
  };
  return Object.freeze({ id: revisionId(body), ...body });
}

export function seedProject(): BrowserProject {
  const accepted = makeRevision(null, { ...DEFAULT_PARAMETERS }, "2026-08-13T00:00:00.000Z");
  return {
    id: "piton-seeded-l-bracket",
    name: "Seeded L-bracket",
    acceptedRevisionId: accepted.id,
    currentRevisionId: accepted.id,
    revisions: [accepted],
  };
}

export function deriveCandidateRevision(base: DesignRevision, parameter: "leg_length_mm", value: number): DesignRevision {
  if (!Number.isFinite(value) || value < 40 || value > 160) {
    throw new Error("leg_length_mm must be between 40 and 160 mm");
  }
  return makeRevision(base.id, { ...base.parameters, [parameter]: value }, new Date().toISOString());
}

export function deriveCandidateFromCommand(base: DesignRevision, command: CandidateCommand): DesignRevision {
  if (command.type !== "set-leg-length") throw new Error("unsupported candidate command");
  return deriveCandidateRevision(base, "leg_length_mm", command.value);
}

export function assertRevisionIntegrity(revision: DesignRevision): void {
  const revisionKeys = [
    "id", "parentRevisionId", "createdAt", "authorityProfile", "parameters",
    "reviewState", "fabricationRelease", "machineActuation", "releaseState",
  ].sort();
  const parameterKeys = [
    "leg_length_mm", "leg_width_mm", "base_length_mm", "base_thickness_mm",
    "leg_thickness_mm", "hole_diameter_mm",
  ].sort();
  if (!revision || typeof revision !== "object" || Array.isArray(revision)
    || Object.keys(revision).sort().join("\u0000") !== revisionKeys.join("\u0000")) {
    throw new Error("revision record keys are invalid");
  }
  if (!revision.parameters || typeof revision.parameters !== "object" || Array.isArray(revision.parameters)
    || Object.keys(revision.parameters).sort().join("\u0000") !== parameterKeys.join("\u0000")) {
    throw new Error("revision parameter keys are invalid");
  }
  if (!/^rev-[0-9a-f]{64}$/.test(revision.id)
    || (revision.parentRevisionId !== null && !/^rev-[0-9a-f]{64}$/.test(revision.parentRevisionId))) {
    throw new Error("revision identity is invalid");
  }
  if (typeof revision.createdAt !== "string" || Number.isNaN(Date.parse(revision.createdAt))) {
    throw new Error("revision timestamp is invalid");
  }
  const parameterError = validateLBracketParameters(revision.parameters);
  if (parameterError) throw new Error(parameterError);
  if (revision.authorityProfile !== "browser-typescript/v1"
    || revision.reviewState !== "needs_human_review"
    || revision.fabricationRelease !== false
    || revision.machineActuation !== false
    || revision.releaseState !== "unreleased") {
    throw new Error("revision safety or authority truth is invalid");
  }
  const { id: _id, ...body } = revision;
  if (idForBody(body) !== revision.id) throw new Error("revision digest does not match its body");
}

function idForBody(body: Omit<DesignRevision, "id">): string {
  return revisionId(body);
}

export function assertProjectIntegrity(project: BrowserProject): void {
  if (!project.revisions.length) throw new Error("project has no revisions");
  const ids = new Set<string>();
  for (const revision of project.revisions) {
    assertRevisionIntegrity(revision);
    if (ids.has(revision.id)) throw new Error("conflicting revision identity");
    ids.add(revision.id);
  }
  if (!ids.has(project.acceptedRevisionId)) throw new Error("accepted revision pointer is invalid");
  if (!ids.has(project.currentRevisionId)) throw new Error("current revision pointer is invalid");
  for (const revision of project.revisions) {
    if (revision.parentRevisionId !== null && !ids.has(revision.parentRevisionId)) throw new Error("revision parent pointer is invalid");
  }
  const accepted = project.revisions.find((revision) => revision.id === project.acceptedRevisionId)!;
  if (accepted.parentRevisionId !== null) throw new Error("accepted revision must be a root revision");
}

// Closed keys for every level of the portable custody envelope. The validator
// enforces these lists verbatim; any drift is a strict reject.
const PORTABLE_PACKET_KEYS = [
  "build_status", "environment_digest", "exported_at", "format",
  "lifecycle_projection", "project", "revisions", "schema_version",
].sort();
const PORTABLE_PROJECT_KEYS = [
  "accepted_revision_id", "current_revision_id", "id", "name",
].sort();
const PORTABLE_REVISION_KEYS = [
  "authorityProfile", "createdAt", "fabricationRelease", "id",
  "machineActuation", "parameters", "parentRevisionId", "releaseState",
  "reviewState",
].sort();
const PORTABLE_PARAMETER_KEYS = [
  "base_length_mm", "base_thickness_mm", "hole_diameter_mm",
  "leg_length_mm", "leg_thickness_mm", "leg_width_mm",
].sort();

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function assertPortableCustodyPacket(input: unknown): asserts input is PortableCustodyPacket {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("portable custody envelope is not an object");
  }
  const record = input as Record<string, unknown>;
  if (!hasExactKeys(record, PORTABLE_PACKET_KEYS)) {
    throw new Error("portable custody envelope keys are invalid");
  }
  if (record.format !== PORTABLE_CUSTODY_FORMAT) {
    throw new Error("portable custody format is not piton-custody/v1");
  }
  if (!isFiniteNumber(record.schema_version) || !Number.isInteger(record.schema_version)) {
    throw new Error("portable custody schema_version is not an integer");
  }
  if (!record.project || typeof record.project !== "object" || Array.isArray(record.project)) {
    throw new Error("portable custody project is not an object");
  }
  const project = record.project as Record<string, unknown>;
  if (!hasExactKeys(project, PORTABLE_PROJECT_KEYS)) {
    throw new Error("portable custody project keys are invalid");
  }
  if (!isNonEmptyString(project.id) || !isNonEmptyString(project.name)) {
    throw new Error("portable custody project identity is invalid");
  }
  if (!isNonEmptyString(project.accepted_revision_id) || !isNonEmptyString(project.current_revision_id)) {
    throw new Error("portable custody project pointer is invalid");
  }
  if (!Array.isArray(record.revisions) || record.revisions.length === 0) {
    throw new Error("portable custody revisions must be a non-empty array");
  }
  const revisionIds = new Set<string>();
  for (const revision of record.revisions) {
    if (!revision || typeof revision !== "object" || Array.isArray(revision)) {
      throw new Error("portable custody revision is not an object");
    }
    const revRecord = revision as Record<string, unknown>;
    if (!hasExactKeys(revRecord, PORTABLE_REVISION_KEYS)) {
      throw new Error("portable custody revision keys are invalid");
    }
    if (!revRecord.parameters || typeof revRecord.parameters !== "object" || Array.isArray(revRecord.parameters)) {
      throw new Error("portable custody revision parameters are not an object");
    }
    const params = revRecord.parameters as Record<string, unknown>;
    if (!hasExactKeys(params, PORTABLE_PARAMETER_KEYS)) {
      throw new Error("portable custody revision parameter keys are invalid");
    }
    if (revisionIds.has(String(revRecord.id))) {
      throw new Error("portable custody revision identity is duplicated");
    }
    revisionIds.add(String(revRecord.id));
  }
  for (const revision of record.revisions) {
    assertRevisionIntegrity(revision as DesignRevision);
  }
  if (!revisionIds.has(String(project.accepted_revision_id))) {
    throw new Error("portable custody accepted revision does not resolve");
  }
  if (!revisionIds.has(String(project.current_revision_id))) {
    throw new Error("portable custody current revision does not resolve");
  }
  for (const revision of record.revisions) {
    const parent = (revision as DesignRevision).parentRevisionId;
    if (parent !== null && !revisionIds.has(parent)) {
      throw new Error("portable custody revision parent pointer is invalid");
    }
  }
  const accepted = record.revisions.find(
    (revision) => (revision as DesignRevision).id === project.accepted_revision_id,
  ) as DesignRevision;
  if (accepted.parentRevisionId !== null) {
    throw new Error("portable custody accepted revision must be a root revision");
  }
  if (!isNonEmptyString(record.environment_digest)) {
    throw new Error("portable custody environment_digest is invalid");
  }
  if (!isNonEmptyString(record.exported_at) || Number.isNaN(Date.parse(record.exported_at))) {
    throw new Error("portable custody exported_at is invalid");
  }
  if (!Array.isArray(record.lifecycle_projection)) {
    throw new Error("portable custody lifecycle_projection must be an array");
  }
  const lifecycle = record.lifecycle_projection as LifecycleRecord[];
  for (const entry of lifecycle) {
    assertLifecycleRecord(entry);
    if (entry.projectId !== project.id) throw new Error("lifecycle project authority mismatch");
    if ("revisionId" in entry && !revisionIds.has(entry.revisionId)) {
      throw new Error("lifecycle revision reference is missing");
    }
    if (entry.kind === "change_proposal" && !revisionIds.has(entry.baseRevisionId)) {
      throw new Error("lifecycle revision reference is missing");
    }
  }
  const byIdentity = new Map<string, LifecycleRecord>();
  for (const entry of lifecycle) {
    if ("id" in entry) {
      if (byIdentity.has(entry.id)) throw new Error("duplicate lifecycle identity");
      byIdentity.set(entry.id, entry);
    }
  }
  for (const entry of lifecycle) {
    if (entry.kind === "proposal_disposition" && byIdentity.get(entry.proposalId)?.kind !== "change_proposal") {
      throw new Error("proposal disposition reference is missing");
    }
    if (entry.kind === "evidence_closure") {
      const attempt = byIdentity.get(entry.buildAttemptId);
      if (!attempt || attempt.kind !== "build_attempt" || attempt.state !== "succeeded"
        || attempt.projectId !== entry.projectId || attempt.revisionId !== entry.revisionId) {
        throw new Error("evidence build attempt binding is invalid");
      }
    }
    if (entry.kind === "approval_record") {
      const evidence = byIdentity.get(entry.evidenceClosureId);
      if (!evidence || evidence.kind !== "evidence_closure"
        || evidence.projectId !== entry.projectId || evidence.revisionId !== entry.revisionId) {
        throw new Error("approval evidence binding is invalid");
      }
    }
    if (entry.kind === "draft_export") {
      const evidence = byIdentity.get(entry.evidenceClosureId);
      if (!evidence || evidence.kind !== "evidence_closure"
        || evidence.projectId !== entry.projectId || evidence.revisionId !== entry.revisionId) {
        throw new Error("draft export evidence binding is invalid");
      }
    }
    if (entry.kind === "fabrication_release") {
      const approval = byIdentity.get(entry.approvalRecordId);
      const draft = byIdentity.get(entry.draftExportId);
      if (!approval || approval.kind !== "approval_record" || approval.projectId !== entry.projectId
        || approval.revisionId !== entry.revisionId || !draft || draft.kind !== "draft_export"
        || draft.projectId !== entry.projectId || draft.revisionId !== entry.revisionId
        || approval.evidenceClosureId !== draft.evidenceClosureId) {
        throw new Error("fabrication release binding is invalid");
      }
    }
    if (entry.kind === "released_package_projection"
      && byIdentity.get(entry.fabricationReleaseId)?.kind !== "fabrication_release") {
      throw new Error("released package reference is missing");
    }
  }
  if (record.build_status !== null && record.build_status !== undefined) {
    if (typeof record.build_status !== "object" || Array.isArray(record.build_status)) {
      throw new Error("portable custody build_status is invalid");
    }
    const status = record.build_status as Record<string, unknown>;
    if (!hasExactKeys(status, ["projectId", "requestId", "binding", "state", "message"])
      || status.projectId !== project.id) {
      throw new Error("build status project authority mismatch");
    }
    if (!Number.isInteger(status.requestId) || Number(status.requestId) < 0
      || !["idle", "previewing", "ready", "failed"].includes(String(status.state))
      || typeof status.message !== "string"
      || !status.binding || typeof status.binding !== "object" || Array.isArray(status.binding)) {
      throw new Error("portable custody build_status is invalid");
    }
    const binding = status.binding as Record<string, unknown>;
    if (!hasExactKeys(binding, ["baseRevisionId", "previewDigest"])
      || binding.baseRevisionId !== project.current_revision_id
      || (binding.previewDigest !== project.current_revision_id
        && !/^preview-[0-9a-f]{64}$/.test(String(binding.previewDigest)))) {
      throw new Error("build status binding is invalid");
    }
  }
}

// Deterministic canonical JSON used for the portable custody fingerprint.
// The same algorithm is intentionally reused for the command envelope to keep
// the canonicalization surface closed; portable custody never reuses the
// command-specific shape, only the key-sorting and NFC string normalization.
export function canonicalPortableCustodyJson(packet: PortableCustodyPacket): string {
  return `${JSON.stringify(canonicalPortableCustodyValue(packet))}\n`;
}

function canonicalPortableCustodyValue(value: unknown): unknown {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("portable custody canonical JSON rejects non-finite numbers");
    return value;
  }
  if (typeof value === "string") return value.normalize("NFC");
  if (Array.isArray(value)) return value.map(canonicalPortableCustodyValue);
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      if (record[key] === undefined) throw new Error("portable custody canonical JSON rejects undefined values");
      output[key.normalize("NFC")] = canonicalPortableCustodyValue(record[key]);
    }
    return output;
  }
  throw new Error("portable custody canonical JSON value is unsupported");
}
