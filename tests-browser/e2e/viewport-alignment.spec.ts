import { expect, test, type Page } from "@playwright/test";

const commands=(page:Page)=>page.getByRole("region",{name:"Part commands"});
async function project(page:Page,name:string){
  await page.goto("/projects");
  await page.getByRole("button",{name:"Create project",exact:true}).click();
  const dialog=page.getByRole("dialog");
  await dialog.getByRole("textbox",{name:"Project name",exact:true}).fill(name);
  await dialog.getByRole("button",{name:"Create project",exact:true}).click();
  await expect(page.getByRole("heading",{name,exact:true})).toBeVisible();
}
async function openProjectPanel(page:Page){
  if(!await page.locator(".r7-left").isVisible())await page.getByRole("button",{name:"☰ Project",exact:true}).first().click();
}
async function closePanels(page:Page){
  for(const name of ["Close Project panel","Close Change Request"]){
    const button=page.getByRole("button",{name,exact:true});
    if(await button.isVisible())await button.click();
  }
}
async function emptyPart(page:Page,name:string){
  await openProjectPanel(page);
  const form=page.locator(".r7-left form").filter({has:page.getByRole("button",{name:"Create Part",exact:true})});
  await form.getByRole("textbox").fill(name);
  await form.getByRole("button",{name:"Create Part",exact:true}).click();
  await expect(page.getByRole("tab",{name,exact:true})).toHaveAttribute("aria-selected","true");
  await closePanels(page);
}
async function oneViewport(page:Page,mode:"empty"|"sketch"|"solid"){
  const body=page.getByTestId("workbench-viewport-body"),slot=page.getByTestId("workbench-command-slot");
  await expect(body).toHaveCount(1);
  const renderer=body.locator(mode==="empty"?'[data-testid="empty-project-viewport"]':mode==="sketch"?'[data-testid="sketch-workplane"]':'[data-testid="feature-mesh-viewport"]');
  await expect(renderer).toBeVisible();
  await expect(body.locator('.r7-empty-viewport:visible,.r7-sketch-workplane:visible')).toHaveCount(1);
  if(mode!=="empty")await expect(page.getByTestId("empty-project-viewport")).toHaveCount(0);
  const b=(await body.boundingBox())!,panel=(await page.locator(".r7-document-panel").boundingBox())!,s=(await slot.boundingBox())!,r=(await renderer.boundingBox())!;
  expect(b.height).toBeGreaterThan(panel.height*0.6);
  expect(s.y+s.height).toBeLessThanOrEqual(b.y+1);
  expect(r.x).toBeGreaterThanOrEqual(b.x-1);expect(r.x+r.width).toBeLessThanOrEqual(b.x+b.width+1);
  expect(r.y).toBeGreaterThanOrEqual(b.y-1);expect(r.y+r.height).toBeLessThanOrEqual(b.y+b.height+1);
  for(const name of ["Sketch","Features","Inspect"]){
    const tab=commands(page).getByRole("tab",{name,exact:true});await expect(tab).toBeVisible();
    const t=(await tab.boundingBox())!;expect(t.y).toBeGreaterThanOrEqual(s.y-1);expect(t.y+t.height).toBeLessThanOrEqual(s.y+s.height+1);
  }
}
for(const viewport of [{width:1920,height:1080},{width:1280,height:720},{width:390,height:844}]){
  test(`one viewport and reachable properties through sketch/solid/history at ${viewport.width}px`,async({page},info)=>{
    test.setTimeout(90000);await page.setViewportSize(viewport);
    await project(page,`Viewport alignment ${viewport.width}`);await emptyPart(page,"Plate");
    await oneViewport(page,"empty");
    await expect(page.locator(".r7-advanced-source")).not.toHaveAttribute("open");
    const bar=commands(page);
    await bar.getByRole("combobox",{name:"Sketch plane",exact:true}).selectOption("XY");
    await bar.getByRole("button",{name:"New Sketch",exact:true}).click();
    await oneViewport(page,"sketch");
    await bar.getByRole("button",{name:"Rectangle",exact:true}).click();
    const properties=page.getByRole("form",{name:"Rectangle parameters",exact:true});await expect(properties).toBeVisible();
    expect(await properties.evaluate(node=>!!node.closest(".r7-right"))).toBe(true);
    await properties.getByRole("spinbutton",{name:"width",exact:true}).fill("80");
    await properties.getByRole("spinbutton",{name:"height",exact:true}).fill("50");
    await properties.getByRole("button",{name:"Apply to sketch",exact:true}).click();await closePanels(page);
    await oneViewport(page,"sketch");
    const svg=(await page.getByRole("img",{name:"Sketch-only 2D preview",exact:true}).boundingBox())!,body=(await page.getByTestId("workbench-viewport-body").boundingBox())!;
    expect(svg.width).toBeGreaterThan(body.width*0.7);expect(svg.height).toBeGreaterThan(body.height*0.6);
    await page.screenshot({path:info.outputPath(`sketch-${viewport.width}.png`),fullPage:true});
    await emptyPart(page,"Sibling");await page.getByRole("tab",{name:"Plate",exact:true}).click();
    await expect(page.getByRole("img",{name:"Sketch-only 2D preview",exact:true})).toBeVisible();
    await bar.getByRole("button",{name:"Finish Sketch",exact:true}).click();
    await bar.getByRole("tab",{name:"Features",exact:true}).click();await bar.getByRole("button",{name:"Extrude",exact:true}).click();
    const extrude=page.getByRole("form",{name:"Extrude parameters",exact:true});await expect(extrude).toBeVisible();
    await extrude.getByRole("spinbutton",{name:"distance",exact:true}).fill("6");await extrude.getByRole("button",{name:"Add feature",exact:true}).click();await closePanels(page);
    await bar.getByRole("button",{name:"Preview features",exact:true}).click();await expect(page.getByTestId("feature-mesh-viewport").locator("canvas")).toBeVisible();
    await oneViewport(page,"solid");await bar.getByRole("button",{name:"Commit feature revision",exact:true}).click();
    await expect(page.getByTestId("empty-feature-message")).toContainText("Revision committed:");
    await expect(page.getByTestId("feature-mesh-viewport").locator("canvas")).toBeVisible();await oneViewport(page,"solid");
    await page.screenshot({path:info.outputPath(`solid-${viewport.width}.png`),fullPage:true});
    await page.reload();await expect(page.getByTestId("feature-mesh-viewport").locator("canvas")).toBeVisible();await oneViewport(page,"solid");
    if(viewport.width<940)await page.getByRole("button",{name:"Change Request",exact:true}).first().click();
    await page.getByRole("button",{name:"Revision 1",exact:true}).click();await closePanels(page);
    await expect(page.getByTestId("feature-mesh-viewport").locator("canvas")).toBeVisible();await oneViewport(page,"solid");
    await expect(page.getByTestId("sketch-workplane")).toHaveCount(0);
  });
}

