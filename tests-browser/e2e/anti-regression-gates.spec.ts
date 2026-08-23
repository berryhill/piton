import { Buffer } from "node:buffer";
import { expect, test } from "@playwright/test";

test("anti-regression gate 1: chromium defaults open with root safety truth and no enabling control", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("Accepted immutable revision")).toBeVisible();
  await expect(page.locator(".viewport-status")).toHaveText("Review mesh ready · CAD Z-min 0 on grid");
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-cad-z-min", "0");
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-build-plane-z", "0");
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-controls", "orbit pan zoom");
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-build-volume", "350 × 350 × 350 mm");
  await expect(page.getByTestId("fabrication-release")).toHaveText("false");
  await expect(page.getByTestId("machine-actuation")).toHaveText("false");

  for (const forbiddenTestId of [
    "fabrication-release-toggle",
    "fabrication-release-enable",
    "fabrication-release-grant",
    "machine-actuation-toggle",
    "machine-actuation-enable",
    "release-button",
    "approve-button",
    "export-exact-geometry",
  ]) {
    expect(await page.getByTestId(forbiddenTestId).count()).toBe(0);
  }
});

test("anti-regression gate 2: commit then reload keeps the accepted revision immutable and root safety truth", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Accepted immutable revision")).toBeVisible();

  const acceptedId = await page.locator(".state-card code").first().textContent();
  const input = page.getByLabel("Leg length (mm)");
  const oldValue = Number(await input.inputValue());
  const newValue = oldValue === 92 ? 100 : 92;
  await input.fill(String(newValue));
  await expect(page.getByText(`${oldValue} mm → ${newValue} mm`)).toBeVisible();
  await page.getByRole("button", { name: "Commit candidate" }).click();
  await expect(page.getByText("Candidate committed locally")).toBeVisible();

  await page.reload();
  await expect(page.getByText("Reopened from SQLite WASM · OPFS")).toBeVisible();
  await expect(page.locator(".state-card code").first()).toHaveText(acceptedId!);
  await expect(page.getByTestId("fabrication-release")).toHaveText("false");
  await expect(page.getByTestId("machine-actuation")).toHaveText("false");
  await expect(page.getByLabel("Leg length (mm)")).toHaveValue(String(newValue));
});

test("anti-regression gate 3: forged fabrication_release envelope is rejected at the import boundary", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Accepted immutable revision")).toBeVisible();

  const exportedEnvelope = await page.evaluate(async () => {
    const module = await import("../../browser-src/application");
    const { openProjectRepository } = await import("../../browser-src/storage/repository");
    const repository = await openProjectRepository("piton");
    const application = new module.CadApplication(repository);
    await application.open();
    return application.exportPortableCustody();
  });

  await page.goto("/?mode=import");
  await expect(page.getByText("Import portable custody into fresh browser storage")).toBeVisible();

  const forgedEnvelope = await page.evaluate(async (envelope) => {
    const { canonicalPortableCustodyJson, sha256Hex } = await import("../../browser-src/domain");
    const { fingerprint: _fingerprint, ...packet } = envelope;
    packet.lifecycle_projection = [{
      kind: "fabrication_release",
      id: `release-${"1".repeat(64)}`,
      projectId: packet.project.id,
      revisionId: packet.project.current_revision_id,
      approvalRecordId: `approval-${"2".repeat(64)}`,
      draftExportId: `export-${"3".repeat(64)}`,
      fabricationRelease: true,
      machineActuation: false,
      createdAt: "2026-08-22T00:00:00.000Z",
    }];
    return { ...packet, fingerprint: `sha256-${sha256Hex(canonicalPortableCustodyJson(packet))}` };
  }, exportedEnvelope);

  await page.getByTestId("portable-custody-file-input").setInputFiles({
    name: "forged.piton-custody.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(forgedEnvelope)),
  });
  await expect(page.getByTestId("portable-custody-error")).toContainText("lifecycle root truth is invalid");

  await page.getByTestId("portable-custody-file-input").setInputFiles({
    name: "legit.piton-custody.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(exportedEnvelope)),
  });
  await expect(page.getByText(/Reopened from portable custody/)).toBeVisible();
});

