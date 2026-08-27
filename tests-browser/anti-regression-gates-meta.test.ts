import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const gateSpecPath = resolve(repoRoot, "tests-browser/e2e/anti-regression-gates.spec.ts");
const playwrightConfigPath = resolve(repoRoot, "playwright.config.ts");
const packageJsonPath = resolve(repoRoot, "package.json");

const EXPECTED_GATE_TITLES = [
  /anti-regression gate 1: chromium defaults open with root safety truth and no enabling control/,
  /anti-regression gate 2: commit then reload keeps the accepted revision immutable and root safety truth/,
  /anti-regression gate 3: forged fabrication_release envelope is rejected at the import boundary/,
  /anti-regression gate 4: worker output is request- and revision-bound and never displaces last-good/,
  /anti-regression gate 5: durable SQLite row readback and unchanged UI defaults after reopen/,
  /anti-regression gate 6: no UI control enables fabrication release, machine actuation, approval, or exact export/,
] as const;

const EXPECTED_VERIFY = "pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e";

describe("anti-regression gates permanence", () => {
  it("keeps the gate spec tracked at tests-browser/e2e/anti-regression-gates.spec.ts with all six expected gate titles", () => {
    const source = readFileSync(gateSpecPath, "utf8");
    for (const pattern of EXPECTED_GATE_TITLES) {
      expect(source, `expected gate title matching ${pattern}`).toMatch(pattern);
    }
  });

  it("does not skip the gate spec via test.skip, describe.skip, or fixme hooks", () => {
    const source = readFileSync(gateSpecPath, "utf8");
    expect(source).not.toMatch(/\btest\.skip\b/);
    expect(source).not.toMatch(/\btest\.describe\.skip\b/);
    expect(source).not.toMatch(/\btest\.fixme\b/);
    expect(source).not.toMatch(/\.skip\(\s*$/m);
  });

  it("keeps the canonical pnpm verify chain unchanged", () => {
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.verify).toBe(EXPECTED_VERIFY);
  });

  it("forbids retries, grep, and filter overrides inside playwright.config.ts", () => {
    const config = readFileSync(playwrightConfigPath, "utf8");
    expect(config, "retries key must not be added to playwright.config.ts").not.toMatch(/\bretries\s*:/);
    expect(config, "grep key must not be added to playwright.config.ts").not.toMatch(/\bgrep\s*:/);
    expect(config, "testIgnore must not be added to playwright.config.ts").not.toMatch(/\btestIgnore\s*:/);
    expect(config, "testMatch must not be added to playwright.config.ts").not.toMatch(/\btestMatch\s*:/);
  });
});
