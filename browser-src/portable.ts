import type { BrowserProject, DesignRevision } from "./domain";
import { SAFETY_TRUTH, assertProjectIntegrity, sha256Hex } from "./domain";
import type { LifecycleRecord } from "./lifecycle";
import { assertLifecycleRecord } from "./lifecycle";

export const PORTABLE_FORMAT = "piton-portable-custody/v1" as const;
export const CANONICALIZATION = "piton-canonical-json/v1" as const;
const PORTABLE_CLAIM_SCOPE_EXCLUSIONS = [
  "approval", "build/display cache", "exact B-rep", "fabrication release", "geometry derivatives",
  "machine actuation", "raw SQLite/OPFS", "review acceptance", "secrets", "viewer state",
] as const;

export interface PortableRecord {
  path: string;
  mediaType: "application/json";
  content: string;
}

export interface PortableCustodyPacket {
  manifest: string;
  records: PortableRecord[];
}

interface PortableManifest {
  format: typeof PORTABLE_FORMAT;
  canonicalization: typeof CANONICALIZATION;
  projectId: string;
  authorityProfile: "browser-typescript/v1";
  rootSafetyTruth: typeof SAFETY_TRUTH;
  claimScopeExclusions: string[];
  files: Array<{ path: string; mediaType: "application/json"; byteLength: number; digest: string }>;
}

function canonicalValue(value: unknown): unknown {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("canonical JSON rejects non-finite numbers");
    return value;
  }
  if (typeof value === "string") return value.normalize("NFC");
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      if (record[key] === undefined) throw new Error("canonical JSON rejects undefined values");
      output[key.normalize("NFC")] = canonicalValue(record[key]);
    }
    return output;
  }
  throw new Error("canonical JSON value is unsupported");
}

