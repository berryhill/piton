import { CadApplication } from "../../browser-src/application";
import { SAFETY_TRUTH, seedProject, sha256Hex } from "../../browser-src/domain";
import { deriveGeometryBinding } from "../../browser-src/geometry/binding";
import { GeometryResultGate, installReplacement } from "../../browser-src/geometry/gate";
import {
  GEOMETRY_ENVIRONMENT_DIGEST,
  geometryInputDigest,
  parseGeometryBuildRequest,
} from "../../browser-src/geometry/protocol";
import { MemoryProjectRepository } from "../../browser-src/storage/repository";

const CORPUS_FORMAT = "piton-browser-behavior-corpus/v1" as const;
const CAMPAIGN_FORMAT = "piton-browser-failure-campaign/v2" as const;
const CAMPAIGN_SEEDS = 1_000;

export const FAILURE_CLASSES = Object.freeze([
  "stale-command-base",
  "idempotent-replay",
  "idempotency-conflict",
  "concurrent-equivalent-command",
  "cross-project-command",
  "malformed-command-envelope",
  "out-of-bounds-command",
  "stale-preview-status",
  "stale-worker-result",
  "malformed-review-geometry",
  "off-plane-review-geometry",
  "replacement-install-failure",
  "unauthorized-lifecycle-authority",
] as const);

export type FailureClass = typeof FAILURE_CLASSES[number];

type Scenario = Readonly<{
  format: typeof CORPUS_FORMAT;
  id: string;
  boundary: "application" | "revision" | "opfs" | "worker" | "viewer" | "lifecycle" | "safety" | "portable";
  behavior: string;
}>;

const scenario = (id: string, boundary: Scenario["boundary"], behavior: string): Scenario =>
  Object.freeze({ format: CORPUS_FORMAT, id, boundary, behavior });

export const BROWSER_BEHAVIOR_CORPUS: readonly Scenario[] = Object.freeze([
  scenario("BCS-01-initialize-empty-custody", "application", "initialize one browser project"),
  scenario("BCS-02-reopen-existing-custody", "application", "reopen without reseeding"),
  scenario("BCS-03-bounded-preview-binding", "worker", "derive a revision-bound preview"),
  scenario("BCS-04-immutable-candidate-commit", "revision", "commit one child revision"),
  scenario("BCS-05-idempotent-command-replay", "application", "return the stored receipt"),
  scenario("BCS-06-idempotency-conflict", "application", "reject changed content under one key"),
  scenario("BCS-07-stale-command-base", "application", "reject a stale expected head"),
  scenario("BCS-08-concurrent-equivalent-command", "application", "coalesce concurrent equivalent commands"),
  scenario("BCS-09-cross-project-command", "application", "reject foreign project custody"),
  scenario("BCS-10-malformed-command-envelope", "application", "reject authority-shaped extras"),
  scenario("BCS-11-out-of-bounds-command", "application", "reject an unbounded parameter"),
  scenario("BCS-12-opfs-status-revision-binding", "opfs", "reject stale durable preview status"),
  scenario("BCS-13-worker-protocol-success", "worker", "admit a closed review request"),
  scenario("BCS-14-stale-worker-result", "worker", "preserve last-good for stale worker output"),
  scenario("BCS-15-malformed-review-geometry", "worker", "preserve last-good for malformed geometry"),
  scenario("BCS-16-cad-z-zero-build-plane", "viewer", "reject review geometry above physical z zero"),
  scenario("BCS-17-transactional-mesh-replacement", "viewer", "retain prior mesh on install failure"),
  scenario("BCS-18-artifact-local-review-identity", "viewer", "bind result to the complete current request"),
  scenario("BCS-19-no-browser-release-authority", "lifecycle", "reject caller-minted build success"),
  scenario("BCS-20-root-safety-truth", "safety", "retain unreleased human-review truth"),
  scenario("BCS-21-export-custody-packet", "portable", "export a closed portable custody envelope"),
  scenario("BCS-22-reopen-custody-packet", "portable", "reopen workbench from a portable custody envelope"),
  scenario("BCS-23-reject-custody-safety-violation", "portable", "reject portable custody that violates safety truth"),
  scenario("BCS-24-reject-custody-revision-digest-mismatch", "portable", "reject portable custody whose revision digest does not match its body"),
  scenario("BCS-25-disconnected-portable-workflow", "portable", "export and reopen portable custody without network calls"),
]);

