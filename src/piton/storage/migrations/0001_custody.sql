CREATE TABLE schema_migrations(
    version INTEGER PRIMARY KEY,
    digest TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL
) STRICT;

CREATE TABLE projects(
    project_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    format_version INTEGER NOT NULL CHECK(format_version=1),
    state TEXT NOT NULL CHECK(state IN ('active','quarantined','tombstoned')),
    created_at TEXT NOT NULL
) STRICT;

CREATE TABLE artifacts(
    digest TEXT PRIMARY KEY,
    media_type TEXT NOT NULL,
    byte_length INTEGER NOT NULL CHECK(byte_length>=0),
    storage_relpath TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    verified_at TEXT NOT NULL
) STRICT;

CREATE TABLE design_revisions(
    revision_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(project_id),
    parent_revision_id TEXT REFERENCES design_revisions(revision_id),
    proposal_id TEXT,
    manifest_digest TEXT NOT NULL UNIQUE REFERENCES artifacts(digest),
    source_manifest_digest TEXT NOT NULL REFERENCES artifacts(digest),
    authority_profile TEXT NOT NULL CHECK(authority_profile='source-native/v0'),
    created_at TEXT NOT NULL
) STRICT;
CREATE INDEX design_revisions_project_parent_idx
    ON design_revisions(project_id,parent_revision_id);

CREATE TABLE channel_pointers(
    project_id TEXT NOT NULL REFERENCES projects(project_id),
    channel TEXT NOT NULL CHECK(channel IN ('workspace','candidate','review','last_good')),
    revision_id TEXT REFERENCES design_revisions(revision_id),
    generation INTEGER NOT NULL CHECK(generation>=0),
    updated_at TEXT NOT NULL,
    PRIMARY KEY(project_id,channel)
) STRICT;

CREATE TABLE command_receipts(
    receipt_id TEXT PRIMARY KEY,
    command_id TEXT NOT NULL UNIQUE,
    project_id TEXT NOT NULL REFERENCES projects(project_id),
    actor_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('create_project','import_source_base','begin_draft','update_draft','commit_draft','discard_draft','restore_forward','admit_change_proposal','record_proposal_disposition','admit_build_attempt','record_evidence_closure','move_channel','sign_approval','create_draft_export','reject_fabrication_release','record_released_package_projection')),
    request_digest TEXT NOT NULL,
    outcome TEXT NOT NULL CHECK(outcome IN ('applied','rejected')),
    receipt_json BLOB NOT NULL,
    committed_at TEXT NOT NULL
) STRICT;

CREATE TABLE idempotency_keys(
    project_id TEXT NOT NULL REFERENCES projects(project_id),
    actor_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    request_digest TEXT NOT NULL,
    receipt_id TEXT NOT NULL UNIQUE REFERENCES command_receipts(receipt_id),
    created_at TEXT NOT NULL,
    PRIMARY KEY(project_id,actor_id,operation,idempotency_key)
) STRICT;

CREATE TABLE outbox(
    event_id TEXT PRIMARY KEY,
    topic TEXT NOT NULL,
    aggregate_id TEXT NOT NULL,
    payload_digest TEXT NOT NULL REFERENCES artifacts(digest),
    payload_json BLOB NOT NULL,
    created_at TEXT NOT NULL,
    delivered_at TEXT,
    delivery_attempts INTEGER NOT NULL DEFAULT 0 CHECK(delivery_attempts>=0)
) STRICT;
CREATE INDEX outbox_pending_idx ON outbox(delivered_at,created_at);