test("anti-regression gate 4: worker output is request- and revision-bound and never displaces last-good", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Accepted immutable revision")).toBeVisible();

  const gate = await page.evaluate(async () => {
    const { GeometryResultGate } = await import("../../browser-src/geometry/gate");
    const gateInstance = new GeometryResultGate();
    const triangle = [0, 1, 2] as const;
    const buildMesh = () => ({
      vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      triangles: [...triangle],
    });
    const firstRequest = gateInstance.begin({ baseRevisionId: "rev-a", previewDigest: "preview-a" });
    const firstResult = { ...firstRequest, ...buildMesh() };
    const firstAccepted = gateInstance.accept(firstResult);
    const lastGoodAfterFirstAccept = gateInstance.lastGood;
    gateInstance.begin({ baseRevisionId: "rev-other", previewDigest: "preview-other" });
    const staleResult = { ...firstRequest, ...buildMesh() };
    const staleAccepted = gateInstance.accept(staleResult);
    const stillLastGood = gateInstance.lastGood;
    return {
      firstAccepted,
      staleAccepted,
      acceptedEqualsStillLastGood: lastGoodAfterFirstAccept === stillLastGood,
      lastGoodStillOnFirstRequest: stillLastGood?.sourceRevisionId === firstRequest.sourceRevisionId,
    };
  });

  expect(gate.firstAccepted).toBe(true);
  expect(gate.staleAccepted).toBe(false);
  expect(gate.acceptedEqualsStillLastGood).toBe(true);
  expect(gate.lastGoodStillOnFirstRequest).toBe(true);
});

test("anti-regression gate 5: durable SQLite row readback and unchanged UI defaults after reopen", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Accepted immutable revision")).toBeVisible();

  const initial = await page.evaluate(async () => {
    const { SqliteOpfsProjectRepository } = await import("../../browser-src/storage/repository");
    const repository = await SqliteOpfsProjectRepository.open();
    return repository.readMigrationEvidence();
  });

  const input = page.getByLabel("Leg length (mm)");
  const oldValue = Number(await input.inputValue());
  const newValue = oldValue === 92 ? 100 : 92;
  await input.fill(String(newValue));
  await page.getByRole("button", { name: "Commit candidate" }).click();
  await expect(page.getByText("Candidate committed locally")).toBeVisible();

  await page.reload();
  await expect(page.getByText("Reopened from SQLite WASM · OPFS")).toBeVisible();

  const after = await page.evaluate(async () => {
    const { SqliteOpfsProjectRepository } = await import("../../browser-src/storage/repository");
    const repository = await SqliteOpfsProjectRepository.open();
    return repository.readMigrationEvidence();
  });

  expect(initial.sqliteUserVersion).toBe(4);
  expect(initial.projectSchemaVersion).toBe(4);
  expect(initial.tables).toContain("fabrication_releases");
  expect(initial.tables).toContain("released_package_projections");
  expect(after.sqliteUserVersion).toBe(4);
  expect(after.projectSchemaVersion).toBe(4);
  expect(after.tables).toContain("fabrication_releases");
  expect(after.tables).toContain("released_package_projections");
  expect(after.revisionCount).toBeGreaterThan(initial.revisionCount);
  expect(after.currentRevisionReadback).not.toBe(initial.currentRevisionReadback);
  expect(after.currentRevisionReadback).toMatch(/^rev-[0-9a-f]{64}$/);
  await expect(page.getByTestId("fabrication-release")).toHaveText("false");
  await expect(page.getByTestId("machine-actuation")).toHaveText("false");
});

test("anti-regression gate 6: no UI control enables fabrication release, machine actuation, approval, or exact export", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Accepted immutable revision")).toBeVisible();

  const html = await page.content();

  for (const forbiddenText of [
    "Enable fabrication",
    "Fabricate now",
    "Approve revision",
    "Machine actuation",
    "Actuate",
    "Export STEP",
    "Export IGES",
    "Release for fabrication",
    "Promote to release",
    "Sign approval",
    "Grant release",
    "Slice STL",
    "Slice 3MF",
    "Generate G-code",
    "Send to printer",
    "Send to CNC",
    "Send to laser",
  ]) {
    expect(html).not.toContain(forbiddenText);
  }

  const truthLabels = await page.locator(".truth-strip > div > span").allTextContents();
  expect(truthLabels).toEqual(["review_state", "fabrication_release", "machine_actuation", "release_state"]);
  await expect(page.getByTestId("fabrication-release")).toHaveText("false");
  await expect(page.getByTestId("machine-actuation")).toHaveText("false");
});