export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(canonicalValue(value))}\n`;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function lifecycleIdentity(record: LifecycleRecord): string {
  return record.kind === "channel_pointer" ? `channel-${record.channel}` : record.id;
}

function safePath(path: string): boolean {
  return /^[a-z0-9][a-z0-9._/-]*$/.test(path)
    && !path.startsWith("/") && !path.includes("//")
    && !path.split("/").some((segment) => segment === "." || segment === "..");
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === [...expected].sort()[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function exportPortableCustody(project: BrowserProject, lifecycleRecords: readonly LifecycleRecord[]): PortableCustodyPacket {
  assertProjectIntegrity(project);
  lifecycleRecords.forEach(assertLifecycleRecord);
  const portableLifecycleRecords = lifecycleRecords.filter((record) => record.kind !== "proposal_disposition"
    || record.disposition === "changes_requested");
  const records: PortableRecord[] = [{
    path: "project.json",
    mediaType: "application/json",
    content: canonicalJson({
      id: project.id,
      name: project.name,
      acceptedRevisionId: project.acceptedRevisionId,
      currentRevisionId: project.currentRevisionId,
      revisionIds: project.revisions.map((revision) => revision.id),
      lifecyclePaths: portableLifecycleRecords
        .map((record) => `lifecycle/${record.kind}/${lifecycleIdentity(record)}.json`)
        .sort(),
    }),
  }];
  for (const revision of project.revisions) {
    records.push({ path: `revisions/${revision.id}.json`, mediaType: "application/json", content: canonicalJson(revision) });
  }
  for (const record of portableLifecycleRecords) {
    records.push({
      path: `lifecycle/${record.kind}/${lifecycleIdentity(record)}.json`,
      mediaType: "application/json",
      content: canonicalJson(record),
    });
  }
  records.sort((left, right) => left.path.localeCompare(right.path));
  const manifest: PortableManifest = {
    format: PORTABLE_FORMAT,
    canonicalization: CANONICALIZATION,
    projectId: project.id,
    authorityProfile: "browser-typescript/v1",
    rootSafetyTruth: SAFETY_TRUTH,
    claimScopeExclusions: [...PORTABLE_CLAIM_SCOPE_EXCLUSIONS],
    files: records.map((record) => ({
      path: record.path,
      mediaType: record.mediaType,
      byteLength: byteLength(record.content),
      digest: `sha256-${sha256Hex(record.content)}`,
    })),
  };
  return { manifest: canonicalJson(manifest), records };
}

export function parsePortableCustody(packet: unknown): { project: BrowserProject; lifecycleRecords: LifecycleRecord[] } {
  if (!isRecord(packet) || !exactKeys(packet, ["manifest", "records"])
    || typeof packet.manifest !== "string" || !Array.isArray(packet.records)) {
    throw new Error("invalid portable custody envelope");
  }
  let manifestValue: unknown;
  try { manifestValue = JSON.parse(packet.manifest); } catch { throw new Error("invalid portable manifest JSON"); }
  if (!isRecord(manifestValue)) throw new Error("invalid portable manifest");
  if (manifestValue.format !== PORTABLE_FORMAT) throw new Error("unsupported portable format");
  if (manifestValue.canonicalization !== CANONICALIZATION) throw new Error("unsupported portable canonicalization");
  if (packet.manifest !== canonicalJson(manifestValue)) throw new Error("portable manifest is not canonical JSON");
  if (!exactKeys(manifestValue, ["format", "canonicalization", "projectId", "authorityProfile", "rootSafetyTruth", "claimScopeExclusions", "files"])
    || manifestValue.authorityProfile !== "browser-typescript/v1"
    || canonicalJson(manifestValue.rootSafetyTruth) !== canonicalJson(SAFETY_TRUTH)
    || !Array.isArray(manifestValue.files)) {
    throw new Error("portable manifest authority or safety truth is invalid");
  }
  if (canonicalJson(manifestValue.claimScopeExclusions) !== canonicalJson(PORTABLE_CLAIM_SCOPE_EXCLUSIONS)) {
    throw new Error("portable manifest claim scope is invalid");
  }

  const records = packet.records as unknown[];
  const byPath = new Map<string, unknown>();
  for (const raw of records) {
    if (!isRecord(raw) || !exactKeys(raw, ["path", "mediaType", "content"])
      || typeof raw.path !== "string" || raw.mediaType !== "application/json" || typeof raw.content !== "string") {
      throw new Error("invalid portable record envelope");
    }
    if (!safePath(raw.path)) throw new Error("unsafe portable path");
    if (byPath.has(raw.path)) throw new Error("duplicate portable path");
    let parsed: unknown;
    try { parsed = JSON.parse(raw.content); } catch { throw new Error("invalid portable record JSON"); }
    if (raw.content !== canonicalJson(parsed)) throw new Error("portable record is not canonical JSON");
    byPath.set(raw.path, parsed);
  }
  const files = manifestValue.files as unknown[];
  if (files.length !== byPath.size) throw new Error("portable record inventory mismatch");
  for (const raw of files) {
    if (!isRecord(raw) || !exactKeys(raw, ["path", "mediaType", "byteLength", "digest"])
      || typeof raw.path !== "string" || raw.mediaType !== "application/json"
      || typeof raw.byteLength !== "number" || typeof raw.digest !== "string") throw new Error("invalid portable file inventory");
    const record = records.find((candidate) => isRecord(candidate) && candidate.path === raw.path) as PortableRecord | undefined;
    if (!record || byteLength(record.content) !== raw.byteLength || `sha256-${sha256Hex(record.content)}` !== raw.digest) {
      throw new Error("portable record digest or length mismatch");
    }
  }
  const projectRecord = byPath.get("project.json");
  if (!isRecord(projectRecord) || !exactKeys(projectRecord, ["id", "name", "acceptedRevisionId", "currentRevisionId", "revisionIds", "lifecyclePaths"])
    || typeof projectRecord.id !== "string" || typeof projectRecord.name !== "string"
    || typeof projectRecord.acceptedRevisionId !== "string" || typeof projectRecord.currentRevisionId !== "string"
    || !Array.isArray(projectRecord.revisionIds) || !Array.isArray(projectRecord.lifecyclePaths)) {
    throw new Error("invalid portable project record");
  }
  if (manifestValue.projectId !== projectRecord.id) throw new Error("portable project identity mismatch");
  const declaredPaths = ["project.json", ...projectRecord.revisionIds.map((id) => `revisions/${String(id)}.json`), ...projectRecord.lifecyclePaths.map(String)].sort();
  if (canonicalJson(declaredPaths) !== canonicalJson([...byPath.keys()].sort())) throw new Error("portable record inventory is undeclared or missing");
  const revisions = projectRecord.revisionIds.map((id) => {
    const revision = byPath.get(`revisions/${String(id)}.json`);
    if (!isRecord(revision) || revision.id !== id) throw new Error("portable revision identity mismatch");
    return revision as unknown as DesignRevision;
  });
  const project: BrowserProject = {
    id: projectRecord.id,
    name: projectRecord.name,
    acceptedRevisionId: projectRecord.acceptedRevisionId,
    currentRevisionId: projectRecord.currentRevisionId,
    revisions,
  };
  assertProjectIntegrity(project);
  const lifecycleRecords = projectRecord.lifecyclePaths.map((path) => {
    if (typeof path !== "string" || !path.startsWith("lifecycle/")) throw new Error("invalid lifecycle path");
    const record = byPath.get(path) as LifecycleRecord | undefined;
    if (!record) throw new Error("missing lifecycle record");
    assertLifecycleRecord(record);
    if (record.kind === "proposal_disposition" && record.disposition !== "changes_requested") {
      throw new Error("portable proposal acceptance is not admissible");
    }
    if (record.projectId !== project.id || path !== `lifecycle/${record.kind}/${lifecycleIdentity(record)}.json`) {
      throw new Error("portable lifecycle identity mismatch");
    }
    return record;
  });
  validateLifecycleClosure(project, lifecycleRecords);
  return { project, lifecycleRecords };
}

function validateLifecycleClosure(project: BrowserProject, records: readonly LifecycleRecord[]): void {
  const revisionIds = new Set(project.revisions.map((revision) => revision.id));
  const identities = new Set<string>();
  for (const record of records) {
    const identity = `${record.kind}:${lifecycleIdentity(record)}`;
    if (identities.has(identity)) throw new Error("duplicate lifecycle identity");
    identities.add(identity);
    const revisionId = record.kind === "change_proposal" ? record.baseRevisionId : "revisionId" in record ? record.revisionId : undefined;
    if (revisionId && !revisionIds.has(revisionId)) throw new Error("broken lifecycle revision reference");
    if (record.kind === "proposal_disposition" && !records.some((item) => item.kind === "change_proposal" && item.id === record.proposalId)) {
      throw new Error("broken proposal disposition reference");
    }
    if (record.kind === "evidence_closure" && !records.some((item) => item.kind === "build_attempt" && item.id === record.buildAttemptId)) {
      throw new Error("broken evidence reference");
    }
    if (record.kind === "approval_record" && !records.some((item) => item.kind === "evidence_closure" && item.id === record.evidenceClosureId)) {
      throw new Error("broken approval evidence reference");
    }
    if (record.kind === "draft_export" && !records.some((item) => item.kind === "evidence_closure" && item.id === record.evidenceClosureId)) {
      throw new Error("broken draft export evidence reference");
    }
    if (record.kind === "fabrication_release"
      && (!records.some((item) => item.kind === "approval_record" && item.id === record.approvalRecordId)
        || !records.some((item) => item.kind === "draft_export" && item.id === record.draftExportId))) {
      throw new Error("broken fabrication release reference");
    }
    if (record.kind === "released_package_projection"
      && !records.some((item) => item.kind === "fabrication_release" && item.id === record.fabricationReleaseId)) {
      throw new Error("broken released package reference");
    }
  }
}
