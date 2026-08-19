import { sqlite3Worker1Promiser, type Worker1Promiser } from "@sqlite.org/sqlite-wasm";
import type { BrowserProject, CadCommandReceipt, CadCommandRequest, CandidateCommand, DesignRevision } from "../domain";
import { SAFETY_TRUTH, assertProjectIntegrity, deriveCandidateFromCommand, seedProject } from "../domain";
import { CURRENT_SCHEMA_VERSION, migrationStatements } from "./schema";
import type { GeometryAuthorityBinding } from "../geometry/binding";
import type { BuildAttempt, ChangeProposal, ChannelPointer, LifecycleRecord, ProposalDisposition } from "../lifecycle";
import { assertLifecycleRecord } from "../lifecycle";

export type BuildAdmission = Omit<BuildAttempt, "state"> & Readonly<{ state: "admitted" }>;
export type CallerLifecycleRecord = ChangeProposal | ProposalDisposition | BuildAdmission;

export interface BuildStatus {
  projectId: string;
  requestId: number;
  binding: GeometryAuthorityBinding;
  state: "idle" | "previewing" | "ready" | "failed";
  message: string;
}

function assertBuildStatusBinding(status: BuildStatus, project: BrowserProject): void {
  if (status.projectId !== project.id) throw new Error("build status project authority mismatch");
  if (status.binding.baseRevisionId !== project.currentRevisionId) {
    throw new Error("build status base revision is stale");
  }
  if (status.binding.previewDigest !== project.currentRevisionId
    && !/^preview-[0-9a-f]{64}$/.test(status.binding.previewDigest)) {
    throw new Error("build status preview digest is invalid");
  }
}

export interface SqliteMigrationEvidence {
  sqliteUserVersion: number;
  projectSchemaVersion: number;
  projectId: string;
  revisionCount: number;
  currentRevisionReadback: string;
  tables: string[];
}

export interface ProjectRepository {
  load(): Promise<BrowserProject | null>;
  initialize(): Promise<BrowserProject>;
  commitCandidate(expectedCurrentRevisionId: string, command: CandidateCommand): Promise<BrowserProject>;
  executeCommand(request: CadCommandRequest, requestDigest: string): Promise<CadCommandReceipt>;
  loadBuildStatus(projectId: string): Promise<BuildStatus | null>;
  saveBuildStatus(status: BuildStatus): Promise<void>;
  appendLifecycleRecord(record: CallerLifecycleRecord, expectedCurrentRevisionId: string): Promise<void>;
  moveChannel(pointer: ChannelPointer, expectedVersion: number): Promise<void>;
  loadLifecycleRecords(projectId: string): Promise<LifecycleRecord[]>;
  persistenceLabel: string;
}

export class MemoryProjectRepository implements ProjectRepository {
  private project: BrowserProject | null = null;
  private buildStatus: BuildStatus | null = null;
  private lifecycleRecords: LifecycleRecord[] = [];
  private commandReceipts = new Map<string, { requestDigest: string; receipt: CadCommandReceipt }>();
  persistenceLabel = "test memory";

  async load(): Promise<BrowserProject | null> {
    if (!this.project) return null;
    assertProjectIntegrity(this.project);
    return structuredClone(this.project);
  }

  async initialize(): Promise<BrowserProject> {
    if (!this.project) {
      const seeded = seedProject();
      assertProjectIntegrity(seeded);
      this.project = structuredClone(seeded);
    }
    return structuredClone(this.project);
  }

  async commitCandidate(expectedCurrentRevisionId: string, command: CandidateCommand): Promise<BrowserProject> {
    if (!this.project) throw new Error("project is not initialized");
    assertProjectIntegrity(this.project);
    if (this.project.currentRevisionId !== expectedCurrentRevisionId) throw new Error("stale current revision");
    const base = this.project.revisions.find((revision) => revision.id === expectedCurrentRevisionId);
    if (!base) throw new Error("current revision pointer is invalid");
    const candidate = deriveCandidateFromCommand(base, command);
    const next = { ...this.project, currentRevisionId: candidate.id, revisions: [...this.project.revisions, candidate] };
    assertProjectIntegrity(next);
    this.project = structuredClone(next);
    return structuredClone(this.project);
  }

