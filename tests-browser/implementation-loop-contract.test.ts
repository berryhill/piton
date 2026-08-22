import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type FlowStep = {
  step_id: string;
  type: string;
  prompt_template: string;
};

type FlowTemplate = {
  metadata: {
    template_sha256: string;
  };
  steps: FlowStep[];
  version: number;
};

const template = JSON.parse(
  readFileSync("flows/piton_browser_implementation_loop_v1.json", "utf8"),
) as FlowTemplate;

function step(stepId: string): FlowStep {
  const match = template.steps.find((candidate) => candidate.step_id === stepId);
  if (!match) {
    throw new Error(`Missing implementation-loop step: ${stepId}`);
  }
  return match;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return `{${entries
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalJson(entryValue)}`)
    .join(",")}}`;
}

describe("Piton browser implementation-loop approval policy", () => {
  it("assembles the review packet autonomously without a routine human gate", () => {
    const reportStep = step("report_concisely");

    expect(reportStep.type).toBe("execute");
    expect(reportStep.prompt_template).toContain(
      "Do not pause or wait for routine human approval",
    );
    expect(reportStep.prompt_template).toContain("review_state=needs_human_review");
    expect(reportStep.prompt_template).toContain("fabrication_release=false");
    expect(reportStep.prompt_template).toContain("machine_actuation=false");
    expect(reportStep.prompt_template).toContain(
      "Block only on a concrete technical, safety, credential, repository-authority, or policy defect",
    );
  });

  it("versions and hashes the executable template contract", () => {
    const { template_sha256: expectedDigest, ...metadata } = template.metadata;
    const digestInput = canonicalJson({ ...template, metadata });
    const actualDigest = createHash("sha256").update(digestInput).digest("hex");

    expect(template.version).toBe(2);
    expect(actualDigest).toBe(expectedDigest);
  });
});
