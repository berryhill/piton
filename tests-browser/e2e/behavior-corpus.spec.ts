import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const productSource = [
  "../support/browserBehaviorCorpus.ts",
  "../../browser-src/application.ts",
  "../../browser-src/agentAdapter.ts",
  "../../browser-src/domain.ts",
  "../../browser-src/lifecycle.ts",
  "../../browser-src/storage/repository.ts",
  "../../browser-src/storage/schema.ts",
  "../../browser-src/geometry/binding.ts",
  "../../browser-src/geometry/bracket.ts",
  "../../browser-src/geometry/gate.ts",
  "../../browser-src/geometry/geometry.worker.ts",
  "../../browser-src/geometry/protocol.ts",
  "../../browser-src/geometry/view.ts",
  "../../browser-src/geometry/workerClient.ts",
  "../../package.json",
  "../../pnpm-lock.yaml",
  "../../tsconfig.json",
  "../../vite.config.ts",
  "../../playwright.config.ts",
].map((path) => readFileSync(new URL(path, import.meta.url), "utf8")).join("\n--piton-source-boundary--\n");

test("executes the closed 25-scenario corpus and 1,000-replay campaign in Chromium", async ({ page }) => {
  await page.goto("/");
  const evidence = await page.evaluate(async (sourceBinding) => {
    const moduleUrl = "/tests-browser/support/browserBehaviorCorpus.ts";
    const campaign = await import(/* @vite-ignore */ moduleUrl) as {
      BROWSER_BEHAVIOR_CORPUS: readonly { id: string }[];
      FAILURE_CLASSES: readonly string[];
      runBrowserBehaviorCorpus(): Promise<{ scenarioId: string; passed: boolean; rootSafetyTruth: Record<string, unknown> }[]>;
      runBrowserFailureCampaign(source: string): Promise<{
        outcomes: { replayId: string; scenarioId: string; failureClass: string }[];
        summary: Record<string, number>;
      }>;
      verifyBrowserFailureCampaign(receipt: unknown, source: string): unknown;
    };
    const scenarios = await campaign.runBrowserBehaviorCorpus();
    const receipt = await campaign.runBrowserFailureCampaign(sourceBinding);
    campaign.verifyBrowserFailureCampaign(receipt, sourceBinding);
    return {
      declaredScenarioIds: campaign.BROWSER_BEHAVIOR_CORPUS.map(({ id }) => id),
      scenarioIds: scenarios.map(({ scenarioId }) => scenarioId),
      allScenariosPassed: scenarios.every(({ passed }) => passed),
      allScenariosUnreleased: scenarios.every(({ rootSafetyTruth }) =>
        rootSafetyTruth.reviewState === "needs_human_review"
        && rootSafetyTruth.fabricationRelease === false
        && rootSafetyTruth.machineActuation === false
        && rootSafetyTruth.releaseState === "unreleased"),
      outcomeCount: receipt.outcomes.length,
      replayCount: new Set(receipt.outcomes.map(({ replayId }) => replayId)).size,
      exercisedScenarioCount: new Set(receipt.outcomes.map(({ scenarioId }) => scenarioId)).size,
      failureClasses: Array.from(new Set(receipt.outcomes.map((outcome) => outcome.failureClass))).sort(),
      declaredFailureClasses: [...campaign.FAILURE_CLASSES].sort(),
      summary: receipt.summary,
    };
  }, productSource);

  expect(evidence.scenarioIds).toEqual(evidence.declaredScenarioIds);
  expect(evidence.scenarioIds).toHaveLength(25);
  expect(evidence.allScenariosPassed).toBe(true);
  expect(evidence.allScenariosUnreleased).toBe(true);
  expect(evidence.outcomeCount).toBe(1_000);
  expect(evidence.replayCount).toBe(1_000);
  expect(evidence.exercisedScenarioCount).toBe(evidence.declaredFailureClasses.length);
  expect(evidence.failureClasses).toEqual(evidence.declaredFailureClasses);
  expect(evidence.summary).toEqual({
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
});