  async executeCommand(request: CadCommandRequest, requestDigest: string): Promise<CadCommandReceipt> {
    const stored = this.commandReceipts.get(request.idempotencyKey);
    if (stored) {
      if (stored.requestDigest !== requestDigest) throw new Error("idempotency key conflicts with another request");
      return structuredClone(stored.receipt);
    }
    const project = await this.commitCandidate(request.expectedCurrentRevisionId, {
      type: request.command.type,
      value: request.command.quantity.value,
    });
    const receipt = commandReceipt(request, requestDigest, project.currentRevisionId);
    this.commandReceipts.set(request.idempotencyKey, { requestDigest, receipt: structuredClone(receipt) });
    return receipt;
  }

  async loadBuildStatus(projectId: string) {
    return this.buildStatus?.projectId === projectId ? structuredClone(this.buildStatus) : null;
  }

  async saveBuildStatus(status: BuildStatus) {
    if (!this.project) throw new Error("project is not initialized");
    assertBuildStatusBinding(status, this.project);
    this.buildStatus = structuredClone(status);
  }

  async appendLifecycleRecord(record: CallerLifecycleRecord, expectedCurrentRevisionId: string): Promise<void> {
    if (!this.project) throw new Error("project is not initialized");
    assertCallerLifecycleWrite(record, expectedCurrentRevisionId, this.project, this.lifecycleRecords);
    if (this.lifecycleRecords.some((existing) => "id" in existing && existing.id === record.id)) {
      throw new Error("duplicate lifecycle identity");
    }
    this.lifecycleRecords.push(structuredClone(record));
  }

  async moveChannel(pointer: ChannelPointer, expectedVersion: number): Promise<void> {
    if (!this.project) throw new Error("project is not initialized");
    assertLifecycleWrite(pointer, this.project, this.lifecycleRecords);
    const index = this.lifecycleRecords.findIndex((record) => record.kind === "channel_pointer" && record.channel === pointer.channel);
    const actualVersion = index < 0 ? 0 : (this.lifecycleRecords[index] as ChannelPointer).version;
    if (actualVersion !== expectedVersion || pointer.version !== expectedVersion + 1) throw new Error("stale channel pointer");
    if (index < 0) this.lifecycleRecords.push(structuredClone(pointer));
    else this.lifecycleRecords[index] = structuredClone(pointer);
  }

  async loadLifecycleRecords(projectId: string): Promise<LifecycleRecord[]> {
    if (!this.project || projectId !== this.project.id) throw new Error("lifecycle project authority mismatch");
    this.lifecycleRecords.forEach(assertLifecycleRecord);
    return structuredClone(this.lifecycleRecords);
  }
}

function commandReceipt(request: CadCommandRequest, requestDigest: string, resultingRevisionId: string): CadCommandReceipt {
  return {
    format: "piton-command-receipt/v1",
    projectId: request.projectId,
    baseRevisionId: request.expectedCurrentRevisionId,
    resultingRevisionId,
    canonicalRequestDigest: requestDigest,
    authorityProfile: "browser-typescript/v1",
    ...SAFETY_TRUTH,
  };
}

function assertLifecycleWrite(record: LifecycleRecord, project: BrowserProject, existing: readonly LifecycleRecord[]): void {
  assertLifecycleRecord(record);
  if (record.projectId !== project.id) throw new Error("lifecycle project authority mismatch");
  const revisionIds = new Set(project.revisions.map((revision) => revision.id));
  const boundRevision = record.kind === "change_proposal" ? record.baseRevisionId
    : "revisionId" in record ? record.revisionId : undefined;
  if (boundRevision && !revisionIds.has(boundRevision)) throw new Error("lifecycle revision reference is missing");
  if (record.kind === "proposal_disposition") {
    const proposal = existing.find((item) => item.kind === "change_proposal" && item.id === record.proposalId);
    if (!proposal) throw new Error("proposal disposition reference is missing");
  }
  if (record.kind === "evidence_closure") {
    const attempt = existing.find((item) => item.kind === "build_attempt" && item.id === record.buildAttemptId);
    if (!attempt || attempt.kind !== "build_attempt") throw new Error("evidence build attempt reference is missing");
    if (attempt.projectId !== record.projectId || attempt.revisionId !== record.revisionId || attempt.state !== "succeeded") {
      throw new Error("evidence build attempt binding is invalid");
    }
  }
}