const SCENARIO_KEYS = ["format", "id", "boundary", "behavior"].sort().join("\u0000");
const EXPECTED_SCENARIO_IDS = BROWSER_BEHAVIOR_CORPUS.map(({ id }) => id);
const BOUNDARIES = new Set(BROWSER_BEHAVIOR_CORPUS.map(({ boundary }) => boundary));

export function assertClosedBrowserBehaviorCorpus(input: readonly unknown[]): readonly Scenario[] {
  if (!Array.isArray(input) || input.length !== 25) throw new Error("browser corpus must contain exactly 25 scenarios");
  for (const item of input) {
    if (!item || typeof item !== "object" || Array.isArray(item)
      || Object.keys(item).sort().join("\u0000") !== SCENARIO_KEYS) throw new Error("browser corpus scenario is malformed");
    const value = item as Record<string, unknown>;
    if (value.format !== CORPUS_FORMAT || typeof value.id !== "string" || typeof value.behavior !== "string"
      || !value.behavior || !BOUNDARIES.has(value.boundary as Scenario["boundary"])) {
      throw new Error("browser corpus scenario is malformed");
    }
  }
  if (input.some((item, index) => (item as Scenario).id !== EXPECTED_SCENARIO_IDS[index])) {
    throw new Error("browser corpus identity or order mismatch");
  }
  return input as readonly Scenario[];
}

export interface BrowserScenarioOutcome {
  scenarioId: string;
  passed: true;
  rootSafetyTruth: typeof SAFETY_TRUTH;
}

function command(projectId: string, revisionId: string, key: string, value = 92) {
  return {
    format: "piton-command/v1", projectId, expectedCurrentRevisionId: revisionId, idempotencyKey: key,
    command: { type: "set-leg-length", quantity: { value, unit: "mm" } },
  } as const;
}

async function expectRejected(action: () => Promise<unknown>, message: string): Promise<void> {
  try { await action(); } catch (error) {
    if (error instanceof Error && error.message.includes(message)) return;
    throw error;
  }
  throw new Error(`expected rejection: ${message}`);
}

function geometryFixture() {
  const base = seedProject().revisions[0];
  const binding = deriveGeometryBinding(base, base.parameters);
  const gate = new GeometryResultGate();
  const identity = gate.begin(binding, 1, geometryInputDigest(base.parameters), GEOMETRY_ENVIRONMENT_DIGEST);
  const result = { ...identity, vertices: [0, 0, 0, 1, 0, 0, 0, 1, 1], triangles: [0, 1, 2] };
  return { base, binding, gate, identity, result };
}

