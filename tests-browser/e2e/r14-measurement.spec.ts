import { expect, test } from "@playwright/test";

test("two-point review-mesh measurement supports pointer and keyboard lifecycle", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Accepted immutable revision")).toBeVisible();

  const viewport = page.getByTestId("assembly-viewport");
  const measure = page.getByRole("button", { name: "Measure review-mesh distance" });
  const output = page.getByTestId("review-measurement");
  const bounds = await viewport.boundingBox();
  if (!bounds) throw new Error("assembly viewport has no bounding box");
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };

  await measure.click();
  await expect(viewport).toHaveAttribute("data-measurement-phase", "armed");
  await expect(viewport).toHaveAttribute("data-controls-enabled", "false");
  await expect(output).toContainText("Choose endpoint A");

  await page.mouse.click(center.x, center.y);
  await expect(viewport).toHaveAttribute("data-measurement-phase", "endpoint-a");
  await page.mouse.move(center.x + 1, center.y);
  await expect(viewport).toHaveAttribute("data-measurement-overlay", "dashed-preview");
  await expect(output).toContainText("Choose endpoint B");
  await page.mouse.click(center.x + 1, center.y);
  await expect(viewport).toHaveAttribute("data-measurement-phase", "complete");
  await expect(viewport).toHaveAttribute("data-measurement-overlay", "solid-complete");
  await expect(viewport).toHaveAttribute("data-controls-enabled", "true");
  await expect(output).toContainText(/Approx\. review-mesh distance [0-9.]+ mm/);

  await measure.click();
  await viewport.focus();
  await page.keyboard.press("Enter");
  await expect(viewport).toHaveAttribute("data-measurement-phase", "endpoint-a");
  await page.keyboard.press("Enter");
  await expect(viewport).toHaveAttribute("data-measurement-phase", "complete");
  await expect(output).toContainText("Approx. review-mesh distance 0 mm");

  await measure.click();
  await viewport.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(viewport).toHaveAttribute("data-measurement-phase", "idle");
  await expect(viewport).toHaveAttribute("data-controls-enabled", "true");
  await expect(output).toContainText("Start a two-point measurement");

  await page.getByRole("button", { name: "Part fixture" }).click();
  const partViewport = page.getByTestId("viewport");
  await expect(page.locator(".viewport-status")).toContainText("Review mesh ready");
  await measure.click();
  await partViewport.focus();
  await page.keyboard.press("Enter");
  await expect(partViewport).toHaveAttribute("data-measurement-phase", "endpoint-a");
  await page.keyboard.press("Enter");
  await expect(partViewport).toHaveAttribute("data-measurement-phase", "complete");
  await expect(partViewport).toHaveAttribute("data-measurement-overlay", "solid-complete");
  await expect(partViewport).toHaveAttribute("data-controls-enabled", "true");

  await expect(page.getByTestId("fabrication-release")).toHaveText("false");
  await expect(page.getByTestId("machine-actuation")).toHaveText("false");
});