function assertCallerLifecycleWrite(
  callerRecord: CallerLifecycleRecord,
  expectedCurrentRevisionId: string,
  project: BrowserProject,
  existing: readonly LifecycleRecord[],
): void {
  const record = callerRecord as LifecycleRecord;
  if (record.kind === "evidence_closure") throw new Error("evidence closure requires trusted coordinator custody");
  if (record.kind === "build_attempt" && record.state !== "admitted") {
    throw new Error("successful build attempt requires trusted coordinator custody");
  }
  if (!["change_proposal", "proposal_disposition", "build_attempt"].includes(record.kind)) {
    throw new Error("Stage 1 lifecycle authority is not implemented");
  }
  if (project.currentRevisionId !== expectedCurrentRevisionId) throw new Error("stale current revision");
  assertLifecycleWrite(record, project, existing);
  if (record.kind === "change_proposal" && record.baseRevisionId !== expectedCurrentRevisionId) {
    throw new Error("proposal base revision is stale");
  }
  if (record.kind === "proposal_disposition" && record.disposition !== "changes_requested") {
    const proposal = existing.find((item): item is ChangeProposal => item.kind === "change_proposal" && item.id === record.proposalId);
    if (!proposal || proposal.baseRevisionId !== expectedCurrentRevisionId) throw new Error("proposal base revision is stale");
  }
  if (record.kind === "build_attempt" && record.revisionId !== expectedCurrentRevisionId) {
    throw new Error("build attempt revision is stale");
  }
}

type Row = Record<string, string | number | null>;

interface SqliteWorkerStartupCallbacks {
  onready(promiser: Worker1Promiser): void;
  onerror(error: unknown): void;
}

export function waitForSqliteWorker(
  start: (callbacks: SqliteWorkerStartupCallbacks) => void,
  timeoutMs = 10_000,
): Promise<Worker1Promiser> {
  return new Promise<Worker1Promiser>((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      action();
    };
    const timeout = setTimeout(
      () => finish(() => reject(new Error(`SQLite worker startup timed out after ${timeoutMs} ms`))),
      timeoutMs,
    );
    try {
      start({
        onready: (promiser) => finish(() => resolve(promiser)),
        onerror: (error) => finish(() => reject(new Error(
          `SQLite worker startup failed: ${error instanceof Error ? error.message : String(error)}`,
        ))),
      });
    } catch (error) {
      finish(() => reject(new Error(
        `SQLite worker startup failed: ${error instanceof Error ? error.message : String(error)}`,
      )));
    }
  });
}

export function startSqliteWorker(): Promise<Worker1Promiser> {
  return waitForSqliteWorker(({ onready, onerror }) => sqlite3Worker1Promiser({ onready, onerror }));
}

export async function migrateSqliteDatabase(promiser: Worker1Promiser, dbId: string): Promise<void> {
  const exec = (sql: string) => promiser({
    type: "exec", dbId, args: { sql, returnValue: "resultRows", rowMode: "object" },
  });
  const versionResult = await exec("PRAGMA user_version");
  const fromVersion = Number((versionResult.result.resultRows as Row[])[0]?.user_version);
  const migrations = migrationStatements(fromVersion);
  if (migrations.length) {
    await exec("BEGIN IMMEDIATE");
    try {
      for (const sql of migrations) await exec(sql);
      await exec("COMMIT");
    } catch (error) {
      await exec("ROLLBACK");
      throw error;
    }
  }
  const migratedVersion = await exec("PRAGMA user_version");
  if (Number((migratedVersion.result.resultRows as Row[])[0]?.user_version) !== CURRENT_SCHEMA_VERSION) {
    throw new Error("SQLite schema migration did not reach the supported version");
  }
}

export class SqliteOpfsProjectRepository implements ProjectRepository {
  private promiser!: Worker1Promiser;
  private dbId!: string;
  persistenceLabel = "SQLite WASM · OPFS";

