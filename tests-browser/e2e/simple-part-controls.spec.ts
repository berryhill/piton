import { expect, test, type Page } from "@playwright/test";
import { createEmptyPart } from "../workspace-fixtures";
import { isFeaturePart } from "../../src/workspace";
import { readFeatures } from "../../src/modeling/source";

const commands = (page: Page) => page.getByRole("region", { name: "Part commands" });
const source = (page: Page) => page.getByTestId("feature-source-input");
async function featurePart(page: Page) {
  const state = await page.evaluate(() => window.pitonWorkspace.read());
  const part = state.projects.at(-1)!.documents[0].part;
  if (!isFeaturePart(part)) throw new Error("Expected committed feature Part");
  return part;
}
async function start(page: Page, project: string, part: string) {
  await page.goto("/projects");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByRole("dialog").getByRole("textbox", { name: "Project name" }).fill(project);
  await page.getByRole("dialog").getByRole("button", { name: "Create project" }).click();
  await createEmptyPart(page, part);
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+\/documents\/[0-9a-f-]+$/);
  const bar = commands(page);
  await expect(bar.getByRole("tab")).toHaveText(["Sketch", "Features", "Inspect"]);
  await expect(bar.getByRole("button", { name: "New Sketch" })).toBeDisabled();
  await bar.getByRole("combobox", { name: "Sketch plane" }).selectOption("XY");
  await bar.getByRole("button", { name: "New Sketch" }).click();
  return bar;
}
async function tool(page: Page, name: string, values: Record<string, string> = {}) {
  const bar = commands(page);
  await bar.getByRole("button", { name, exact: true }).click();
  const editor = page.getByRole("complementary", { name: "Change request" }).getByRole("form", { name: `${name} parameters` });
  for (const [key, value] of Object.entries(values)) await editor.getByRole("spinbutton", { name: key }).fill(value);
  await editor.getByRole("button", { name: name === "Rectangle" || name === "Line" || name === "Circle" || name === "Dimension" ? "Apply to sketch" : "Add feature" }).click();
}
async function body(page: Page, shape: "Rectangle" | "Circle" = "Rectangle") {
  await tool(page, shape, shape === "Rectangle" ? { width: "80", height: "50" } : { diameter: "30" });
  await commands(page).getByRole("button", { name: "Finish Sketch" }).click();
  await commands(page).getByRole("tab", { name: "Features" }).click();
  await tool(page, "Extrude", { distance: "6" });
}
async function previewCommit(page: Page, count: number) {
  const bar = commands(page);
  const projectId = page.url().split("/projects/")[1].split("/")[0];
  await bar.getByRole("button", { name: "Preview features" }).click();
  await expect(page.getByTestId("feature-preview")).toContainText("Preview only · not committed");
  await expect(page.getByTestId("feature-mesh-viewport").locator("canvas")).toBeVisible();
  expect((await page.evaluate(async id => (await window.pitonWorkspace.read()).projects.find(project => project.id === id)!.documents[0].part.revisions, projectId))).toHaveLength(count);
  await bar.getByRole("button", { name: "Commit feature revision" }).click();
  await expect(page.getByTestId("empty-feature-message")).toContainText("Revision committed:");
  await expect.poll(async () => (await page.evaluate(async id => (await window.pitonWorkspace.read()).projects.find(project => project.id === id)!.documents[0].part.revisions.length, projectId))).toBe(count + 1);
}

