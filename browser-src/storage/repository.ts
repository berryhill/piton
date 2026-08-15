import { sqlite3Worker1Promiser, type Worker1Promiser } from "@sqlite.org/sqlite-wasm";
import type { BrowserProject, CandidateCommand, DesignRevision } from "../domain";
import { assertProjectIntegrity, deriveCandidateFromCommand, seedProject } from "../domain";
import { CURRENT_SCHEMA_VERSION, migrationStatements } from "./schema";
import type { GeometryAuthorityBinding } from "../geometry/binding";

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
  loadBuildStatus(projectId: string): Promise<BuildStatus | null>;
  saveBuildStatus(status: BuildStatus): Promise<void>;
  persistenceLabel: string;
}

export class MemoryProjectRepository implements ProjectRepository {
  private project: BrowserProject | null = null;
  private buildStatus: BuildStatus | null = null;
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

  async loadBuildStatus(projectId: string) {
    return this.buildStatus?.projectId === projectId ? structuredClone(this.buildStatus) : null;
  }

  async saveBuildStatus(status: BuildStatus) {
    if (!this.project) throw new Error("project is not initialized");
    assertBuildStatusBinding(status, this.project);
    this.buildStatus = structuredClone(status);
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

export class SqliteOpfsProjectRepository implements ProjectRepository {
  private promiser!: Worker1Promiser;
  private dbId!: string;
  persistenceLabel = "SQLite WASM · OPFS";

  static async open(): Promise<SqliteOpfsProjectRepository> {
    if (!crossOriginIsolated || !navigator.storage?.getDirectory) {
      throw new Error("OPFS persistence requires a cross-origin-isolated browser context");
    }
    const repository = new SqliteOpfsProjectRepository();
    repository.promiser = await waitForSqliteWorker(({ onready, onerror }) => {
      sqlite3Worker1Promiser({ onready, onerror });
    });
    const opened = await repository.promiser("open", { filename: "file:piton.sqlite3?vfs=opfs" });
    repository.dbId = opened.result.dbId;
    const versionResult = await repository.exec("PRAGMA user_version");
    const fromVersion = Number((versionResult.result.resultRows as Row[])[0]?.user_version);
    const migrations = migrationStatements(fromVersion);
    if (migrations.length) {
      await repository.exec("BEGIN IMMEDIATE");
      try {
        for (const sql of migrations) await repository.exec(sql);
        await repository.exec("COMMIT");
      } catch (error) {
        await repository.exec("ROLLBACK");
        throw error;
      }
    }
    const migratedVersion = await repository.exec("PRAGMA user_version");
    if (Number((migratedVersion.result.resultRows as Row[])[0]?.user_version) !== CURRENT_SCHEMA_VERSION) {
      throw new Error("SQLite schema migration did not reach the supported version");
    }
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

export async function openSeededRepository(): Promise<ProjectRepository> {
  const repository = await SqliteOpfsProjectRepository.open();
  await repository.initialize();
  return repository;
}
