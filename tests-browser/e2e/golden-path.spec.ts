import { expect, test } from "@playwright/test";

test("seeded edit preview commit and OPFS reload remain unreleased", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Accepted immutable revision")).toBeVisible();
  await expect(page.locator(".viewport-status")).toHaveText("Review mesh ready · CAD Z-min 0 on grid");
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-cad-z-min", "0");
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-build-plane-z", "0");
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-controls", "orbit pan zoom");
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-build-volume", "350 × 350 × 350 mm");
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-rendered-bbox", /120 × 40 × 88/);
  expect(Number(await page.getByTestId("viewport").getAttribute("data-rendered-vertex-count"))).toBeGreaterThan(16);
  const canvas = page.getByTestId("viewport").locator("canvas");
  await expect(canvas).toBeVisible();
  const beforeOrbit = await canvas.screenshot();
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error("viewport canvas has no bounding box");
  await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + canvasBox.width / 2 + 35, canvasBox.y + canvasBox.height / 2 + 15);
  await page.mouse.up();
  await page.mouse.wheel(0, -240);
  expect((await canvas.screenshot()).equals(beforeOrbit)).toBe(false);
  const beforeRoll = await canvas.screenshot();
  await page.getByRole("button", { name: "Roll 15°" }).click();
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-view-state", "rolled");
  expect((await canvas.screenshot()).equals(beforeRoll)).toBe(false);
  await page.getByRole("button", { name: "Reset / fit" }).click();
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-view-state", "fit-to-rendered-bbox");
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-fit-distance", /\d+\.\d{3}/);
  await expect(page.getByTestId("fabrication-release")).toHaveText("false");
  await expect(page.getByTestId("machine-actuation")).toHaveText("false");

  const acceptedId = await page.locator(".state-card code").first().textContent();
  const input = page.getByLabel("Leg length (mm)");
  const oldValue = Number(await input.inputValue());
  const newValue = oldValue === 92 ? 100 : 92;
  await input.fill(String(newValue));
  await expect(page.getByText(`${oldValue} mm → ${newValue} mm`)).toBeVisible();
  await expect(page.getByText("Preview only · not committed")).toBeVisible();
  await expect(page.locator(".viewport-status")).toHaveText("Review mesh ready · CAD Z-min 0 on grid");
  await page.getByRole("button", { name: "Commit candidate" }).click();
  await expect(page.getByText("Candidate committed locally")).toBeVisible();

  await page.reload();
  await expect(page.getByText("Reopened from SQLite WASM · OPFS")).toBeVisible();
  await expect(page.getByLabel("Leg length (mm)")).toHaveValue(String(newValue));
  await expect(page.locator(".state-card code").first()).toHaveText(acceptedId!);
  await expect(page.getByTestId("fabrication-release")).toHaveText("false");
  await expect(page.getByTestId("machine-actuation")).toHaveText("false");
  await expect(page.locator(".viewport-status")).toContainText("CAD Z-min 0 on grid");
});

test("SQLite WASM reports migrated schema and direct durable readback", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Accepted immutable revision")).toBeVisible();

  const evidence = await page.evaluate(async () => {
    const { SqliteOpfsProjectRepository } = await import("../../browser-src/storage/repository");
    const repository = await SqliteOpfsProjectRepository.open();
    return repository.readMigrationEvidence();
  });

  expect(evidence).toEqual({
    sqliteUserVersion: 3,
    projectSchemaVersion: 3,
    projectId: "piton-seeded-l-bracket",
    revisionCount: expect.any(Number),
    currentRevisionReadback: expect.stringMatching(/^rev-[0-9a-f]{64}$/),
    tables: [
      "approval_records", "build_attempts", "build_status", "change_proposals",
      "channel_pointers", "draft_exports", "evidence_closures", "fabrication_releases",
      "projects", "proposal_dispositions", "released_package_projections", "revisions",
    ],
  });
  expect(evidence.revisionCount).toBeGreaterThanOrEqual(1);
});

