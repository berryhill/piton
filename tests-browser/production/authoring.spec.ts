import { expect, test } from "@playwright/test";
import { openProjectSettings, importBracketFixture, expectActivePart } from "../workspace-fixtures";

test("production Part authoring commits, reloads history, exports mesh, and recovers exact bookmarks", async ({ page, browser }) => {
  // This deliberately spans two isolated OPFS contexts and several WASM starts.
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const { projectUrl, documentUrl } = await importBracketFixture(page, "Production authoring", "Camera bracket");
  const dimensions = { leg_length_mm: 112, leg_width_mm: 54, base_length_mm: 138, base_thickness_mm: 9, leg_thickness_mm: 10, hole_diameter_mm: 7 };
  for (const [name, value] of Object.entries(dimensions)) {
    await page.getByRole("spinbutton", { name, exact: true }).fill(String(value));
  }
  await page.getByRole("button", { name: "Propose and preview", exact: true }).click();
  await expect(page.getByRole("button", { name: "Commit revision", exact: true })).toBeEnabled();
  const previewIdentity = await page.locator(".r7-authored-viewport").getAttribute("data-revision-id");
  await page.getByRole("button", { name: "Commit revision", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Project documents and model", exact: true }).getByRole("status")).toContainText("Revision committed");
  await page.reload();
  await expect(page).toHaveURL(documentUrl);
  for (const [name, value] of Object.entries(dimensions)) {
    await expect(page.getByRole("spinbutton", { name, exact: true })).toHaveValue(String(value));
  }
  await expect(page.locator(".r7-authored-viewport")).toHaveAttribute("data-revision-id", previewIdentity!);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Part review STL (unreleased)", exact: true }).click();
  const stl = await download;
  expect(stl.suggestedFilename()).toMatch(/-review-unreleased\.stl$/);
  expect(await stl.failure()).toBeNull();
  await page.getByRole("button", { name: "Revision 1", exact: true }).click();
  const historicalUrl = page.url();
  await expect(page.getByRole("spinbutton", { name: "leg_length_mm", exact: true })).toHaveValue("80");
  await expect(page.getByRole("button", { name: "Commit revision", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Project overview", exact: true }).click();
  await expect(page).toHaveURL(projectUrl);
  const backupDownload = page.waitForEvent("download");
  await openProjectSettings(page);
  await page.getByRole("button", { name: "Export project backup", exact: true }).click();
  const backup = await backupDownload;
  const backupPath = await backup.path();
  expect(backupPath).not.toBeNull();

  const recoveredContext = await browser.newContext();
  try {
    const recovered = await recoveredContext.newPage();
    recovered.on("pageerror", error => errors.push(error.message));
    await recovered.goto(historicalUrl);
    await expect(recovered.getByRole("alert")).toBeVisible();
    await recovered.getByLabel("Recover project backup").setInputFiles(backupPath!);
    await expectActivePart(recovered, "Production authoring", "Camera bracket");
    await expect(recovered).toHaveURL(historicalUrl);
    await expect(recovered.getByRole("spinbutton", { name: "leg_length_mm", exact: true })).toHaveValue("80");
    await recovered.getByRole("button", { name: "Open current revision", exact: true }).click();
    await expect(recovered).toHaveURL(documentUrl);
    await expect(recovered.getByRole("spinbutton", { name: "leg_length_mm", exact: true })).toHaveValue("112");
    await expect(recovered.locator(".r7-status")).toContainText("fabrication_release=false");
    await expect(recovered.locator(".r7-status")).toContainText("machine_actuation=false");
    await recovered.reload();
    await expect(recovered.getByRole("spinbutton", { name: "leg_length_mm", exact: true })).toHaveValue("112");
  } finally {
    await recoveredContext.close();
  }
  expect(errors).toEqual([]);
});

test("production empty-Part authoring commits a named feature source through the GUI affordance", async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto("/");
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  await page.getByRole("textbox", { name: "Project name", exact: true }).fill("Authoring proof");
  await page.getByRole("dialog").getByRole("button", { name: "Create project", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Authoring proof", exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Part name", exact: true }).fill("Plate");
  await page.getByRole("button", { name: "Create Part", exact: true }).click();
  // Project-only route: the named project-level entry point must surface.
  await page.getByRole("button", { name: "All projects", exact: true }).click();
  await page.getByRole("link", { name: "Authoring proof", exact: true }).click();
  await expect(page.getByTestId("open-first-empty-part")).toBeVisible();
  await page.getByTestId("open-first-empty-part").click();
  // Empty-Part tab opens; the named first-feature source affordance is visible.
  await expect(page.getByRole("tab", { name: "Plate", exact: true })).toHaveAttribute("aria-selected", "true");
  const affordance = page.getByTestId("empty-feature-authoring");
  await expect(affordance).toBeVisible();
  await expect(affordance).toHaveAttribute("aria-label", "Part source and revision");
  // Explicitly enter the advanced recipe path; it is not the normal sketch UI.
  await affordance.locator("summary").click();
  const submit = page.getByTestId("submit-first-feature");
  await expect(submit).toBeEnabled();
  await submit.click();
  // Actual review geometry is visible before any authored revision exists.
  await expect(page.getByTestId("feature-preview")).toContainText("Preview only · not committed");
  await expect(page.getByTestId("feature-mesh-viewport").locator("canvas")).toBeVisible();
  const readPart = () => page.evaluate(async () => (await window.pitonWorkspace.read()).projects[0].documents[0].part);
  expect((await readPart()).revisions).toHaveLength(0);
  const previewId = await page.getByTestId("feature-mesh-viewport").getAttribute("data-revision-id");
  await page.getByRole("button", { name: "Commit feature revision", exact: true }).click();
  await expect(page.getByTestId("empty-feature-message")).toContainText("Revision committed:");
  const first = await readPart();
  expect(first.revisions).toHaveLength(1);
  expect(first.currentRevisionId).toBe(previewId);
  await page.getByRole("treeitem", { name: "Features (3)" }).press("ArrowRight");
  await expect(page.getByRole("tree", { name: "Plate model tree" })).toContainText("Plate outline");
  await page.reload();
  await expect(page.getByTestId("feature-mesh-viewport").locator("canvas")).toBeVisible();
  expect(await readPart()).toEqual(first);
  const source = page.getByTestId("feature-source-input");
  await page.getByTestId("empty-feature-authoring").locator("summary").click();
  await source.fill((await source.inputValue()).replace('"width":80', '"width":90'));
  await page.getByTestId("submit-first-feature").click();
  await expect(page.getByTestId("feature-preview")).toBeVisible();
  expect((await readPart()).revisions).toHaveLength(1);
  await page.getByRole("button", { name: "Commit feature revision", exact: true }).click();
  await expect(page.getByTestId("empty-feature-message")).toContainText("Revision committed:");
  const second = await readPart();
  expect(second.revisions).toHaveLength(2);
  expect(second.revisions[0]).toEqual(first.revisions[0]);
  await page.reload();
  await expect(page.getByTestId("feature-mesh-viewport").locator("canvas")).toBeVisible();
  expect(await readPart()).toEqual(second);
  await page.getByRole("button", { name: "Revision 1", exact: true }).click();
  await expect(source).toBeDisabled();
  await expect(source).toHaveValue(/"width":80/);
  // Safety truth remains on the page footer regardless of outcome.
  await expect(page.locator(".r7-status")).toContainText("needs_human_review");
  await expect(page.locator(".r7-status")).toContainText("fabrication_release=false");
  await expect(page.locator(".r7-status")).toContainText("machine_actuation=false");
  expect(errors).toEqual([]);
});