  static async open(): Promise<SqliteOpfsProjectRepository> {
    if (!crossOriginIsolated || !navigator.storage?.getDirectory) {
      throw new Error("OPFS persistence requires a cross-origin-isolated browser context");
    }
    const repository = new SqliteOpfsProjectRepository();
    repository.promiser = await startSqliteWorker();
    const opened = await repository.promiser("open", { filename: "file:piton.sqlite3?vfs=opfs" });
    repository.dbId = opened.result.dbId;
    await migrateSqliteDatabase(repository.promiser, repository.dbId);
    return repository;
  }

  private async exec(sql: string, bind?: (string | number | null)[]) {
    return this.promiser({ type: "exec", dbId: this.dbId, args: { sql, bind, returnValue: "resultRows", rowMode: "object" } });
  }

  async load(): Promise<BrowserProject | null> {
    const projects = await this.exec("SELECT * FROM projects LIMIT 1");
    const projectRow = (projects.result.resultRows as Row[])[0];
    if (!projectRow) return null;
    const revisionsResult = await this.exec("SELECT * FROM revisions WHERE project_id = ? ORDER BY created_at, rowid", [String(projectRow.id)]);
    const revisions = (revisionsResult.result.resultRows as Row[]).map((row): DesignRevision => ({
      id: String(row.id),
      parentRevisionId: row.parent_revision_id === null ? null : String(row.parent_revision_id),
      createdAt: String(row.created_at),
      authorityProfile: String(row.authority_profile) as DesignRevision["authorityProfile"],
      parameters: JSON.parse(String(row.parameters_json)) as DesignRevision["parameters"],
      reviewState: String(row.review_state) as DesignRevision["reviewState"],
      fabricationRelease: Boolean(row.fabrication_release) as DesignRevision["fabricationRelease"],
      machineActuation: Boolean(row.machine_actuation) as DesignRevision["machineActuation"],
      releaseState: String(row.release_state) as DesignRevision["releaseState"],
    }));
    const project: BrowserProject = {
      id: String(projectRow.id),
      name: String(projectRow.name),
      acceptedRevisionId: String(projectRow.accepted_revision_id),
      currentRevisionId: String(projectRow.current_revision_id),
      revisions,
    };
    assertProjectIntegrity(project);
    return project;
  }

  async initialize(): Promise<BrowserProject> {
    await this.exec("BEGIN IMMEDIATE");
    try {
      const existing = await this.exec("SELECT id FROM projects LIMIT 1");
      if ((existing.result.resultRows as Row[])[0]) {
        const loaded = await this.load();
        if (!loaded) throw new Error("initialized project disappeared");
        await this.exec("COMMIT");
        return loaded;
      }
      const project = seedProject();
      assertProjectIntegrity(project);
      const revision = project.revisions[0];
      await this.exec(
        "INSERT INTO projects (id, name, accepted_revision_id, current_revision_id, schema_version) VALUES (?, ?, ?, ?, ?)",
        [project.id, project.name, project.acceptedRevisionId, project.currentRevisionId, CURRENT_SCHEMA_VERSION],
      );
      await this.insertRevision(project.id, revision);
      const loaded = await this.load();
      if (!loaded) throw new Error("initialized project disappeared");
      await this.exec("COMMIT");
      return loaded;
    } catch (error) {
      await this.exec("ROLLBACK");
      throw error;
    }
  }

  async commitCandidate(expectedCurrentRevisionId: string, command: CandidateCommand): Promise<BrowserProject> {
    await this.exec("BEGIN IMMEDIATE");
    try {
      const project = await this.load();
      if (!project) throw new Error("project is not initialized");
      if (project.currentRevisionId !== expectedCurrentRevisionId) throw new Error("stale current revision");
      const base = project.revisions.find((revision) => revision.id === expectedCurrentRevisionId);
      if (!base) throw new Error("current revision pointer is invalid");
      const candidate = deriveCandidateFromCommand(base, command);
      const candidateProject = { ...project, currentRevisionId: candidate.id, revisions: [...project.revisions, candidate] };
      assertProjectIntegrity(candidateProject);

      const identity = await this.exec("SELECT id FROM revisions WHERE id = ?", [candidate.id]);
      if ((identity.result.resultRows as Row[])[0]) throw new Error("conflicting revision identity");
      await this.insertRevision(project.id, candidate);
      await this.exec(
        "UPDATE projects SET current_revision_id = ? WHERE id = ? AND current_revision_id = ?",
        [candidate.id, project.id, expectedCurrentRevisionId],
      );
      const changes = await this.exec("SELECT changes() AS changed_rows");
      const changedRows = Number((changes.result.resultRows as Row[])[0]?.changed_rows ?? 0);
      if (changedRows !== 1) throw new Error("stale current revision");
      await this.exec("COMMIT");
    } catch (error) {
      await this.exec("ROLLBACK");
      throw error;
    }
    const authoritative = await this.load();
    if (!authoritative) throw new Error("committed project disappeared");
    return authoritative;
  }

