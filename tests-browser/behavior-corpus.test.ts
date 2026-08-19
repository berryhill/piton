import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BROWSER_BEHAVIOR_CORPUS,
  FAILURE_CLASSES,
  assertClosedBrowserBehaviorCorpus,
  runBrowserBehaviorCorpus,
  runBrowserFailureCampaign,
  verifyBrowserFailureCampaign,
} from "./support/browserBehaviorCorpus";

const productSource = [
  "./support/browserBehaviorCorpus.ts",
  "../browser-src/application.ts",
  "../browser-src/agentAdapter.ts",
  "../browser-src/domain.ts",
  "../browser-src/lifecycle.ts",
  "../browser-src/storage/repository.ts",
  "../browser-src/storage/schema.ts",
  "../browser-src/geometry/binding.ts",
  "../browser-src/geometry/bracket.ts",
  "../browser-src/geometry/gate.ts",
  "../browser-src/geometry/geometry.worker.ts",
  "../browser-src/geometry/protocol.ts",
  "../browser-src/geometry/view.ts",
  "../browser-src/geometry/workerClient.ts",
  "../package.json",
  "../pnpm-lock.yaml",
  "../tsconfig.json",
  "../vite.config.ts",
  "../playwright.config.ts",
].map((path) => readFileSync(new URL(path, import.meta.url), "utf8")).join("\n--piton-source-boundary--\n");

describe("closed browser behavior corpus", () => {
  it("predeclares exactly 20 ordered, unique, closed browser scenarios", () => {
    expect(assertClosedBrowserBehaviorCorpus(BROWSER_BEHAVIOR_CORPUS)).toBe(BROWSER_BEHAVIOR_CORPUS);
    expect(BROWSER_BEHAVIOR_CORPUS).toHaveLength(20);

    expect(() => assertClosedBrowserBehaviorCorpus(BROWSER_BEHAVIOR_CORPUS.slice(1))).toThrow("browser corpus must contain exactly 20 scenarios");
    expect(() => assertClosedBrowserBehaviorCorpus([...BROWSER_BEHAVIOR_CORPUS.slice(0, 19), BROWSER_BEHAVIOR_CORPUS[0]])).toThrow("browser corpus identity or order mismatch");
    expect(() => assertClosedBrowserBehaviorCorpus([...BROWSER_BEHAVIOR_CORPUS].reverse())).toThrow("browser corpus identity or order mismatch");
    expect(() => assertClosedBrowserBehaviorCorpus(BROWSER_BEHAVIOR_CORPUS.map((scenario, index) =>
      index === 0 ? { ...scenario, unexpected: true } : scenario) as never)).toThrow("browser corpus scenario is malformed");
  });

  it("executes all 20 declarations against browser TypeScript boundaries", async () => {
    const outcomes = await runBrowserBehaviorCorpus();
    expect(outcomes).toHaveLength(20);
    expect(outcomes.map((outcome) => outcome.scenarioId)).toEqual(BROWSER_BEHAVIOR_CORPUS.map((scenario) => scenario.id));
    expect(outcomes.every((outcome) => outcome.passed)).toBe(true);
    for (const outcome of outcomes) {
      expect(outcome.rootSafetyTruth).toEqual({
        reviewState: "needs_human_review",
        fabricationRelease: false,
        machineActuation: false,
        releaseState: "unreleased",
      });
    }
  });

  it("executes and verifies exactly 1,000 deterministic browser-bound failure-class replays", async () => {
    const first = await runBrowserFailureCampaign(productSource);
    const second = await runBrowserFailureCampaign(productSource);

    expect(first).toEqual(second);
    expect(first.outcomes).toHaveLength(1_000);
    expect(first.summary).toEqual({
      total: 1_000,
      passed: 1_000,
      failed: 0,
      falseSuccess: 0,
      falseRelease: 0,
      staleHeadReplacement: 0,
      duplicateAuthoredRevision: 0,
      unauthorizedLifecycleAuthority: 0,
      crossProjectCustodyRead: 0,
    });
    expect(new Set(first.outcomes.map((outcome) => outcome.replayId)).size).toBe(1_000);
    expect(new Set(first.outcomes.map((outcome) => outcome.scenarioId)).size).toBe(FAILURE_CLASSES.length);
    expect(new Set(first.outcomes.map((outcome) => outcome.failureClass))).toEqual(new Set(FAILURE_CLASSES));
    expect(verifyBrowserFailureCampaign(first, productSource)).toBe(first);
  });

  it("rejects incomplete, duplicate, reordered, substituted, forged, or source-stale evidence", async () => {
    const receipt = await runBrowserFailureCampaign(productSource);
    const clone = () => structuredClone(receipt);

    const incomplete = clone();
    incomplete.outcomes.pop();
    expect(() => verifyBrowserFailureCampaign(incomplete, productSource)).toThrow("campaign must contain exactly 1000 outcomes");

    const duplicate = clone();
    duplicate.outcomes[1] = duplicate.outcomes[0];
    expect(() => verifyBrowserFailureCampaign(duplicate, productSource)).toThrow("campaign outcome identity or order mismatch");

    const reordered = clone();
    [reordered.outcomes[0], reordered.outcomes[1]] = [reordered.outcomes[1], reordered.outcomes[0]];
    expect(() => verifyBrowserFailureCampaign(reordered, productSource)).toThrow("campaign outcome identity or order mismatch");

    const substituted = clone();
    substituted.outcomes[0].failureClass = FAILURE_CLASSES[1];
    expect(() => verifyBrowserFailureCampaign(substituted, productSource)).toThrow("campaign outcome class mismatch");

    const malformedOutcome = clone() as typeof receipt & { outcomes: Array<(typeof receipt.outcomes)[number] & { accepted?: boolean }> };
    malformedOutcome.outcomes[0].accepted = true;
    expect(() => verifyBrowserFailureCampaign(malformedOutcome, productSource)).toThrow("campaign outcome identity or order mismatch");

    const forged = clone();
    forged.summary.passed = 999;
    forged.summary.failed = 1;
    expect(() => verifyBrowserFailureCampaign(forged, productSource)).toThrow("campaign summary mismatch");

    const malformed = clone() as typeof receipt & { accepted?: boolean };
    malformed.accepted = true;
    expect(() => verifyBrowserFailureCampaign(malformed, productSource)).toThrow("campaign receipt is malformed");

    expect(() => verifyBrowserFailureCampaign(receipt, `${productSource}\nchanged`)).toThrow("campaign source binding mismatch");
  });
});
