import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { importBracketFixture, expectActivePart, expectEmptyParts } from "../workspace-fixtures";

test("review STL contains own Part geometry and cannot download stale proposal meshes", async ({ page }) => {
  await importBracketFixture(page, "Export checks", "Wide mount");
  const downloadButton = page.getByRole("button", { name: "Download Part review STL (unreleased)", exact: true });
  await expect(downloadButton).toBeEnabled();
  await page.getByRole("spinbutton", { name: "base_length_mm", exact: true }).fill("155");
  await page.getByRole("button", { name: "Propose and preview", exact: true }).click();
  await expect(page.getByRole("button", { name: "Commit revision", exact: true })).toBeEnabled();
  const event = page.waitForEvent("download");
  await downloadButton.click();
  const download = await event;
  expect(download.suggestedFilename()).toMatch(/-review-unreleased\.stl$/);
  const text = await readFile((await download.path())!, "utf8");
  expect(text).toContain("facet normal");
  const vertices = [...text.matchAll(/vertex\s+([\d.e+-]+)\s+([\d.e+-]+)\s+([\d.e+-]+)/g)].map(match => match.slice(1).map(Number));
  expect(vertices.length).toBeGreaterThan(0);
  expect(Math.max(...vertices.map(v => v[0]))).toBeCloseTo(155);
  expect(Math.min(...vertices.map(v => v[2]))).toBeCloseTo(0);
  await page.getByRole("button", { name: "Discard preview", exact: true }).click();
  await expect(page.getByRole("spinbutton", { name: "base_length_mm", exact: true })).toHaveValue("120");
  await expect(page.getByRole("button", { name: "Commit revision", exact: true })).toBeDisabled();
});

test("narrow and desktop project pages remain bounded and keyboard-accessible", async ({ page }) => {
  await page.goto("/projects");
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 850 });
    await expect(page.getByRole("button", { name: "Create project", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  await page.getByRole("textbox", { name: "Project name", exact: true }).fill("Keyboard project");
  await page.getByRole("textbox", { name: "Project name", exact: true }).press("Enter");
  await expect(page.getByRole("heading", { name: "Keyboard project", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "☰ Project", exact: true }).press("Enter");
  await page.getByRole("textbox", { name: "Part name", exact: true }).fill("Keyboard part");
  await page.getByRole("textbox", { name: "Part name", exact: true }).press("Enter");
  await expectActivePart(page, "Keyboard project", "Keyboard part");
  await expectEmptyParts(page, "Keyboard project", ["Keyboard part"]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
