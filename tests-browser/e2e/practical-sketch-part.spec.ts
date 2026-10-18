import { expect, test, type Page } from "@playwright/test";
import { readFeatures } from "../../src/modeling/source";
import { isFeaturePart } from "../../src/workspace";

const commands = (page: Page) => page.getByRole("region", { name: "Part commands" });
const properties = (page: Page) => page.getByRole("complementary", { name: "Change request" });
const source = (page: Page) => page.getByTestId("feature-source-input");

async function savedPart(page: Page) {
  const state = await page.evaluate(() => window.pitonWorkspace.read());
  const ids = new URL(page.url()).pathname.split("/");
  const part = state.projects.find(project => project.id === ids[2])?.documents.find(document => document.id === ids[4])?.part;
  if (!part || !isFeaturePart(part)) throw new Error("Expected saved feature Part at the current route");
  return part;
}

async function openProperties(page: Page) {
  if (!(await properties(page).isVisible())) await page.getByRole("button", { name: "Change Request", exact: true }).first().click();
}
async function openProject(page: Page) {
  await expect(page.getByRole("complementary", { name: "Project documents and model" })).toBeAttached();
  if (!(await page.locator(".r7-left").isVisible())) await page.getByRole("button", { name: "☰ Project", exact: true }).first().click();
}
async function sketch(page: Page, support?: string) {
  const bar = commands(page);
  if(support) {
    const mesh=page.getByTestId('feature-mesh-viewport');
    const top=mesh.getByRole('button',{name:'Top',exact:true});await expect(top).toBeEnabled();
    await top.click();
    const bounds=(await mesh.locator('canvas').boundingBox())!;
    await page.mouse.click(bounds.x+bounds.width/2,bounds.y+bounds.height/2);
    await bar.getByRole('tab',{name:'Sketch',exact:true}).click();
    await expect(bar).toContainText(`Selected support: ${support.replace(':',' ')} cap`);
    await bar.getByRole('button',{name:'Sketch on selected face',exact:true}).click();
    await expect(page.getByTestId('sketch-workplane')).toBeVisible();return;
  }
  await bar.getByRole("tab", { name: "Sketch", exact: true }).click();
  await bar.getByRole("combobox", { name: "Sketch plane" }).selectOption("XY");
  if (support) await bar.getByRole("combobox", { name: "Sketch support" }).selectOption(support);
  await bar.getByRole("button", { name: "New Sketch" }).click();
  await expect(page.getByTestId("sketch-workplane")).toBeVisible();
}
/** Draw in local millimetres using the SVG's actual screen transform. */
async function dragSketch(page: Page, start: [number, number], end: [number, number]) {
  const svg = page.getByRole("img", { name: "Sketch-only 2D preview" });
  await expect(svg).toBeVisible();
  const points = await svg.evaluate((node, [a, b]) => {
    const matrix = (node as SVGSVGElement).getScreenCTM();
    if (!matrix) throw new Error("SVG screen CTM unavailable");
    return [a, b].map(([x, y]) => {
      const p = new DOMPoint(x, y).matrixTransform(matrix);
      return { x: p.x, y: p.y };
    });
  }, [start, end]);
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  await page.mouse.move(points[1].x, points[1].y, { steps: 8 });
  await page.mouse.up();
}
async function feature(page: Page, name: "Extrude" | "Cut Extrude", distance: string, direction: string, end?: string) {
  const bar = commands(page);
  await bar.getByRole("tab", { name: "Features", exact: true }).click();
  await bar.getByRole("button", { name, exact: true }).click();
  await openProperties(page);
  const form = properties(page).getByRole("form", { name: `${name} parameters` });
  await form.getByRole("spinbutton", { name: "distance" }).fill(distance);
  await form.getByRole("combobox", { name: "Direction" }).selectOption(direction);
  if (end) await form.getByRole("combobox", { name: "End condition" }).selectOption(end);
  await form.getByRole("button", { name: "Add feature" }).click();
}
async function previewCommit(page: Page, count: number, screenshot: string) {
  const bar = commands(page);
  await bar.getByRole("button", { name: "Preview features" }).click();
  await expect(page.getByTestId("feature-preview")).toContainText("Preview only · not committed");
  await expect(page.getByTestId("feature-mesh-viewport").locator("canvas")).toBeVisible();
  if (count) expect((await savedPart(page)).revisions).toHaveLength(count);
  await page.screenshot({ path: screenshot, fullPage: true });
  await bar.getByRole("button", { name: "Commit feature revision" }).click();
  await expect(page.getByTestId("empty-feature-message")).toContainText("Revision committed:");
  await expect.poll(async () => (await savedPart(page)).revisions.length).toBe(count + 1);
}
async function treeFeature(page: Page, label: RegExp) {
  await openProject(page);
  const folder=page.getByRole('treeitem',{name:/^Features \(\d+\)$/});
  if(await folder.getAttribute('aria-expanded')!=="true")await folder.press('ArrowRight');
  const row = page.getByRole("treeitem", { name: label }).first();
  await row.click();
  await openProperties(page);
  await expect(properties(page).getByRole("region", { name: "Selected feature editing" })).toBeVisible();
}

