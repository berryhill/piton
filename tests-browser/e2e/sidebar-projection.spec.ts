import { expect, test, type Page, type Locator } from '@playwright/test';
import { importBracketFixture } from '../workspace-fixtures';

async function left(page: Page) { if (!await page.locator('.r7-left').isVisible()) await page.getByRole('button', {name:'☰ Project',exact:true}).first().click(); }
async function close(page: Page) { for (const name of ['Close Project panel','Close Change Request']) { const b=page.getByRole('button',{name,exact:true});if(await b.isVisible())await b.click(); } }
async function hierarchy(page: Page, name: string) {
  await left(page);
  const files=page.getByRole('navigation',{name:'Project Files'}),outputs=page.getByRole('region',{name:'Active document outputs'}),tree=page.getByRole('tree',{name:`${name} model tree`});
  await expect(outputs).toBeVisible();await expect(tree).toBeVisible();
  const bounds=await Promise.all([files,outputs,tree].map(l=>l.boundingBox()));
  expect(bounds[0]!.y).toBeLessThan(bounds[1]!.y);expect(bounds[1]!.y).toBeLessThan(bounds[2]!.y);
  await expect(page.getByRole('heading',{name:'Outputs · active document',exact:true})).toHaveCount(1);
}
async function cameras(page: Page, host: Locator, controls: Locator) {
  await expect(controls.getByRole('button',{name:'Top',exact:true})).toBeEnabled();
  const before=await host.getAttribute('data-camera-position');
  await controls.getByRole('button',{name:'Top',exact:true}).click();
  await expect.poll(()=>host.getAttribute('data-camera-position')).not.toBe(before);
  const top=JSON.parse((await host.getAttribute('data-camera-position'))!),target=JSON.parse((await host.getAttribute('data-camera-target'))!);
  const feature=await host.evaluate(n=>!!n.closest('[data-testid="feature-mesh-viewport"]'));
  expect(Math.abs(top[0]-target[0])).toBeLessThan(0.01);
  expect(Math.abs(top[feature?2:1]-target[feature?2:1])).toBeLessThan(0.01);
  const oldUp=await host.getAttribute('data-camera-up');
  await controls.getByRole('button',{name:'Roll 15°',exact:true}).click();
  await expect.poll(()=>host.getAttribute('data-camera-up')).not.toBe(oldUp);
  const rolled=await host.getAttribute('data-camera-up');
  await controls.getByRole('button',{name:'Fit',exact:true}).click();
  expect(await host.getAttribute('data-camera-up')).toBe(rolled);
  await controls.getByRole('button',{name:'Reset / fit',exact:true}).click();
  await expect(controls.getByRole('button',{name:'Front',exact:true})).toBeEnabled();
}
for(const viewport of [{width:1920,height:1080},{width:1280,height:720},{width:390,height:844}]) {
  test(`feature sidebar projection, outputs and real camera at ${viewport.width}px`,async({page},info)=>{
    test.setTimeout(90000);await page.setViewportSize(viewport);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('/projects');await page.getByRole('button',{name:'Create project',exact:true}).click();
    const dialog=page.getByRole('dialog');await dialog.getByRole('textbox',{name:'Project name',exact:true}).fill(`Sidebar ${viewport.width}`);await dialog.getByRole('button',{name:'Create project',exact:true}).click();
    await expect(page.getByRole('heading',{name:`Sidebar ${viewport.width}`,exact:true})).toBeVisible();
    await left(page);await page.getByRole('textbox',{name:'Part name',exact:true}).fill('Plate');await page.getByRole('button',{name:'Create Part',exact:true}).click();await hierarchy(page,'Plate');
    await expect(page.getByRole('treeitem',{name:'Features (0)'})).toBeVisible();await close(page);
    const ids=await page.evaluate(async()=>{const p=location.pathname.split('/');const a=window.pitonWorkspace;const c=await a.proposeFeatures({projectId:p[2],documentId:p[4],expectedRevisionId:null,idempotencyKey:crypto.randomUUID(),units:'mm',features:[{kind:'rectangle',id:'outline',name:'Plate outline',plane:'XY',width:80,height:50},{kind:'extrude',id:'body',name:'Plate thickness',profileId:'outline',distance:6}]});const revision=await a.commitFeatures(c.proposal);return {revision,content:c.candidate.id};});
    await page.reload();await expect(page.getByTestId('feature-mesh-viewport').locator('canvas')).toBeVisible();await hierarchy(page,'Plate');
    const tree=page.getByRole('tree',{name:'Plate model tree'});await tree.getByRole('treeitem',{name:'Features (2)'}).press('ArrowRight');await tree.getByRole('treeitem',{name:'Plate outline · rectangle'}).click();
    if(viewport.width<940){await close(page);await page.getByRole('button',{name:'Change Request',exact:true}).first().click();}
    await expect(page.getByRole('region',{name:'Model selection details'})).toContainText('Plate outline');await expect(page.getByRole('heading',{name:'Selected context',exact:true})).toHaveCount(1);await close(page);
    const mesh=page.getByTestId('feature-mesh-viewport');await cameras(page,mesh.locator('.r7-three'),mesh.locator('.view-actions'));
    await left(page);const outputs=page.getByRole('region',{name:'Active document outputs'});await outputs.locator('summary').click();await expect(page.getByTestId('generated-feature-source')).toContainText('"width":80');
    const download=page.waitForEvent('download');await outputs.getByRole('button',{name:'Download feature review STL (unreleased)',exact:true}).click();expect((await download).suggestedFilename()).toMatch(/unreleased.*\.stl$/);await close(page);
    await page.screenshot({path:info.outputPath(`sidebar-solid-${viewport.width}.png`),fullPage:true});
    if(viewport.width<940)await page.getByRole('button',{name:'Change Request',exact:true}).first().click();await page.getByRole('button',{name:'Revision 1',exact:true}).click();await close(page);await expect(mesh).toHaveAttribute('data-revision-id',ids.content);await hierarchy(page,'Plate');await expect(page.getByRole('heading',{name:'Model tree · historical',exact:true})).toBeVisible();
    expect(errors).toEqual([]);
  });
}
test('imported parameter preview/tree/history stays parameter authority with shared camera',async({page})=>{
  test.setTimeout(90000);const {documentUrl}=await importBracketFixture(page,'Imported projection','Bracket');await hierarchy(page,'Bracket');
  await expect(page.getByRole('treeitem',{name:'Parameters (6)'})).toBeVisible();await expect(page.getByRole('treeitem',{name:/ · (rectangle|extrude)$/})).toHaveCount(0);
  await page.getByRole('spinbutton',{name:'leg_length_mm',exact:true}).fill('112');await page.getByRole('button',{name:'Propose and preview',exact:true}).click();await expect(page.getByRole('button',{name:'Commit revision',exact:true})).toBeEnabled();
  await expect(page.getByRole('heading',{name:'Model tree · preview',exact:true})).toBeVisible();
  await page.getByRole('treeitem',{name:'Parameters (6)'}).press('ArrowRight');await page.getByRole('treeitem',{name:'leg_length_mm',exact:true}).click();await expect(page.getByRole('region',{name:'Model selection details'})).toContainText('112');
  await cameras(page,page.getByTestId('viewport'),page.locator('.viewport-shell .view-actions'));
  const beforeMeasurement=await page.evaluate(async()=>JSON.stringify((await window.pitonWorkspace.read()).projects[0].documents[0].part));
  const inspect=page.getByRole('group',{name:'Imported review inspection'});
  await inspect.getByRole('button',{name:'Measure',exact:true}).click();
  await page.getByTestId('viewport').press('Enter');
  await expect(page.getByTestId('viewport')).toHaveAttribute('data-measurement-phase','endpoint-a');
  await page.getByTestId('viewport').press('Enter');
  await expect(page.getByTestId('viewport')).toHaveAttribute('data-measurement-phase','complete');
  await expect(page.getByTestId('imported-measurement')).toContainText('mm · review-only');
  await inspect.getByRole('button',{name:'Clear',exact:true}).click();
  await expect(page.getByTestId('viewport')).toHaveAttribute('data-measurement-phase','idle');
  expect(await page.evaluate(async()=>JSON.stringify((await window.pitonWorkspace.read()).projects[0].documents[0].part))).toBe(beforeMeasurement);
  await page.getByRole('button',{name:'Commit revision',exact:true}).click();await expect(page.getByRole('heading',{name:'Model tree · committed',exact:true})).toBeVisible();await page.getByRole('button',{name:'Revision 1',exact:true}).click();await expect(page.getByRole('spinbutton',{name:'leg_length_mm',exact:true})).toHaveValue('80');await expect(page.getByRole('heading',{name:'Model tree · historical',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Open current revision',exact:true}).click();await expect(page).toHaveURL(documentUrl);await expect(page.getByRole('spinbutton',{name:'leg_length_mm',exact:true})).toHaveValue('112');
});
