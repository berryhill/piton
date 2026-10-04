import { SAFETY_TRUTH, sha256Hex } from "../domain";
import { readFeatures, type FeatureSource } from "./source";

export interface FeatureRevision {
  readonly id: string;
  readonly parentRevisionId: string | null;
  readonly createdAt: string;
  readonly authorityProfile: "browser-typescript/v1";
  readonly authored: FeatureSource;
  readonly reviewState: "needs_human_review";
  readonly fabricationRelease: false;
  readonly machineActuation: false;
  readonly releaseState: "unreleased";
}
export interface FeaturePart {
  readonly kind: "feature-part";
  id: string;
  name: string;
  acceptedRevisionId: string;
  currentRevisionId: string;
  revisions: FeatureRevision[];
}
function bodyJson(body: Omit<FeatureRevision, "id">): string {
  return JSON.stringify({ parentRevisionId: body.parentRevisionId, createdAt: body.createdAt, authorityProfile: body.authorityProfile,
    authored: { authorityProfile: body.authored.authorityProfile, units: body.authored.units, source: body.authored.source },
    reviewState: body.reviewState, fabricationRelease: body.fabricationRelease, machineActuation: body.machineActuation, releaseState: body.releaseState });
}
export function makeFeatureRevision(parentRevisionId: string | null, authored: FeatureSource, createdAt: string): FeatureRevision {
  readFeatures(authored);
  const body = { parentRevisionId, createdAt, authorityProfile: "browser-typescript/v1" as const, authored: Object.freeze({ ...authored }), ...SAFETY_TRUTH };
  const revision = Object.freeze({ id: `rev-${sha256Hex(bodyJson(body))}`, ...body });
  assertFeatureRevision(revision);
  return revision;
}
export function assertFeatureRevision(value: FeatureRevision): void {
  const expected = ["id", "parentRevisionId", "createdAt", "authorityProfile", "authored", ...Object.keys(SAFETY_TRUTH)];
  if (!value || typeof value !== "object" || Object.keys(value).sort().join() !== expected.sort().join()
    || !/^rev-[0-9a-f]{64}$/.test(value.id) || (value.parentRevisionId !== null && !/^rev-[0-9a-f]{64}$/.test(value.parentRevisionId))
    || typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt)) || value.authorityProfile !== "browser-typescript/v1"
    || Object.entries(SAFETY_TRUTH).some(([key, truth]) => value[key as keyof FeatureRevision] !== truth)) throw new Error("Invalid feature revision integrity");
  readFeatures(value.authored);
  if (!readFeatures(value.authored).some(f => f.kind === "extrude" || f.kind === "revolve")) throw new Error("Feature revision must define a solid extrusion or revolve");
  if (value.id !== `rev-${sha256Hex(bodyJson(value))}`) throw new Error("Feature revision digest mismatch");
}
export function assertFeaturePart(part: FeaturePart): void {
  if (part.kind !== "feature-part" || !Array.isArray(part.revisions) || !part.revisions.length) throw new Error("Invalid feature Part");
  const seen = new Set<string>();
  for (const revision of part.revisions) {
    assertFeatureRevision(revision);
    if (seen.has(revision.id) || (revision.parentRevisionId !== null && !seen.has(revision.parentRevisionId)) || (seen.size === 0) !== (revision.parentRevisionId === null)) throw new Error("Invalid feature revision lineage");
    seen.add(revision.id);
  }
  if (part.acceptedRevisionId !== part.revisions[0].id || !seen.has(part.currentRevisionId)) throw new Error("Invalid feature revision pointers");
}
