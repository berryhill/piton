import { expect, test } from "@playwright/test";

for (const width of [1440, 390]) {
  test(`create modal supports cancellation, focus and keyboard creation at ${width}px`, async ({page}) => {
    await page.setViewportSize({width,height:844});
    await page.goto("/projects");
    const opener=page.locator("header").getByRole("button",{name:"Create project",exact:true});
    await expect(page.getByRole("textbox",{name:"Project name",exact:true})).not.toBeVisible();
    await opener.press("Enter");
    const dialog=page.getByRole("dialog",{name:"Create project",exact:true});
    const name=dialog.getByRole("textbox",{name:"Project name",exact:true});
    await expect(name).toBeFocused();
    expect(await dialog.evaluate(el=>el.matches(":modal"))).toBe(true);
    const box=await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x+box!.width).toBeLessThanOrEqual(width);
    await name.fill("Discarded draft");
    await name.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(opener).toBeFocused();
    await opener.press("Enter");
    await expect(name).toHaveValue("");
    await expect(name).toBeFocused();
    await name.press("Tab");
    await expect(dialog.getByRole("button",{name:"Cancel",exact:true})).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button",{name:"Create project",exact:true})).toBeFocused();
    await page.keyboard.press("Tab");
    // Chromium may visit browser chrome before cycling into the native dialog.
    await expect(opener).not.toBeFocused();
    if (!(await name.evaluate(el=>el===document.activeElement))) await page.keyboard.press("Tab");
    await expect(name).toBeFocused();
    await dialog.getByRole("button",{name:"Cancel",exact:true}).click();
    await expect(opener).toBeFocused();
    expect(await page.evaluate(async()=>(await window.pitonWorkspace.read()).projects)).toEqual([]);
    await opener.press("Enter");
    await name.fill("Keyboard empty project");
    await name.press("Enter");
    await expect(page.getByTestId("empty-project-viewport")).toBeVisible();
    expect(await page.evaluate(async()=>(await window.pitonWorkspace.read()).projects.map(p=>({name:p.name,documents:p.documents})))).toEqual([{name:"Keyboard empty project",documents:[]}]);
  });
}