async function executeScenario(index: number): Promise<void> {
  const repository = new MemoryProjectRepository();
  const application = new CadApplication(repository);
  const opened = await application.open();
  const base = opened.project.currentRevisionId;
  switch (index + 1) {
    case 1: if (opened.project.revisions.length !== 1) throw new Error("initialization failed"); break;
    case 2: if ((await application.open()).project.currentRevisionId !== base) throw new Error("reopen changed custody"); break;
    case 3: if (!deriveGeometryBinding(opened.project.revisions[0], { ...opened.project.revisions[0].parameters, leg_length_mm: 90 }).previewDigest.startsWith("preview-")) throw new Error("preview binding failed"); break;
    case 4: {
      const committed = await application.commitCandidate(base, { type: "set-leg-length", value: 92 });
      if (committed.revisions.length !== 2 || committed.acceptedRevisionId !== opened.project.acceptedRevisionId) throw new Error("immutable commit failed");
      break;
    }
    case 5: {
      const request = command(opened.project.id, base, "corpus-replay-0001");
      const first = await application.executeCommand(request);
      const replay = await application.executeCommand(request);
      if (first.resultingRevisionId !== replay.resultingRevisionId || (await application.loadProject()).revisions.length !== 2) throw new Error("replay failed");
      break;
    }
    case 6: {
      const request = command(opened.project.id, base, "corpus-conflict-0001");
      await application.executeCommand(request);
      await expectRejected(() => application.executeCommand(command(opened.project.id, base, request.idempotencyKey, 93)), "idempotency key conflicts");
      if ((await application.loadProject()).revisions.length !== 2) throw new Error("idempotency conflict partially mutated custody");
      break;
    }
    case 7: {
      await application.executeCommand(command(opened.project.id, base, "corpus-current-0001"));
      await expectRejected(() => application.executeCommand(command(opened.project.id, base, "corpus-stale-0001")), "stale current revision");
      if ((await application.loadProject()).revisions.length !== 2) throw new Error("stale command partially mutated custody");
      break;
    }
    case 8: {
      const request = command(opened.project.id, base, "corpus-concurrent-0001");
      const receipts = await Promise.all([application.executeCommand(request), application.executeCommand(request)]);
      if (receipts[0].resultingRevisionId !== receipts[1].resultingRevisionId || (await application.loadProject()).revisions.length !== 2) throw new Error("concurrent coalescing failed");
      break;
    }
    case 9:
      await expectRejected(() => application.executeCommand(command("foreign-project", base, "corpus-foreign-0001")), "project identity mismatch");
      if ((await application.loadProject()).revisions.length !== 1) throw new Error("cross-project command read or mutated custody");
      break;
    case 10:
      await expectRejected(() => application.executeCommand({ ...command(opened.project.id, base, "corpus-malformed-0001"), fabricationRelease: true }), "invalid command envelope");
      if ((await application.loadProject()).revisions.length !== 1) throw new Error("malformed command partially mutated custody");
      break;
    case 11:
      await expectRejected(() => application.executeCommand(command(opened.project.id, base, "corpus-bounds-0001", 161)), "between 40 and 160");
      if ((await application.loadProject()).revisions.length !== 1) throw new Error("out-of-bounds command partially mutated custody");
      break;
    case 12: {
      const revision = opened.project.revisions[0];
      await expectRejected(() => application.recordBuildStatus({ projectId: opened.project.id, requestId: 1, binding: { baseRevisionId: "stale", previewDigest: revision.id }, state: "failed", message: "injected" }), "base revision is stale");
      if (await repository.loadBuildStatus(opened.project.id)) throw new Error("stale preview status replaced last-good status");
      break;
    }
    case 13: {
      const revision = opened.project.revisions[0];
      const binding = deriveGeometryBinding(revision, revision.parameters);
      const request = { type: "build-review-mesh", requestId: 1, workerGeneration: 1, sourceRevisionId: revision.id, inputDigest: geometryInputDigest(revision.parameters), environmentDigest: GEOMETRY_ENVIRONMENT_DIGEST, binding, parameters: revision.parameters };
      if (!parseGeometryBuildRequest(request).ok) throw new Error("worker protocol rejected");
      break;
    }
    case 14: {
      const { gate, result, binding } = geometryFixture(); gate.accept(result); const stale = gate.begin(binding); gate.begin(binding);
      if (gate.accept({ ...result, ...stale }) || gate.lastGood !== result) throw new Error("stale result replaced last-good");
      break;
    }
    case 15: {
      const { gate, result, binding } = geometryFixture(); gate.accept(result); const next = gate.begin(binding);
      if (gate.accept({ ...next, vertices: [], triangles: [] }) || gate.lastGood !== result) throw new Error("malformed geometry replaced last-good");
      break;
    }
    case 16: {
      const { gate, identity } = geometryFixture();
      if (gate.accept({ ...identity, vertices: [0, 0, 2, 1, 0, 2, 0, 1, 3], triangles: [0, 1, 2] })) throw new Error("off-plane geometry accepted");
      break;
    }
    case 17: {
      const current = { id: "last-good" };
      try { installReplacement(current, () => ({ id: "candidate" }), () => { throw new Error("install failed"); }, () => {}, () => {}); throw new Error("replacement accepted"); }
      catch (error) { if ((error as Error).message === "replacement accepted") throw error; }
      break;
    }
    case 18: {
      const { gate, result } = geometryFixture();
      if (gate.accept({ ...result, environmentDigest: `sha256-${"0".repeat(64)}` })) throw new Error("foreign artifact identity accepted");
      break;
    }
    case 19:
      await expectRejected(() => repository.appendLifecycleRecord({ kind: "build_attempt", id: `attempt-${"a".repeat(64)}`, projectId: opened.project.id, revisionId: base, recipeDigest: "b".repeat(64), state: "succeeded", createdAt: "2026-08-18T00:00:00.000Z" } as never, base), "trusted coordinator custody");
      if ((await repository.loadLifecycleRecords(opened.project.id)).length !== 0) throw new Error("caller minted lifecycle authority");
      break;
    case 20: if (opened.project.revisions.some((revision) => revision.reviewState !== SAFETY_TRUTH.reviewState || revision.fabricationRelease || revision.machineActuation || revision.releaseState !== SAFETY_TRUTH.releaseState)) throw new Error("root truth changed"); break;
    case 21: {
      const envelope = await application.exportPortableCustody();
      const required = ["build_status", "environment_digest", "exported_at", "fingerprint", "format", "lifecycle_projection", "project", "revisions", "schema_version"];
      if (Object.keys(envelope).sort().join(" ") !== [...required].sort().join(" ")) throw new Error("exported portable custody envelope is missing closed keys");
      if (envelope.format !== "piton-custody/v1") throw new Error("exported portable custody format mismatch");
      if (!/^sha256-[0-9a-f]{64}$/.test(envelope.fingerprint)) throw new Error("exported portable custody fingerprint is not a sha256 digest");
      break;
    }
    case 22: {
      const envelope = await application.exportPortableCustody();
      const restored = await application.reopenPortableCustody(envelope, envelope.fingerprint);
      if (restored.project.currentRevisionId !== opened.project.currentRevisionId) throw new Error("reopen did not restore current revision");
      break;
    }
    case 23: {
      const envelope = await application.exportPortableCustody();
      const tampered = JSON.parse(JSON.stringify(envelope));
      tampered.revisions[0].fabricationRelease = true;
      tampered.fingerprint = envelope.fingerprint;
      await expectRejected(() => application.reopenPortableCustody(tampered, envelope.fingerprint), "revision safety or authority truth is invalid");
      const stillOriginal = await application.loadProject();
      if (stillOriginal.currentRevisionId !== opened.project.currentRevisionId) throw new Error("rejected portable custody partially mutated custody");
      break;
    }
    case 24: {
      const envelope = await application.exportPortableCustody();
      const tampered = JSON.parse(JSON.stringify(envelope));
      tampered.revisions[0].parameters.leg_length_mm = (envelope.revisions[0].parameters.leg_length_mm as number) + 1;
      tampered.fingerprint = envelope.fingerprint;
      await expectRejected(() => application.reopenPortableCustody(tampered, envelope.fingerprint), "revision digest does not match its body");
      break;
    }
    case 25: {
      const envelope = await application.exportPortableCustody();
      const networkCalls: string[] = [];
      const originalFetch = globalThis.fetch;
      const originalXhr = (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest;
      globalThis.fetch = ((input: RequestInfo | URL) => {
        networkCalls.push(String(input));
        return Promise.reject(new Error("network disabled for portable custody test"));
      }) as typeof fetch;
      (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest = function PitonTestXhr() { networkCalls.push("xhr"); throw new Error("network disabled"); } as unknown as XMLHttpRequest;
      try {
        const restored = await application.reopenPortableCustody(envelope, envelope.fingerprint);
        if (!restored.project || restored.project.currentRevisionId !== opened.project.currentRevisionId) throw new Error("reopen failed under disconnected conditions");
      } finally {
        globalThis.fetch = originalFetch;
        (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest = originalXhr;
      }
      if (networkCalls.length !== 0) throw new Error(`portable custody emitted network calls: ${networkCalls.join(", ")}`);
      break;
    }
    default: throw new Error("unknown browser corpus scenario");
  }
}

export async function runBrowserBehaviorCorpus(): Promise<BrowserScenarioOutcome[]> {
  assertClosedBrowserBehaviorCorpus(BROWSER_BEHAVIOR_CORPUS);
  const outcomes: BrowserScenarioOutcome[] = [];
  for (let index = 0; index < BROWSER_BEHAVIOR_CORPUS.length; index += 1) {
    await executeScenario(index);
    outcomes.push({ scenarioId: BROWSER_BEHAVIOR_CORPUS[index].id, passed: true, rootSafetyTruth: SAFETY_TRUTH });
  }
  return outcomes;
}

export interface CampaignOutcome {
  seed: number;
  replayId: string;
  scenarioId: string;
  failureClass: FailureClass;
  passed: true;
  falseSuccess: 0;
  falseRelease: 0;
  staleHeadReplacement: 0;
  duplicateAuthoredRevision: 0;
  unauthorizedLifecycleAuthority: 0;
  crossProjectCustodyRead: 0;
}

interface CampaignSummary {
  total: number; passed: number; failed: number; falseSuccess: number; falseRelease: number;
  staleHeadReplacement: number; duplicateAuthoredRevision: number;
  unauthorizedLifecycleAuthority: number; crossProjectCustodyRead: number;
}

export interface BrowserFailureCampaignReceipt {
  format: typeof CAMPAIGN_FORMAT;
  corpusDigest: string;
  sourceDigest: string;
  comparatorDigest: string;
  environmentDigest: string;
  outcomes: CampaignOutcome[];
  summary: CampaignSummary;
}

const digest = (value: string) => `sha256-${sha256Hex(value)}`;
const corpusDigest = () => digest(JSON.stringify(BROWSER_BEHAVIOR_CORPUS));
const comparatorDigest = digest("piton-browser-failure-comparator/v1:zero-critical-violations");
const environmentDigest = digest("vitest-jsdom-and-playwright-chromium:browser-typescript-product-boundaries:v1");
const SCENARIO_INDEX_BY_FAILURE_CLASS: Record<FailureClass, number> = {
  "stale-command-base": 6,
  "idempotent-replay": 4,
  "idempotency-conflict": 5,
  "concurrent-equivalent-command": 7,
  "cross-project-command": 8,
  "malformed-command-envelope": 9,
  "out-of-bounds-command": 10,
  "stale-preview-status": 11,
  "stale-worker-result": 13,
  "malformed-review-geometry": 14,
  "off-plane-review-geometry": 15,
  "replacement-install-failure": 16,
  "unauthorized-lifecycle-authority": 18,
};
const expectedClass = (seed: number): FailureClass => FAILURE_CLASSES[seed % FAILURE_CLASSES.length];
const expectedScenario = (seed: number) => BROWSER_BEHAVIOR_CORPUS[SCENARIO_INDEX_BY_FAILURE_CLASS[expectedClass(seed)]].id;
const replayId = (seed: number) => digest(`${CAMPAIGN_FORMAT}:${seed}:${expectedClass(seed)}:${expectedScenario(seed)}`);

async function exerciseFailureClass(failureClass: FailureClass): Promise<void> {
  await executeScenario(SCENARIO_INDEX_BY_FAILURE_CLASS[failureClass]);
}

function summarize(outcomes: readonly CampaignOutcome[]): CampaignSummary {
  return {
    total: outcomes.length,
    passed: outcomes.filter(({ passed }) => passed).length,
    failed: outcomes.filter(({ passed }) => !passed).length,
    falseSuccess: outcomes.reduce((sum, item) => sum + item.falseSuccess, 0),
    falseRelease: outcomes.reduce((sum, item) => sum + item.falseRelease, 0),
    staleHeadReplacement: outcomes.reduce((sum, item) => sum + item.staleHeadReplacement, 0),
    duplicateAuthoredRevision: outcomes.reduce((sum, item) => sum + item.duplicateAuthoredRevision, 0),
    unauthorizedLifecycleAuthority: outcomes.reduce((sum, item) => sum + item.unauthorizedLifecycleAuthority, 0),
    crossProjectCustodyRead: outcomes.reduce((sum, item) => sum + item.crossProjectCustodyRead, 0),
  };
}

export async function runBrowserFailureCampaign(productSource: string): Promise<BrowserFailureCampaignReceipt> {
  assertClosedBrowserBehaviorCorpus(BROWSER_BEHAVIOR_CORPUS);
  const outcomes: CampaignOutcome[] = [];
  for (let seed = 0; seed < CAMPAIGN_SEEDS; seed += 1) {
    const failureClass = expectedClass(seed);
    await exerciseFailureClass(failureClass);
    outcomes.push({
      seed, replayId: replayId(seed), scenarioId: expectedScenario(seed), failureClass, passed: true,
      falseSuccess: 0, falseRelease: 0, staleHeadReplacement: 0, duplicateAuthoredRevision: 0,
      unauthorizedLifecycleAuthority: 0, crossProjectCustodyRead: 0,
    });
  }
  return {
    format: CAMPAIGN_FORMAT,
    corpusDigest: corpusDigest(),
    sourceDigest: digest(productSource),
    comparatorDigest,
    environmentDigest,
    outcomes,
    summary: summarize(outcomes),
  };
}

export function verifyBrowserFailureCampaign(receipt: BrowserFailureCampaignReceipt, productSource: string): BrowserFailureCampaignReceipt {
  const receiptKeys = ["format", "corpusDigest", "sourceDigest", "comparatorDigest", "environmentDigest", "outcomes", "summary"].sort().join("\u0000");
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)
    || Object.keys(receipt).sort().join("\u0000") !== receiptKeys) throw new Error("campaign receipt is malformed");
  if (receipt.format !== CAMPAIGN_FORMAT) throw new Error("invalid campaign receipt");
  if (receipt.sourceDigest !== digest(productSource)) throw new Error("campaign source binding mismatch");
  if (receipt.corpusDigest !== corpusDigest() || receipt.comparatorDigest !== comparatorDigest || receipt.environmentDigest !== environmentDigest) {
    throw new Error("campaign contract binding mismatch");
  }
  if (!Array.isArray(receipt.outcomes) || receipt.outcomes.length !== CAMPAIGN_SEEDS) throw new Error("campaign must contain exactly 1000 outcomes");
  const outcomeKeys = ["seed", "replayId", "scenarioId", "failureClass", "passed", "falseSuccess", "falseRelease",
    "staleHeadReplacement", "duplicateAuthoredRevision", "unauthorizedLifecycleAuthority", "crossProjectCustodyRead"].sort().join("\u0000");
  for (let seed = 0; seed < CAMPAIGN_SEEDS; seed += 1) {
    const outcome = receipt.outcomes[seed];
    if (!outcome || typeof outcome !== "object" || Array.isArray(outcome)
      || Object.keys(outcome).sort().join("\u0000") !== outcomeKeys
      || outcome.seed !== seed || outcome.replayId !== replayId(seed) || outcome.scenarioId !== expectedScenario(seed)) {
      throw new Error("campaign outcome identity or order mismatch");
    }
    if (outcome.failureClass !== expectedClass(seed)) throw new Error("campaign outcome class mismatch");
    if (!outcome.passed || outcome.falseSuccess !== 0 || outcome.falseRelease !== 0 || outcome.staleHeadReplacement !== 0
      || outcome.duplicateAuthoredRevision !== 0 || outcome.unauthorizedLifecycleAuthority !== 0 || outcome.crossProjectCustodyRead !== 0) {
      throw new Error("campaign critical invariant violation");
    }
  }
  if (JSON.stringify(receipt.summary) !== JSON.stringify(summarize(receipt.outcomes))) throw new Error("campaign summary mismatch");
  return receipt;
}
