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
});