  async executeCommand(request: CadCommandRequest, requestDigest: string): Promise<CadCommandReceipt> {
    await this.exec("BEGIN IMMEDIATE");
    try {
      const existing = await this.exec("SELECT request_digest, receipt_json FROM command_receipts WHERE idempotency_key = ?", [request.idempotencyKey]);
      const stored = (existing.result.resultRows as Row[])[0];
      if (stored) {
        if (String(stored.request_digest) !== requestDigest) throw new Error("idempotency key conflicts with another request");
        await this.exec("COMMIT");
        return JSON.parse(String(stored.receipt_json)) as CadCommandReceipt;
      }
      const project = await this.load();
      if (!project) throw new Error("project is not initialized");
      if (project.currentRevisionId !== request.expectedCurrentRevisionId) throw new Error("stale current revision");
      const base = project.revisions.find((revision) => revision.id === request.expectedCurrentRevisionId);
      if (!base) throw new Error("current revision pointer is invalid");
      const candidate = deriveCandidateFromCommand(base, { type: request.command.type, value: request.command.quantity.value });
      await this.insertRevision(project.id, candidate);
      await this.exec("UPDATE projects SET current_revision_id = ? WHERE id = ? AND current_revision_id = ?",
        [candidate.id, project.id, request.expectedCurrentRevisionId]);
      const changes = await this.exec("SELECT changes() AS changed_rows");
      if (Number((changes.result.resultRows as Row[])[0]?.changed_rows ?? 0) !== 1) throw new Error("stale current revision");
      const receipt = commandReceipt(request, requestDigest, candidate.id);
      await this.exec("INSERT INTO command_receipts (idempotency_key, request_digest, receipt_json) VALUES (?, ?, ?)",
        [request.idempotencyKey, requestDigest, JSON.stringify(receipt)]);
      await this.exec("COMMIT");
      return receipt;
    } catch (error) {
      await this.exec("ROLLBACK");
      throw error;
    }
  }

  private async insertRevision(projectId: string, revision: DesignRevision): Promise<void> {
    await this.exec(
      `INSERT INTO revisions
        (id, project_id, parent_revision_id, created_at, authority_profile, parameters_json, review_state, fabrication_release, machine_actuation, release_state)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?)`,
      [revision.id, projectId, revision.parentRevisionId, revision.createdAt, revision.authorityProfile,
        JSON.stringify(revision.parameters), revision.reviewState, revision.releaseState],
    );
  }

  async loadBuildStatus(projectId: string): Promise<BuildStatus | null> {
    const result = await this.exec("SELECT * FROM build_status WHERE project_id = ?", [projectId]);
    const row = (result.result.resultRows as Row[])[0];
    if (!row) return null;
    return {
      projectId: String(row.project_id),
      requestId: Number(row.request_id),
      binding: {
        baseRevisionId: String(row.base_revision_id),
        previewDigest: String(row.preview_digest),
      },
      state: String(row.state) as BuildStatus["state"],
      message: String(row.message),
    };
  }

  async saveBuildStatus(status: BuildStatus): Promise<void> {
    const project = await this.load();
    if (!project) throw new Error("project is not initialized");
    assertBuildStatusBinding(status, project);
    await this.exec(`INSERT INTO build_status
      (project_id, request_id, base_revision_id, preview_digest, state, message)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET
        request_id=excluded.request_id,
        base_revision_id=excluded.base_revision_id,
        preview_digest=excluded.preview_digest,
        state=excluded.state,
        message=excluded.message`,
      [status.projectId, status.requestId, status.binding.baseRevisionId, status.binding.previewDigest,
        status.state, status.message]);
  }