test("UI-only plate, through-hole pattern, review measurement, immutable reload", async ({ page }) => {
  test.setTimeout(120_000);
  const bar = await start(page, "Controls proof", "Plate");
  await body(page);
  await previewCommit(page, 0);
  await tool(page, "Hole", { x: "15", y: "15", diameter: "5" });
  await tool(page, "Linear Pattern", { count: "3", spacingX: "20", spacingY: "0" });
  await previewCommit(page, 1);
  const saved = await page.evaluate(() => window.pitonWorkspace.read());
  const part = await featurePart(page);
  expect(part.revisions).toHaveLength(2);
  expect(part.revisions[0]).toMatchObject({ reviewState: "needs_human_review", fabricationRelease: false, machineActuation: false });
  expect(part.revisions[1]).toMatchObject({ reviewState: "needs_human_review", fabricationRelease: false, machineActuation: false });
  expect(part.revisions[1].authored.source).toContain('"count":3,"spacingX":20');
  await bar.getByRole("tab", { name: "Inspect" }).click();
  await bar.getByRole("button", { name: "Measure" }).click();
  const canvas = page.getByTestId("feature-mesh-viewport").locator("canvas");
  await canvas.focus();
  await page.keyboard.press("Enter");
  await expect(bar.getByTestId("feature-measurement")).toContainText("Select second point");
  await page.keyboard.press("Enter");
  await expect(bar.getByTestId("feature-measurement")).toContainText("review-only, not exact B-rep");
  await bar.getByRole("button", { name: "Clear" }).click();
  await expect(bar.getByTestId("feature-measurement")).toContainText("choose Measure");
  const url = page.url();
  await page.reload();
  await expect(page).toHaveURL(url);
  await expect(page.getByTestId("feature-mesh-viewport").locator("canvas")).toBeVisible();
  expect(await page.evaluate(() => window.pitonWorkspace.read())).toEqual(saved);
  await expect(source(page)).toHaveValue(part.revisions[1].authored.source);
  await page.getByRole("button", { name: "Revision 1" }).click();
  await expect(source(page)).toBeDisabled();
  await expect(source(page)).toHaveValue(part.revisions[0].authored.source);
  await expect(commands(page).getByRole("button", { name: "Preview features" })).toBeDisabled();
});

test("line polygon extrusion stays available through controls", async ({ page }) => {
  test.setTimeout(90_000);
  const bar = await start(page, "Polygon proof", "Triangle");
  for (const [x, y] of [[0, 0], [80, 0], [0, 50]]) await tool(page, "Line", { x: String(x), y: String(y) });
  await bar.getByRole("button", { name: "Close Line" }).click();
  await bar.getByRole("button", { name: "Finish Sketch" }).click();
  await bar.getByRole("tab", { name: "Features" }).click();
  await tool(page, "Extrude", { distance: "6" });
  await previewCommit(page, 0);
  expect((await featurePart(page)).revisions[0].authored.source).toContain("part.polygon");
});

test("full revolve through controls on a separate Part", async ({ page }) => {
  test.setTimeout(90_000);
  const bar = await start(page, "Revolve proof", "Turned part");
  await tool(page, "Rectangle", { width: "20", height: "30" });
  await bar.getByRole("button", { name: "Finish Sketch" }).click();
  await bar.getByRole("tab", { name: "Features" }).click();
  await tool(page, "Revolve");
  await previewCommit(page, 0);
  expect((await featurePart(page)).revisions[0].authored.source).toContain('"angleDegrees":360');
});

test("fillet and chamfer each realize on separate rectangular Parts", async ({ page }) => {
  test.setTimeout(120_000);
  for (const finish of ["Fillet", "Chamfer"]) {
    await start(page, `${finish} proof`, `${finish} plate`);
    await body(page);
    await tool(page, finish, finish === "Fillet" ? { radius: "2" } : { distance: "2" });
    await previewCommit(page, 0);
    const part = await featurePart(page);
    expect(part.revisions[0].authored.source).toContain(`part.${finish.toLowerCase()}`);
    await page.reload();
    await expect(page.getByTestId("feature-mesh-viewport").locator("canvas")).toBeVisible();
  }
});

test("invalid and cancelled sketches never promote; failed preview retains last good", async ({ page }) => {
  test.setTimeout(90_000);
  const bar = await start(page, "Gates proof", "Plate");
  await tool(page, "Rectangle", { width: "0" });
  await expect(bar.getByRole("alert")).toContainText("Dimension");
  await expect(bar.getByRole("button", { name: "Finish Sketch" })).toBeDisabled();
  await bar.getByRole("button", { name: "Cancel Sketch" }).click();
  expect((await page.evaluate(() => window.pitonWorkspace.read())).projects[0].documents[0].part.revisions).toHaveLength(0);
  await bar.getByRole("button", { name: "New Sketch" }).click();
  await body(page);
  await previewCommit(page, 0);
  const before = await page.evaluate(() => window.pitonWorkspace.read());
  await tool(page, "Hole", { x: "79", y: "49", diameter: "5" });
  await expect(bar.getByRole("alert")).toContainText("Hole must remain inside");
  expect(await page.evaluate(() => window.pitonWorkspace.read())).toEqual(before);
  await expect(bar.getByRole("button", { name: "Commit feature revision" })).toBeDisabled();
  await page.reload();
  const savedPart = before.projects[0].documents[0].part;
  if (!isFeaturePart(savedPart)) throw new Error("Expected retained feature Part");
  await expect(source(page)).toHaveValue(savedPart.revisions[0].authored.source);
});

