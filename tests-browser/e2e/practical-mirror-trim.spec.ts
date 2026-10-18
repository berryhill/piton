import { expect, test, type Page } from "@playwright/test";
import { readFeatures } from "../../src/modeling/source";
import { isFeaturePart } from "../../src/workspace";

const commands = (page: Page) => page.getByRole("region", { name: "Part commands" });
const properties = (page: Page) => page.getByRole("complementary", { name: "Change request" });
const outline = (page: Page) => page.getByRole("img", { name: "Sketch-only 2D preview" });

async function savedPart(page: Page) {
  const state = await page.evaluate(() => window.pitonWorkspace.read());
  const route = new URL(page.url()).pathname.split("/");
  const part = state.projects.find(project => project.id === route[2])?.documents.find(document => document.id === route[4])?.part;
  if (!part) throw new Error("Part missing at current route");
  return part;
}

async function addLinePoint(page: Page, x: number, y: number) {
  await commands(page).getByRole("button", { name: "Line", exact: true }).click();
  const form = properties(page).getByRole("form", { name: "Line parameters" });
  await form.getByRole("spinbutton", { name: "x", exact: true }).fill(String(x));
  await form.getByRole("spinbutton", { name: "y", exact: true }).fill(String(y));
  await form.getByRole("button", { name: "Apply to sketch" }).click();
}

test("visible Trim and Mirror build one evaluated, explicitly committed polygon extrusion", async ({ page }, info) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto("/projects");
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  await page.getByRole("dialog").getByRole("textbox", { name: "Project name" }).fill("Mirror trim acceptance");
  await page.getByRole("dialog").getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("complementary", { name: "Project documents and model" })).toBeAttached();
  await page.getByRole("textbox", { name: /^(New )?Part name$/ }).fill("Mirrored profile");
  await page.getByRole("button", { name: "Create Part", exact: true }).click();
  await expect(commands(page).getByRole("tab", { name: "Sketch", exact: true })).toBeVisible();
  expect((await savedPart(page)).currentRevisionId).toBeNull();

  const bar = commands(page);
  await bar.getByRole("tab", { name: "Sketch", exact: true }).click();
  await bar.getByRole("combobox", { name: "Sketch plane" }).selectOption("XY");
  await bar.getByRole("button", { name: "New Sketch" }).click();
  await expect(page.getByTestId("sketch-workplane")).toBeVisible();
  for (const [x, y] of [[0, 0], [20, 0], [20, 10], [10, 20], [0, 20], [0, 30]]) await addLinePoint(page, x, y);
  await expect(outline(page).locator("polyline")).toHaveAttribute("points", "0,0 20,0 20,10 10,20 0,20 0,30");

  await bar.getByRole("button", { name: "Trim", exact: true }).click();
  const trim = properties(page).getByRole("form", { name: "Trim parameters" });
  await trim.getByRole("spinbutton", { name: "Edge index" }).fill("4");
  await trim.getByRole("combobox", { name: "Keep side" }).selectOption("start");
  await expect(outline(page).locator('[data-sketch-selected-edge="4"]')).toBeAttached();
  await trim.getByRole("button", { name: "Apply to sketch" }).click();
  await expect(outline(page).locator("polyline")).toHaveAttribute("points", "0,0 20,0 20,10 10,20 0,20");
  await bar.getByRole("button", { name: "Mirror", exact: true }).click();
  const mirror = properties(page).getByRole("form", { name: "Mirror parameters" });
  await mirror.getByRole("combobox", { name: "Mirror axis" }).selectOption("V");
  await expect(outline(page).locator('[data-sketch-selected-axis="V"]')).toBeAttached();
  await mirror.getByRole("button", { name: "Apply to sketch" }).click();
  await expect(outline(page).locator("polygon")).toHaveAttribute("points", "0,0 20,0 20,10 10,20 0,20 -10,20 -20,10 -20,0");
  expect((await savedPart(page)).currentRevisionId).toBeNull();

  await bar.getByRole("button", { name: "Finish Sketch" }).click();
  await bar.getByRole("tab", { name: "Features", exact: true }).click();
  await bar.getByRole("button", { name: "Extrude", exact: true }).click();
  const extrude = properties(page).getByRole("form", { name: "Extrude parameters" });
  await extrude.getByRole("spinbutton", { name: "distance" }).fill("6");
  await extrude.getByRole("button", { name: "Add feature" }).click();
  await expect(bar.getByRole("button", { name: "Commit feature revision" })).toBeDisabled();
  expect((await savedPart(page)).currentRevisionId).toBeNull();

  await bar.getByRole("button", { name: "Preview features" }).click();
  const preview = page.getByTestId("feature-preview");
  await expect(preview).toContainText("Preview only · not committed");
  const evidence = await preview.innerText();
  const match = evidence.match(/(rev-[0-9a-f]{64}) · (\d+) triangles · ([\d.]+) mm³/);
  expect(match, `Evaluated preview evidence: ${evidence}`).not.toBeNull();
  const candidateId = match![1];
  expect(Number(match![2])).toBeGreaterThan(0);
  expect(Number(match![3])).toBeCloseTo(4200, 1);
  await expect(page.getByTestId("feature-mesh-viewport")).toHaveAttribute("data-revision-id", candidateId);
  await expect(page.getByTestId("feature-mesh-viewport").locator("canvas")).toBeVisible();
  await expect(page.getByRole("button", { name: "Download feature review STL (unreleased)" })).toBeEnabled();
  expect((await savedPart(page)).currentRevisionId).toBeNull();
  await page.screenshot({ path: info.outputPath("mirror-trim-preview.png"), fullPage: true });

  await bar.getByRole("button", { name: "Commit feature revision" }).click();
  await expect(page.getByTestId("empty-feature-message")).toContainText("Revision committed:");
  await expect.poll(async () => (await savedPart(page)).currentRevisionId).toBe(candidateId);
  const part = await savedPart(page);
  if (!isFeaturePart(part)) throw new Error("Expected committed feature Part");
  expect(part.revisions).toHaveLength(1);
  expect(part.acceptedRevisionId).toBe(candidateId);
  expect(part.revisions[0]).toMatchObject({ id: candidateId, parentRevisionId: null, reviewState: "needs_human_review", fabricationRelease: false, machineActuation: false, releaseState: "unreleased" });
  const features = readFeatures(part.revisions[0].authored);
  expect(features).toHaveLength(2);
  expect(features[0]).toMatchObject({ kind: "polygon", plane: "XY", vertices: [[0, 0], [20, 0], [20, 10], [10, 20], [0, 20], [-10, 20], [-20, 10], [-20, 0]] });
  expect(features[1]).toMatchObject({ kind: "extrude", profileId: features[0].id, distance: 6 });
  await expect(page.getByTestId("feature-preview")).toHaveCount(0);
  await expect(page.getByTestId("feature-mesh-viewport").locator("canvas")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("feature-mesh-viewport").locator("canvas")).toBeVisible();
  const persisted = await savedPart(page);
  if (!isFeaturePart(persisted)) throw new Error("Committed Part did not survive reload");
  expect(persisted.revisions).toEqual(part.revisions);
  expect(persisted.currentRevisionId).toBe(candidateId);
  expect(pageErrors).toEqual([]);
});