test("executes a version-2 OPFS migration and durably reopens lifecycle custody", async ({ page }) => {
  await page.goto("/@vite/client");
  const evidence = await page.evaluate(async () => {
    const { migrateSqliteDatabase, startSqliteWorker } = await import("../../browser-src/storage/repository");
    const { seedProject } = await import("../../browser-src/domain");
    const promiser = await startSqliteWorker();
    const filename = "file:piton-migration-v2.sqlite3?vfs=opfs";
    const open = async () => (await promiser("open", { filename })).result.dbId;
    const exec = async (dbId: string, sql: string, bind?: (string | number | null)[]) => promiser({
      type: "exec", dbId, args: { sql, bind, returnValue: "resultRows", rowMode: "object" },
    });

    let dbId = await open();
    const oldTables = await exec(dbId, "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'");
    for (const row of oldTables.result.resultRows as { name: string }[]) await exec(dbId, `DROP TABLE ${row.name}`);
    await exec(dbId, `CREATE TABLE projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, accepted_revision_id TEXT NOT NULL,
      current_revision_id TEXT NOT NULL, schema_version INTEGER NOT NULL) STRICT`);
    await exec(dbId, `CREATE TABLE revisions (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, parent_revision_id TEXT, created_at TEXT NOT NULL,
      authority_profile TEXT NOT NULL, parameters_json TEXT NOT NULL, review_state TEXT NOT NULL,
      fabrication_release INTEGER NOT NULL, machine_actuation INTEGER NOT NULL, release_state TEXT NOT NULL,
      UNIQUE(project_id, id)) STRICT`);
    await exec(dbId, `CREATE TABLE build_status (
      project_id TEXT PRIMARY KEY, request_id INTEGER NOT NULL, base_revision_id TEXT NOT NULL,
      preview_digest TEXT NOT NULL, state TEXT NOT NULL, message TEXT NOT NULL) STRICT`);
    const project = seedProject();
    const revision = project.revisions[0];
    await exec(dbId, "INSERT INTO projects VALUES (?, ?, ?, ?, 2)",
      [project.id, project.name, project.acceptedRevisionId, project.currentRevisionId]);
    await exec(dbId, "INSERT INTO revisions VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?)", [
      revision.id, project.id, revision.parentRevisionId, revision.createdAt, revision.authorityProfile,
      JSON.stringify(revision.parameters), revision.reviewState, revision.releaseState,
    ]);
    await exec(dbId, "PRAGMA user_version = 2");
    await promiser({ type: "close", dbId });

    dbId = await open();
    await migrateSqliteDatabase(promiser, dbId);
    const version = await exec(dbId, "PRAGMA user_version");
    const migratedProject = await exec(dbId, "SELECT * FROM projects");
    const migratedRevision = await exec(dbId, "SELECT * FROM revisions");
    await exec(dbId, "INSERT INTO change_proposals VALUES (?, ?, ?, ?, ?)", [
      `proposal-${"1".repeat(64)}`, project.id, revision.id,
      JSON.stringify({ type: "set-leg-length", value: 90 }), "2026-08-16T00:00:00.000Z",
    ]);
    await promiser({ type: "close", dbId });

    dbId = await open();
    const proposal = await exec(dbId, "SELECT * FROM change_proposals");
    const tables = await exec(dbId, "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
    await promiser({ type: "close", dbId });
    return {
      version: (version.result.resultRows as { user_version: number }[])[0].user_version,
      project: (migratedProject.result.resultRows as Record<string, unknown>[])[0],
      revision: (migratedRevision.result.resultRows as Record<string, unknown>[])[0],
      proposal: (proposal.result.resultRows as Record<string, unknown>[])[0],
      tables: (tables.result.resultRows as { name: string }[]).map((row) => row.name),
    };
  });

  expect(evidence.version).toBe(3);
  expect(evidence.project.schema_version).toBe(3);
  expect(evidence.project.accepted_revision_id).toBe(evidence.revision.id);
  expect(evidence.project.current_revision_id).toBe(evidence.revision.id);
  expect(evidence.revision.authority_profile).toBe("browser-typescript/v1");
  expect(evidence.revision.review_state).toBe("needs_human_review");
  expect(evidence.revision.fabrication_release).toBe(0);
  expect(evidence.revision.machine_actuation).toBe(0);
  expect(evidence.proposal.base_revision_id).toBe(evidence.revision.id);
  expect(evidence.tables).toContain("evidence_closures");
  expect(evidence.tables).toContain("fabrication_releases");
});
