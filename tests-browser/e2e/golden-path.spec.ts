import { expect, test } from "@playwright/test";

test("seeded edit preview commit and OPFS reload remain unreleased", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Accepted immutable revision")).toBeVisible();
  await expect(page.locator(".viewport-status")).toHaveText("Review mesh ready · CAD Z-min 0 on grid");
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-cad-z-min", "0");
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-build-plane-z", "0");
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-controls", "orbit pan zoom");
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-build-volume", "350 × 350 × 350 mm");
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-rendered-bbox", /120 × 40 × 88/);
  expect(Number(await page.getByTestId("viewport").getAttribute("data-rendered-vertex-count"))).toBeGreaterThan(16);
  const canvas = page.getByTestId("viewport").locator("canvas");
  await expect(canvas).toBeVisible();
  const beforeOrbit = await canvas.screenshot();
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error("viewport canvas has no bounding box");
  await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + canvasBox.width / 2 + 35, canvasBox.y + canvasBox.height / 2 + 15);
  await page.mouse.up();
  await page.mouse.wheel(0, -240);
  expect((await canvas.screenshot()).equals(beforeOrbit)).toBe(false);
  const beforeRoll = await canvas.screenshot();
  await page.getByRole("button", { name: "Roll 15°" }).click();
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-view-state", "rolled");
  expect((await canvas.screenshot()).equals(beforeRoll)).toBe(false);
  await page.getByRole("button", { name: "Reset / fit" }).click();
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-view-state", "fit-to-rendered-bbox");
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-fit-distance", /\d+\.\d{3}/);
  await expect(page.getByTestId("fabrication-release")).toHaveText("false");
  await expect(page.getByTestId("machine-actuation")).toHaveText("false");

  const acceptedId = await page.locator(".state-card code").first().textContent();
  const input = page.getByLabel("Leg length (mm)");
  const oldValue = Number(await input.inputValue());
  const newValue = oldValue === 92 ? 100 : 92;
  await input.fill(String(newValue));
  await expect(page.getByText(`${oldValue} mm → ${newValue} mm`)).toBeVisible();
  await expect(page.getByText("Preview only · not committed")).toBeVisible();
  await expect(page.locator(".viewport-status")).toHaveText("Review mesh ready · CAD Z-min 0 on grid");
  await page.getByRole("button", { name: "Commit candidate" }).click();
  await expect(page.getByText("Candidate committed locally")).toBeVisible();

  await page.reload();
  await expect(page.getByText("Reopened from SQLite WASM · OPFS")).toBeVisible();
  await expect(page.getByLabel("Leg length (mm)")).toHaveValue(String(newValue));
  await expect(page.locator(".state-card code").first()).toHaveText(acceptedId!);
  await expect(page.getByTestId("fabrication-release")).toHaveText("false");
  await expect(page.getByTestId("machine-actuation")).toHaveText("false");
  await expect(page.locator(".viewport-status")).toContainText("CAD Z-min 0 on grid");
});

test("SQLite WASM reports migrated schema and direct durable readback", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Accepted immutable revision")).toBeVisible();

  const evidence = await page.evaluate(async () => {
    const { SqliteOpfsProjectRepository } = await import("../../browser-src/storage/repository");
    const repository = await SqliteOpfsProjectRepository.open();
    return repository.readMigrationEvidence();
  });

  expect(evidence).toEqual({
    sqliteUserVersion: 2,
    projectSchemaVersion: 2,
    projectId: "piton-seeded-l-bracket",
    revisionCount: expect.any(Number),
    currentRevisionReadback: expect.stringMatching(/^rev-[0-9a-f]{64}$/),
    tables: ["build_status", "projects", "revisions"],
  });
  expect(evidence.revisionCount).toBeGreaterThanOrEqual(1);
});
