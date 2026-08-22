import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const trackedFiles = execFileSync("git", ["ls-files"], { encoding: "utf8" })
  .trim()
  .split("\n")
  .filter(Boolean);

function trackedUnder(prefix: string): string[] {
  return trackedFiles.filter((path) => path === prefix || path.startsWith(`${prefix}/`));
}

describe("browser-only repository estate", () => {
  it("contains no executable Python application, package, scripts, tests, or adapter fixture", () => {
    expect(trackedFiles.filter((path) => path.endsWith(".py"))).toEqual([]);
    expect(trackedUnder("src")).toEqual([]);
    expect(trackedUnder("scripts")).toEqual([]);
    expect(trackedUnder("tests")).toEqual([]);
  });

  it("contains no retired Python-authority support estate", () => {
    expect(trackedUnder("schemas")).toEqual([]);
    expect(trackedUnder("templates")).toEqual([]);
    expect(trackedUnder("examples/minimal-project")).toEqual([]);
    expect(trackedUnder("src/piton/storage/migrations")).toEqual([]);
    expect(trackedUnder("src/piton/viewer_assets")).toEqual([]);
  });

  it("contains no Python package or dependency estate", () => {
    expect(trackedFiles).not.toContain("pyproject.toml");
    expect(trackedFiles).not.toContain("uv.lock");
    expect(trackedFiles).not.toContain(".python-version");
  });

  it("runs only the browser verification job in CI", () => {
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
    expect(workflow).toContain("pnpm verify:mvi");
    expect(workflow).not.toMatch(/setup-python|\buv\b|pytest|pip install|python(?:3)?\b/);
    expect(workflow).not.toMatch(/^  verify:/m);
  });

  it("keeps current architecture, operations, threat, and migration guidance on the browser application boundary", () => {
    const documents = [
      "docs/architecture.md",
      "docs/runtime-operations.md",
      "docs/threat-model.md",
      "docs/migration-inventory.md",
    ].map((path) => readFileSync(path, "utf8"));

    for (const document of documents) {
      expect(document).toContain("browser-local TypeScript");
      expect(document).toContain("DesignRevision");
      expect(document).toContain("SQLite WASM");
      expect(document).toContain("OPFS");
      expect(document).toContain("fabrication_release=false");
      expect(document).toContain("machine_actuation=false");
      expect(document).toMatch(/review (?:mesh|geometry)/i);
      expect(document).toMatch(/not exact geometry/i);
    }
  });

  it("documents the concrete application path and operational failure boundaries", () => {
    const architecture = readFileSync("docs/architecture.md", "utf8");
    const operations = readFileSync("docs/runtime-operations.md", "utf8");
    const threatModel = readFileSync("docs/threat-model.md", "utf8");
    const migration = readFileSync("docs/migration-inventory.md", "utf8");

    expect(architecture).toContain("browser-src/main.tsx");
    expect(architecture).toContain("browser-src/App.tsx");
    expect(architecture).toContain("CadApplication.executeCommand");
    expect(architecture).toContain("window.pitonAgent");
    expect(architecture).toContain("Web Worker");

    expect(operations).toContain("open-or-seed");
    expect(operations).toContain("import-fresh");
    expect(operations).toContain("reopen-existing");
    expect(operations).toContain("restore-forward");
    expect(operations).toContain("pnpm verify:mvi");

    expect(threatModel).toContain("Trust boundaries");
    expect(threatModel).toContain("Residual risk");
    expect(threatModel).toContain("Supply chain");
    expect(threatModel).toContain("portable custody");

    expect(migration).toContain("Current tracked estate");
    expect(migration).toContain("Removed estate");
    expect(migration).toContain("Historical evidence");
    expect(migration).toContain("No compatibility authority");
  });
});
