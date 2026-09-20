import { expect, test } from "@playwright/test";
import { openProjectSettings } from "../workspace-fixtures";
import { importBracketFixture, expectActivePart } from "../workspace-fixtures";

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
