import { expect, test } from "@playwright/test";

test("R14 shell is bounded at desktop, drawer, compact, and narrow widths", async ({ page }) => {
  for (const width of [1100, 570, 420, 360]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    await expect(page.getByText("Accepted immutable revision")).toBeAttached();
    await expect(page.getByRole("contentinfo", { name: "Persistent safety truth" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.body.scrollWidth)).toBeLessThanOrEqual(width);
  }
});

test("responsive drawers and keyboard skip paths reach their named regions", async ({ page }) => {
  await page.setViewportSize({ width: 570, height: 800 });
  await page.goto("/");
  await expect(page.getByText("Accepted immutable revision")).toBeAttached();

  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to model workspace", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: "Model workspace", exact: true })).toBeFocused();

  const modelToggle = page.getByRole("button", { name: "Model panel", exact: true });
  const custodyToggle = page.getByRole("button", { name: "Revision custody panel", exact: true });
  await expect(modelToggle).toBeVisible();
  await modelToggle.click();
  await expect(modelToggle).toHaveAttribute("aria-expanded", "true");
  await custodyToggle.click();
  await expect(custodyToggle).toHaveAttribute("aria-expanded", "true");
  await expect(modelToggle).toHaveAttribute("aria-expanded", "false");

});