test("pointer-authored sketches become a cap cut, boss, and editable immutable Part", async ({ page }, info) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/projects");
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Project name" }).fill("Practical sketch part");
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading",{name:"Practical sketch part",exact:true})).toBeVisible();
  await openProject(page);
  await page.getByRole("textbox", { name: /^(New )?Part name$/ }).fill("Plate");
  await page.getByRole("button", { name: "Create Part", exact: true }).click();
  await sketch(page);
  await commands(page).getByRole("button", { name: "Rectangle", exact: true }).click();
  await dragSketch(page, [0, 0], [40, 25]);
  await expect(page.getByTestId("sketch-workplane")).toContainText("40.00 × 25.00 mm");
  await openProperties(page);
  const rectangle = properties(page).getByRole("form", { name: "Rectangle parameters" });
  await rectangle.getByRole("spinbutton", { name: "width",exact:true }).fill("80");
  await rectangle.getByRole("spinbutton", { name: "height",exact:true }).fill("50");
  await rectangle.getByRole("button", { name: "Apply to sketch",exact:true }).click();
  await rectangle.getByRole("button", { name: "Drive width" }).click();

  await rectangle.getByRole("button", { name: "Drive height" }).click();
  await rectangle.getByRole("button", { name: "Constrain origin" }).click();
  await expect(page.getByTestId("sketch-workplane")).toContainText("fully defined");
  await page.screenshot({ path: info.outputPath("first-sketch.png"), fullPage: true });
  await commands(page).getByRole("button", { name: "Finish Sketch" }).click();
  await feature(page, "Extrude", "6", "forward");
  await previewCommit(page, 0, info.outputPath("first-mesh.png"));
  const first = await savedPart(page);
  const f1 = readFeatures(first.revisions[0].authored);
  expect(f1[0]).toMatchObject({ kind: "rectangle", plane: "XY", width: 80, height: 50 });
  expect('origin' in f1[0]?f1[0].origin??[0,0]:[0,0]).toEqual([0,0]);
  expect(f1[1]).toMatchObject({ kind: "extrude", profileId: f1[0].id, distance: 6 });
  expect(new Set(f1.map(f => f.id)).size).toBe(f1.length);

  await sketch(page, `${f1[1].id}:end`);
  await commands(page).getByRole("button", { name: "Circle", exact: true }).click();
  await dragSketch(page, [20, 20], [25, 20]);
  await expect(page.getByTestId("sketch-workplane")).toContainText("Ø 10.00 mm");
  await commands(page).getByRole("button", { name: "Finish Sketch" }).click();
  await feature(page, "Cut Extrude", "6", "reverse", "throughAll");
  await previewCommit(page, 1, info.outputPath("cut-mesh.png"));
  const second = await savedPart(page);
  expect(second.revisions[0].authored.source).toBe(first.revisions[0].authored.source);
  const f2 = readFeatures(second.revisions[1].authored);
  expect(f2[2]).toMatchObject({ kind: "circle", support: { kind: "extrusionCap", featureId: f1[1].id, side: "end" } });
  if(f2[2].kind!=="circle")throw new Error('Expected circle');
  expect(f2[2].diameter).toBeCloseTo(10,4);expect(f2[2].origin?.[0]).toBeCloseTo(20,4);expect(f2[2].origin?.[1]).toBeCloseTo(20,4);
  expect(f2[3]).toMatchObject({ kind: "extrude", profileId: f2[2].id, targetBodyId: f1[1].id, operation: "cut", direction: "reverse", endCondition: "throughAll" });
  expect(new Set(f2.map(f => f.id)).size).toBe(f2.length);

  await sketch(page, `${f1[1].id}:end`);
  await commands(page).getByRole("button", { name: "Rectangle", exact: true }).click();
  await dragSketch(page, [30, 5], [40, 15]);
  await commands(page).getByRole("button", { name: "Finish Sketch" }).click();
  await feature(page, "Extrude", "3", "forward");
  await previewCommit(page, 2, info.outputPath("boss-mesh.png"));
  const third = await savedPart(page);
  const f3 = readFeatures(third.revisions[2].authored);
  expect(f3).toHaveLength(6);
  expect(new Set(f3.map(f => f.id)).size).toBe(6);
  expect(f3[5]).toMatchObject({ kind: "extrude", operation: "add", targetBodyId: f2[3].id, profileId: f3[4].id });

  await treeFeature(page, /^Sketch profile · rectangle$/);
  await properties(page).getByRole("button", { name: "Edit Sketch" }).click();
  await commands(page).getByRole("button",{name:"Dimension",exact:true}).click();
  const editSketch = properties(page).getByRole("form", { name: "Dimension parameters" });
  await editSketch.getByRole("spinbutton", { name: "width" }).fill("100");
  await editSketch.getByRole("button", { name: "Apply to sketch" }).click();
  await commands(page).getByRole("button", { name: "Finish Sketch" }).click();
  await previewCommit(page, 3, info.outputPath("edited-sketch-mesh.png"));
  await treeFeature(page, /^Extrusion · extrude$/);
  await properties(page).getByRole("button", { name: "Edit Feature" }).click();
  const editFeature = properties(page).getByRole("form", { name: "Edit Feature parameters" });
  await editFeature.getByRole("spinbutton", { name: "distance" }).fill("10");
  await editFeature.getByRole("button", { name: "Apply Edit" }).click();
  await previewCommit(page, 4, info.outputPath("edited-depth-mesh.png"));
  const current = await savedPart(page);
  expect(current.revisions).toHaveLength(5);
  for (const [index, old] of [first, second, third].entries()) expect(current.revisions[index].authored.source).toBe(old.revisions[index].authored.source);
  const latest = readFeatures(current.revisions[4].authored);
  expect(latest[0]).toMatchObject({ width: 100 });
  expect(latest[1]).toMatchObject({ distance: 10 });
  expect(current.revisions.every(r => r.reviewState === "needs_human_review" && !r.fabricationRelease && !r.machineActuation)).toBe(true);
  await page.reload();
  await expect(page.getByTestId("feature-mesh-viewport").locator("canvas")).toBeVisible();
  await expect(source(page)).toHaveValue(current.revisions[4].authored.source);
  await page.getByRole("button", { name: "Revision 1", exact: true }).click();
  await expect(source(page)).toHaveValue(first.revisions[0].authored.source);
  await page.getByRole("button", { name: "Open current revision" }).click();
  await expect(source(page)).toHaveValue(current.revisions[4].authored.source);
  expect(errors).toEqual([]);
});