test("retained current sketch is not projected over an externally committed historical Part",async({page})=>{
  await project(page,"Historical sketch isolation");await emptyPart(page,"History Part");
  const bar=commands(page);
  await bar.getByRole("combobox",{name:"Sketch plane",exact:true}).selectOption("XY");
  await bar.getByRole("button",{name:"New Sketch",exact:true}).click();
  await bar.getByRole("button",{name:"Rectangle",exact:true}).click();
  const properties=page.getByRole("form",{name:"Rectangle parameters",exact:true});
  await properties.getByRole("spinbutton",{name:"width",exact:true}).fill("40");
  await properties.getByRole("spinbutton",{name:"height",exact:true}).fill("30");
  await properties.getByRole("button",{name:"Apply to sketch",exact:true}).click();
  const contentId=await page.evaluate(async()=>{
    const ids=location.pathname.split("/");
    const candidate=await window.pitonWorkspace.proposeFeatures({projectId:ids[2],documentId:ids[4],expectedRevisionId:null,idempotencyKey:crypto.randomUUID(),units:"mm",features:[
      {kind:"rectangle",id:"externalProfile",name:"External outline",plane:"XY",width:80,height:50},
      {kind:"extrude",id:"externalBody",name:"External extrusion",profileId:"externalProfile",distance:6},
    ]});
    await window.pitonWorkspace.commitFeatures(candidate.proposal);return candidate.candidate.id;
  });
  await page.getByRole("button",{name:"Revision 1",exact:true}).click();
  await expect(page.getByTestId("feature-mesh-viewport")).toHaveAttribute("data-revision-id",contentId);
  await expect(page.getByTestId("feature-mesh-viewport").locator("canvas")).toBeVisible();
  await expect(page.getByTestId("sketch-workplane")).toHaveCount(0);
  await expect(page.getByRole("img",{name:"Sketch-only 2D preview",exact:true})).toHaveCount(0);
  await expect(page.getByTestId("feature-source-input")).toBeDisabled();
  await page.getByRole("button",{name:"Open current revision",exact:true}).click();
  await expect(page.getByRole("alert")).toContainText("Local draft preserved");
  await expect(bar.getByRole("button",{name:"Preview features",exact:true})).toBeDisabled();
});