test("history displays its mesh with a pending preview and restores the current draft", async ({ page }) => {
  const bar = await start(page, "History draft proof", "Plate");
  await body(page);
  await previewCommit(page, 0);
  const saved = await featurePart(page);
  await tool(page, "Hole", { x: "15", y: "15", diameter: "5" });
  const draft = await source(page).inputValue();
  await bar.getByRole("button", { name: "Preview features", exact: true }).click();
  await expect(page.getByTestId("feature-preview")).toBeVisible();
  const candidate = await page.getByTestId("feature-mesh-viewport").getAttribute("data-revision-id");
  await page.getByRole("button", { name: "Revision 1", exact: true }).click();
  await expect(source(page)).toHaveValue(saved.revisions[0].authored.source);
  await expect(source(page)).toBeDisabled();
  await expect(page.getByTestId("feature-mesh-viewport")).toHaveAttribute("data-revision-id", saved.currentRevisionId!);
  await expect(page.getByTestId("feature-mesh-viewport").locator("canvas")).toBeVisible();
  await expect(page.getByTestId("feature-preview")).toHaveCount(0);
  await page.getByRole("button", { name: "Open current revision", exact: true }).click();
  await expect(source(page)).toHaveValue(draft);
  await expect(page.getByTestId("feature-preview")).toContainText(candidate!);
  await expect(page.getByTestId("feature-mesh-viewport")).toHaveAttribute("data-revision-id", candidate!);
  expect(await featurePart(page)).toEqual(saved);
});

test("external advancement blocks a retained local draft until explicit reload", async ({ page }) => {
  const bar = await start(page, "External advancement proof", "Plate");
  await body(page);
  await previewCommit(page, 0);
  const first = await featurePart(page);
  const bodyFeature = readFeatures(first.revisions[0].authored).find(feature => feature.kind === "extrude");
  if (!bodyFeature) throw new Error("Expected authored extrusion");
  await tool(page, "Hole", { x: "15", y: "15", diameter: "5" });
  const local = await source(page).inputValue();
  await page.evaluate(async bodyId => {
    const state = await window.pitonWorkspace.read();
    const ids = location.pathname.split("/");
    const document = state.projects.find(project => project.id === ids[2])!.documents.find(part => part.id === ids[4])!;
    const pointer = Object.keys(document.revisionIds).find(id => document.revisionIds[id] === document.part.currentRevisionId)!;
    const proposal = await window.pitonWorkspace.proposeFeatures({
      projectId: ids[2], documentId: ids[4], expectedRevisionId: pointer,
      idempotencyKey: crypto.randomUUID(), units: "mm",
      features: [{ kind: "hole", id: "external", name: "External hole", bodyId, x: 5, y: 5, diameter: 2, extent: "through" }],
    });
    await window.pitonWorkspace.commitFeatures(proposal.proposal);
  }, bodyFeature.id);
  await expect(page.getByRole("alert")).toContainText("Part changed since this draft began");
  await expect(source(page)).toHaveValue(local);
  await expect(bar.getByRole("button", { name: "Preview features", exact: true })).toBeDisabled();
  await expect(bar.getByRole("button", { name: "Commit feature revision", exact: true })).toBeDisabled();
  const latest = await featurePart(page);
  expect(latest.revisions).toHaveLength(2);
  expect(latest.revisions[1].authored.source).toContain('"id":"external"');
  await page.getByRole("button", { name: "Reload latest revision", exact: true }).click();
  await expect(source(page)).toHaveValue(latest.revisions[1].authored.source);
  await expect(bar.getByRole("button", { name: "Preview features", exact: true })).toBeEnabled();
  expect(await featurePart(page)).toEqual(latest);
});
