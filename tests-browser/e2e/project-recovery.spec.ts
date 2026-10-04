import { expect, test } from "@playwright/test";
import { openProjectSettings } from "../workspace-fixtures";
import { importBracketFixture, expectActivePart } from "../workspace-fixtures";

test("discovers legacy default custody without seeding or losing its history", async ({page}) => {
  await page.goto("/demo");
  await expect(page.getByText("Reopened from SQLite WASM · OPFS",{exact:true})).toBeVisible();
  await page.goto("/projects");
  await page.getByText("Import or recover a project", { exact: true }).click();
  await page.getByRole("button",{name:"Discover legacy default project",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Documents",exact:true})).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("project backup restores original document bookmark in another browser storage", async ({ page, browser }) => {
  await importBracketFixture(page, "Portable project", "Portable part");
  const bookmark=page.url();
  await page.getByRole("button",{name:"Project overview",exact:true}).click();
  const pending=page.waitForEvent("download");
  await openProjectSettings(page);
  await page.getByRole("button",{name:"Export project backup",exact:true}).click();
  const download=await pending;
  const context=await browser.newContext();
  try {
    const other=await context.newPage(); await other.goto(bookmark);
    await expect(other.getByRole("alert")).toContainText("not found");
    await other.getByLabel("Recover project backup").setInputFiles((await download.path())!);
    await expectActivePart(other, "Portable project", "Portable part");
    await expect(other).toHaveURL(bookmark);
    await other.reload();
    await expect(other.getByRole("spinbutton",{name:"leg_length_mm",exact:true})).toHaveValue("80");
  } finally {await context.close();}
});

test("editing or invalidating structured request revokes previous commit readiness", async ({page}) => {
  await importBracketFixture(page, "Request check", "Part");
  await page.getByText("Advanced · structured change request", { exact: true }).click();
  const input=page.getByRole("textbox",{name:"Structured change request",exact:true});
  await input.fill(JSON.stringify({leg_length_mm:100,leg_width_mm:40,base_length_mm:120,base_thickness_mm:8,leg_thickness_mm:8,hole_diameter_mm:6.5}));
  await page.getByRole("button",{name:"Prepare change proposal",exact:true}).click();
  await expect(page.getByRole("button",{name:"Commit revision",exact:true})).toBeEnabled();
  await input.fill("invalid JSON");
  await expect(page.getByRole("button",{name:"Commit revision",exact:true})).toBeDisabled();
  await page.getByRole("button",{name:"Prepare change proposal",exact:true}).click();
  await expect(page.getByRole("complementary", { name: "Project documents and model", exact: true }).getByRole("status")).toContainText("SyntaxError");
  await expect(page.getByRole("button",{name:"Commit revision",exact:true})).toBeDisabled();
  await page.reload();
  await expect(page.getByRole("spinbutton",{name:"leg_length_mm",exact:true})).toHaveValue("80");
});
