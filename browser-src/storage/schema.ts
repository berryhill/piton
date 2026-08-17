export const CURRENT_SCHEMA_VERSION = 3;

export const LIFECYCLE_TABLES = Object.freeze([
  "change_proposals",
  "proposal_dispositions",
  "revisions",
  "build_attempts",
  "evidence_closures",
  "channel_pointers",
  "approval_records",
  "draft_exports",
  "fabrication_releases",
  "released_package_projections",
] as const);

const BUILD_STATUS_TABLE = `CREATE TABLE IF NOT EXISTS build_status (
      project_id TEXT PRIMARY KEY,
      request_id INTEGER NOT NULL,
      base_revision_id TEXT NOT NULL,
      preview_digest TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('idle', 'previewing', 'ready', 'failed')),
      message TEXT NOT NULL
    ) STRICT`;

const LIFECYCLE_SCHEMA = [
  `CREATE TABLE change_proposals (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      base_revision_id TEXT NOT NULL,
      command_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(project_id, id)
    ) STRICT`,
  `CREATE TABLE proposal_dispositions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      proposal_id TEXT NOT NULL,
      disposition TEXT NOT NULL CHECK (disposition IN ('changes_requested', 'accepted_for_build', 'accepted_for_review')),
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(project_id, id)
    ) STRICT`,
  `CREATE TABLE build_attempts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      revision_id TEXT NOT NULL,
      recipe_digest TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('admitted', 'running', 'succeeded', 'failed', 'blocked')),
      created_at TEXT NOT NULL,
      UNIQUE(project_id, id)
    ) STRICT`,
  `CREATE TABLE evidence_closures (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      revision_id TEXT NOT NULL,
      build_attempt_id TEXT NOT NULL,
      requirements_json TEXT NOT NULL,
      artifacts_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(project_id, id)
    ) STRICT`,
  `CREATE TABLE channel_pointers (
      project_id TEXT NOT NULL,
      channel TEXT NOT NULL CHECK (channel IN ('workspace', 'candidate', 'review')),
      revision_id TEXT NOT NULL,
      version INTEGER NOT NULL CHECK (version >= 1),
      updated_at TEXT NOT NULL,
      PRIMARY KEY(project_id, channel)
    ) STRICT`,
  `CREATE TABLE approval_records (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      revision_id TEXT NOT NULL,
      evidence_closure_id TEXT NOT NULL,
      decision TEXT NOT NULL CHECK (decision IN ('rejected', 'deferred')),
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(project_id, id)
    ) STRICT`,
  `CREATE TABLE draft_exports (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      revision_id TEXT NOT NULL,
      evidence_closure_id TEXT NOT NULL,
      manifest_digest TEXT NOT NULL,
      release_state TEXT NOT NULL CHECK (release_state = 'unreleased'),
      created_at TEXT NOT NULL,
      UNIQUE(project_id, id)
    ) STRICT`,
  `CREATE TABLE fabrication_releases (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      revision_id TEXT NOT NULL,
      approval_record_id TEXT NOT NULL,
      draft_export_id TEXT NOT NULL,
      fabrication_release INTEGER NOT NULL CHECK (fabrication_release = 0),
      machine_actuation INTEGER NOT NULL CHECK (machine_actuation = 0),
      created_at TEXT NOT NULL,
      UNIQUE(project_id, id)
    ) STRICT`,
  `CREATE TABLE released_package_projections (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      fabrication_release_id TEXT NOT NULL,
      package_digest TEXT NOT NULL,
      fabrication_release INTEGER NOT NULL CHECK (fabrication_release = 0),
      machine_actuation INTEGER NOT NULL CHECK (machine_actuation = 0),
      created_at TEXT NOT NULL,
      UNIQUE(project_id, id)
    ) STRICT`,
] as const;

const CORE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      accepted_revision_id TEXT NOT NULL,
      current_revision_id TEXT NOT NULL,
      schema_version INTEGER NOT NULL
    ) STRICT`,
  `CREATE TABLE IF NOT EXISTS revisions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      parent_revision_id TEXT,
      created_at TEXT NOT NULL,
      authority_profile TEXT NOT NULL CHECK (authority_profile = 'browser-typescript/v1'),
      parameters_json TEXT NOT NULL,
      review_state TEXT NOT NULL CHECK (review_state = 'needs_human_review'),
      fabrication_release INTEGER NOT NULL CHECK (fabrication_release = 0),
      machine_actuation INTEGER NOT NULL CHECK (machine_actuation = 0),
      release_state TEXT NOT NULL CHECK (release_state = 'unreleased'),
      UNIQUE(project_id, id)
    ) STRICT`,
  BUILD_STATUS_TABLE,
] as const;

export function migrationStatements(fromVersion: number): string[] {
  if (!Number.isInteger(fromVersion) || fromVersion < 0) {
    throw new Error(`invalid SQLite schema version ${fromVersion}`);
  }
  if (fromVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `SQLite schema version ${fromVersion} is newer than supported version ${CURRENT_SCHEMA_VERSION}`,
    );
  }
  if (fromVersion === CURRENT_SCHEMA_VERSION) return [];
  if (fromVersion === 2) return [
    ...LIFECYCLE_SCHEMA,
    `UPDATE projects SET schema_version = ${CURRENT_SCHEMA_VERSION}`,
    `PRAGMA user_version = ${CURRENT_SCHEMA_VERSION}`,
  ];
  if (fromVersion === 1) return [
    "DROP TABLE build_status",
    BUILD_STATUS_TABLE,
    "PRAGMA user_version = 2",
    ...LIFECYCLE_SCHEMA,
    `UPDATE projects SET schema_version = ${CURRENT_SCHEMA_VERSION}`,
    `PRAGMA user_version = ${CURRENT_SCHEMA_VERSION}`,
  ];
  return [
    ...CORE_SCHEMA,
    ...LIFECYCLE_SCHEMA,
    `PRAGMA user_version = ${CURRENT_SCHEMA_VERSION}`,
  ];
}
