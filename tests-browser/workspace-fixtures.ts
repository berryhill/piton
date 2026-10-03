import { expect, type Page } from "@playwright/test";
import { assertPortableCustodyPacket, canonicalPortableCustodyJson, seedProject, sha256Hex, type PortableCustodyPacket } from "../src/domain";

/** Explicit legacy custody, never a production Create Part side effect.
 * Built in the test runner so this also works against bundled production assets.
 */
export async function importBracketFixture(page: Page, projectName: string, partName: string) {
  const legacy = seedProject();
  const packet: PortableCustodyPacket = {
    format: "piton-custody/v1", schema_version: 4,
    project: { id: legacy.id, name: partName, accepted_revision_id: legacy.acceptedRevisionId, current_revision_id: legacy.currentRevisionId },
    revisions: legacy.revisions, build_status: null, lifecycle_projection: [],
    environment_digest: "browser-typescript/v1", exported_at: "2026-01-01T00:00:00.000Z",
  };
  assertPortableCustodyPacket(packet);
  const envelope = { ...packet, fingerprint: `sha256-${sha256Hex(canonicalPortableCustodyJson(packet))}` };
  await page.goto("/projects");
  await page.getByText("Import or recover a project", { exact: true }).click();
  await page.getByLabel("Import custody JSON").setInputFiles({
    name: "explicit-existing-bracket-custody.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(envelope)),
  });
  await expect(page.getByRole("heading", { name: partName, exact: true })).toBeVisible();
  const projectUrl = page.url();
  await openProjectSettings(page);
  await page.getByRole("textbox", { name: "Project name", exact: true }).fill(projectName);
  await page.getByRole("button", { name: "Rename project", exact: true }).click();
  await expect(page.getByRole("heading", { name: projectName, exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Project Files", exact: true }).getByRole("button", { name: partName, exact: true }).click();
  await expectActivePart(page, projectName, partName);
  return { projectUrl, documentUrl: page.url() };
}

export async function openProjectSettings(page: Page) {
  const summary = page.getByText("Project settings & recovery", { exact: true });
  if (!(await summary.evaluate(element => element.parentElement!.hasAttribute("open")))) await summary.click();
  await expect(page.getByRole("button", { name: "Export project backup", exact: true })).toBeVisible();
}

export async function expectActivePart(page: Page, projectName: string, partName: string) {
  await expect(page.locator("main.r7-workbench")).toBeVisible();
  await expect(page.getByRole("heading", { name: projectName, exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: partName, exact: true })).toHaveAttribute("aria-selected", "true");
}

export async function createEmptyPart(page: Page, name: string) {
  await page.getByRole("textbox", { name: /^(New )?Part name$/ }).fill(name);
  await page.getByRole("button", { name: "Create Part", exact: true }).click();
  await expect(page.getByRole("tab", { name, exact: true })).toHaveAttribute("aria-selected", "true");
  return page.url();
}

export async function expectEmptyParts(page: Page, projectName: string, names: string[]) {
  const documents = await page.evaluate(async name => {
    const project = (await window.pitonWorkspace.read()).projects.find(project => project.name === name)!;
    return project.documents.map(document => ({ name: document.name, current: document.part.currentRevisionId,
      accepted: document.part.acceptedRevisionId, revisions: document.part.revisions, revisionIds: document.revisionIds }));
  }, projectName);
  expect(documents).toEqual(names.map(name => ({ name, current: null, accepted: null, revisions: [], revisionIds: {} })));
  await expect(page.locator(".r7-authored-viewport")).toHaveCount(0);
  await expect(page.getByRole("spinbutton")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Revision \d/ })).toHaveCount(0);
  await expect(page.getByText("Bench Clamp Fixture", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Editable Part · L-bracket", { exact: true })).toHaveCount(0);
}
