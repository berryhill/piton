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