  async appendLifecycleRecord(record: CallerLifecycleRecord, expectedCurrentRevisionId: string): Promise<void> {
    await this.exec("BEGIN IMMEDIATE");
    try {
      const project = await this.load();
      if (!project) throw new Error("project is not initialized");
      const existing = await this.loadLifecycleRecords(project.id);
      assertCallerLifecycleWrite(record, expectedCurrentRevisionId, project, existing);
      if (existing.some((item) => "id" in item && item.id === record.id)) throw new Error("duplicate lifecycle identity");
      switch (record.kind) {
        case "change_proposal":
          await this.exec("INSERT INTO change_proposals (id, project_id, base_revision_id, command_json, created_at) VALUES (?, ?, ?, ?, ?)",
            [record.id, record.projectId, record.baseRevisionId, JSON.stringify(record.command), record.createdAt]);
          break;
        case "proposal_disposition":
          await this.exec("INSERT INTO proposal_dispositions (id, project_id, proposal_id, disposition, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            [record.id, record.projectId, record.proposalId, record.disposition, record.reason, record.createdAt]);
          break;
        case "build_attempt":
          await this.exec("INSERT INTO build_attempts (id, project_id, revision_id, recipe_digest, state, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            [record.id, record.projectId, record.revisionId, record.recipeDigest, record.state, record.createdAt]);
          break;
        default:
          throw new Error("Stage 1 lifecycle authority is not implemented");
      }
      await this.exec("COMMIT");
    } catch (error) {
      await this.exec("ROLLBACK");
      if (error instanceof Error && /UNIQUE constraint failed/.test(error.message)) throw new Error("duplicate lifecycle identity");
      throw error;
    }
  }

  async moveChannel(pointer: ChannelPointer, expectedVersion: number): Promise<void> {
    await this.exec("BEGIN IMMEDIATE");
    try {
      const project = await this.load();
      if (!project) throw new Error("project is not initialized");
      assertLifecycleWrite(pointer, project, await this.loadLifecycleRecords(project.id));
      if (pointer.version !== expectedVersion + 1) throw new Error("stale channel pointer");
      if (expectedVersion === 0) {
        await this.exec("INSERT INTO channel_pointers (project_id, channel, revision_id, version, updated_at) VALUES (?, ?, ?, ?, ?)",
          [pointer.projectId, pointer.channel, pointer.revisionId, pointer.version, pointer.updatedAt]);
      } else {
        await this.exec("UPDATE channel_pointers SET revision_id = ?, version = ?, updated_at = ? WHERE project_id = ? AND channel = ? AND version = ?",
          [pointer.revisionId, pointer.version, pointer.updatedAt, pointer.projectId, pointer.channel, expectedVersion]);
        const changes = await this.exec("SELECT changes() AS changed_rows");
        if (Number((changes.result.resultRows as Row[])[0]?.changed_rows ?? 0) !== 1) throw new Error("stale channel pointer");
      }
      await this.exec("COMMIT");
    } catch (error) {
      await this.exec("ROLLBACK");
      if (error instanceof Error && /UNIQUE constraint failed/.test(error.message)) throw new Error("stale channel pointer");
      throw error;
    }
  }

  async loadLifecycleRecords(projectId: string): Promise<LifecycleRecord[]> {
    const project = await this.load();
    if (!project || project.id !== projectId) throw new Error("lifecycle project authority mismatch");
    const records: LifecycleRecord[] = [];
    const rows = async (table: string) => (await this.exec(`SELECT * FROM ${table} WHERE project_id = ? ORDER BY created_at, rowid`, [projectId])).result.resultRows as Row[];
    for (const row of await rows("change_proposals")) records.push({
      kind: "change_proposal", id: String(row.id), projectId: String(row.project_id), baseRevisionId: String(row.base_revision_id),
      command: JSON.parse(String(row.command_json)) as CandidateCommand, createdAt: String(row.created_at),
    });
    for (const row of await rows("proposal_dispositions")) records.push({
      kind: "proposal_disposition", id: String(row.id), projectId: String(row.project_id), proposalId: String(row.proposal_id),
      disposition: String(row.disposition) as "changes_requested" | "accepted_for_build" | "accepted_for_review",
      reason: String(row.reason), createdAt: String(row.created_at),
    });
    for (const row of await rows("build_attempts")) records.push({
      kind: "build_attempt", id: String(row.id), projectId: String(row.project_id), revisionId: String(row.revision_id),
      recipeDigest: String(row.recipe_digest), state: String(row.state) as "admitted" | "running" | "succeeded" | "failed" | "blocked",
      createdAt: String(row.created_at),
    });
    for (const row of await rows("evidence_closures")) records.push({
      kind: "evidence_closure", id: String(row.id), projectId: String(row.project_id), revisionId: String(row.revision_id),
      buildAttemptId: String(row.build_attempt_id), requirementIds: JSON.parse(String(row.requirements_json)) as string[],
      artifactDigests: JSON.parse(String(row.artifacts_json)) as string[], createdAt: String(row.created_at),
    });
    const pointerResult = await this.exec("SELECT * FROM channel_pointers WHERE project_id = ? ORDER BY channel", [projectId]);
    for (const row of pointerResult.result.resultRows as Row[]) records.push({
      kind: "channel_pointer", projectId: String(row.project_id), channel: String(row.channel) as "workspace" | "candidate" | "review",
      revisionId: String(row.revision_id), version: Number(row.version), updatedAt: String(row.updated_at),
    });
    for (const row of await rows("approval_records")) records.push({
      kind: "approval_record", id: String(row.id), projectId: String(row.project_id), revisionId: String(row.revision_id),
      evidenceClosureId: String(row.evidence_closure_id), decision: String(row.decision) as "rejected" | "deferred",
      reason: String(row.reason), createdAt: String(row.created_at),
    });
    for (const row of await rows("draft_exports")) records.push({
      kind: "draft_export", id: String(row.id), projectId: String(row.project_id), revisionId: String(row.revision_id),
      evidenceClosureId: String(row.evidence_closure_id), manifestDigest: String(row.manifest_digest), releaseState: "unreleased",
      createdAt: String(row.created_at),
    });
    for (const row of await rows("fabrication_releases")) records.push({
      kind: "fabrication_release", id: String(row.id), projectId: String(row.project_id), revisionId: String(row.revision_id),
      approvalRecordId: String(row.approval_record_id), draftExportId: String(row.draft_export_id),
      fabricationRelease: false, machineActuation: false, createdAt: String(row.created_at),
    });
    for (const row of await rows("released_package_projections")) records.push({
      kind: "released_package_projection", id: String(row.id), projectId: String(row.project_id),
      fabricationReleaseId: String(row.fabrication_release_id), packageDigest: String(row.package_digest),
      fabricationRelease: false, machineActuation: false, createdAt: String(row.created_at),
    });
    records.forEach(assertLifecycleRecord);
    return records;
  }

  async readMigrationEvidence(): Promise<SqliteMigrationEvidence> {
    const versionResult = await this.exec("PRAGMA user_version");
    const tableResult = await this.exec(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    );
    const projectResult = await this.exec(
      `SELECT p.id, p.schema_version, p.current_revision_id,
              COUNT(r.id) AS revision_count,
              SUM(CASE WHEN r.id = p.current_revision_id THEN 1 ELSE 0 END) AS current_revision_matches
         FROM projects AS p
         LEFT JOIN revisions AS r ON r.project_id = p.id
        GROUP BY p.id, p.schema_version, p.current_revision_id
        LIMIT 1`,
    );
    const project = (projectResult.result.resultRows as Row[])[0];
    if (!project || Number(project.current_revision_matches) !== 1) {
      throw new Error("SQLite project head failed direct revision readback");
    }
    const sqliteUserVersion = Number((versionResult.result.resultRows as Row[])[0]?.user_version);
    const projectSchemaVersion = Number(project.schema_version);
    if (sqliteUserVersion !== CURRENT_SCHEMA_VERSION || projectSchemaVersion !== CURRENT_SCHEMA_VERSION) {
      throw new Error("SQLite schema version readback does not match the supported version");
    }
    return {
      sqliteUserVersion,
      projectSchemaVersion,
      projectId: String(project.id),
      revisionCount: Number(project.revision_count),
      currentRevisionReadback: String(project.current_revision_id),
      tables: (tableResult.result.resultRows as Row[]).map((row) => String(row.name)),
    };
  }
}

export function openProjectRepository(): Promise<ProjectRepository> {
  return SqliteOpfsProjectRepository.open();
}
