import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const VERIFY_CHAIN = "pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("Piton product identity", () => {
  it("exposes the normal application and verification commands without MVI script names", () => {
    const pkg = JSON.parse(read("package.json")) as {
      name: string;
      private: boolean;
      scripts: Record<string, string>;
    };

    expect(pkg.name).toBe("piton");
    expect(pkg.private).toBe(true);
    expect(pkg.scripts.start).toBe("./launch-piton.sh");
    expect(pkg.scripts.dev).toBe("vite --host 127.0.0.1");
    expect(pkg.scripts.verify).toBe(VERIFY_CHAIN);
    expect(pkg.scripts).not.toHaveProperty("launch:mvi");
    expect(pkg.scripts).not.toHaveProperty("verify:mvi");
    expect(existsSync("launch-piton.sh")).toBe(true);
    expect(existsSync("launch-browser-mvi.sh")).toBe(false);

    const launcher = read("launch-piton.sh");
    expect(launcher).toContain('if [ "$PNPM_VERSION" != "11.1.3" ]');
    expect(launcher).toContain("pnpm install --frozen-lockfile");
    expect(launcher).toContain("exec pnpm dev");
    expect(launcher).toContain("Piton requires pnpm 11.1.3");
    expect(launcher).not.toMatch(/MVI/i);
  });

  it("uses Piton as the browser and visible workbench identity", () => {
    expect(read("index.html")).toContain("<title>Piton</title>");

    const app = read("browser-src/App.tsx");
    expect(app).toContain('<span className="eyebrow">PITON</span><h1>Piton Workbench</h1>');
    expect(app).not.toMatch(/BROWSER-LOCAL MECHANICAL CAD MVI/);
  });

  it("documents one canonical command for launch and verification", () => {
    const readme = read("README.md");
    const operations = read("docs/runtime-operations.md");
    const review = read("docs/human-review-launch-assets.md");
    const workflow = read(".github/workflows/ci.yml");

    for (const document of [readme, operations, review]) {
      expect(document).toContain("pnpm start");
      expect(document).toContain("pnpm verify");
      expect(document).not.toMatch(/pnpm (?:launch|verify):mvi/);
    }
    expect(workflow).toContain("run: pnpm verify");
    expect(workflow).not.toMatch(/pnpm verify:mvi/);
  });

  it("keeps MVI as a stage term rather than the application name", () => {
    const readme = read("README.md");
    expect(readme).toContain("Piton is a runnable, browser-local Mechanical CAD application.");
    expect(readme).toContain("MVI describes the delivery stage and canonical doctrine, not a separate launch mode or application.");
    expect(readme).toContain("review_state = needs_human_review");
    expect(readme).toContain("fabrication_release = false");
    expect(readme).toContain("machine_actuation = false");
    expect(readme).toMatch(/review geometry is not exact geometry/i);
  });
});
