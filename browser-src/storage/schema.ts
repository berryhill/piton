export const CURRENT_SCHEMA_VERSION = 2;

const BUILD_STATUS_TABLE = `CREATE TABLE IF NOT EXISTS build_status (
      project_id TEXT PRIMARY KEY,
      request_id INTEGER NOT NULL,
      base_revision_id TEXT NOT NULL,
      preview_digest TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('idle', 'previewing', 'ready', 'failed')),
      message TEXT NOT NULL
    ) STRICT`;

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
  if (fromVersion === 1) return [
    "DROP TABLE build_status",
    BUILD_STATUS_TABLE,
    `UPDATE projects SET schema_version = ${CURRENT_SCHEMA_VERSION}`,
    `PRAGMA user_version = ${CURRENT_SCHEMA_VERSION}`,
  ];
  return [
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
    `PRAGMA user_version = ${CURRENT_SCHEMA_VERSION}`,
  ];
}