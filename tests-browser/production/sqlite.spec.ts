import { expect, test } from "@playwright/test";

test("production bundle starts SQLite and reloads a project from OPFS", async ({ page }) => {
  const errors: string[] = [];
  const wasmResponses: { status: number; mime: string | undefined }[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("response", response => {
    if (/sqlite3-.*\.wasm$/.test(response.url())) {
      wasmResponses.push({ status: response.status(), mime: response.headers()["content-type"] });
    }
  });
  await page.goto("/");
  await page.getByRole("textbox", { name: "Project name", exact: true }).fill("Production SQLite proof");
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Production SQLite proof", exact: true })).toBeVisible();
  const projectUrl = page.url();
  await page.reload();
  await expect(page).toHaveURL(projectUrl);
  await expect(page.getByRole("heading", { name: "Production SQLite proof", exact: true })).toBeVisible();
  const persisted = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle("piton.sqlite3");
    const file = await handle.getFile();
    return { size: file.size, header: await file.slice(0, 16).text() };
  });
  expect(persisted.size).toBeGreaterThan(0);
  expect(persisted.header).toBe("SQLite format 3\u0000");
  expect(wasmResponses.length).toBeGreaterThan(0);
  for (const response of wasmResponses) {
    expect(response.status).toBe(200);
    expect(response.mime).toContain("application/wasm");
  }
  expect(errors).toEqual([]);
});
