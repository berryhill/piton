DROP TRIGGER command_receipts_no_update;
DROP TRIGGER command_receipts_no_delete;
DROP TRIGGER idempotency_keys_no_update;
DROP TRIGGER idempotency_keys_no_delete;

CREATE TABLE command_receipts_v10(
    receipt_id TEXT PRIMARY KEY,
    command_id TEXT NOT NULL UNIQUE,
    project_id TEXT NOT NULL REFERENCES projects(project_id),
    actor_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('create_project','delete_project','import_source_base','begin_draft','update_draft','commit_draft','discard_draft','restore_forward','admit_change_proposal','record_proposal_disposition','admit_build_attempt','record_evidence_closure','move_channel','sign_approval','create_draft_export','reject_fabrication_release','record_released_package_projection')),
    request_digest TEXT NOT NULL,
    outcome TEXT NOT NULL CHECK(outcome IN ('applied','rejected')),
    receipt_json BLOB NOT NULL,
    committed_at TEXT NOT NULL
) STRICT;

CREATE TABLE idempotency_keys_v10(
    project_id TEXT NOT NULL REFERENCES projects(project_id),
    actor_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    request_digest TEXT NOT NULL,
    receipt_id TEXT NOT NULL UNIQUE REFERENCES command_receipts_v10(receipt_id),
    created_at TEXT NOT NULL,
    PRIMARY KEY(project_id,actor_id,operation,idempotency_key)
) STRICT;

INSERT INTO command_receipts_v10
SELECT * FROM command_receipts;
INSERT INTO idempotency_keys_v10
SELECT * FROM idempotency_keys;

DROP TABLE idempotency_keys;
DROP TABLE command_receipts;
ALTER TABLE command_receipts_v10 RENAME TO command_receipts;
ALTER TABLE idempotency_keys_v10 RENAME TO idempotency_keys;

CREATE TRIGGER command_receipts_no_update
BEFORE UPDATE ON command_receipts
BEGIN
    SELECT RAISE(ABORT, 'command receipts are immutable');
END;

CREATE TRIGGER command_receipts_no_delete
BEFORE DELETE ON command_receipts
BEGIN
    SELECT RAISE(ABORT, 'command receipts are immutable');
END;

CREATE TRIGGER idempotency_keys_no_update
BEFORE UPDATE ON idempotency_keys
BEGIN
    SELECT RAISE(ABORT, 'idempotency identities are immutable');
END;

CREATE TRIGGER idempotency_keys_no_delete
BEFORE DELETE ON idempotency_keys
BEGIN
    SELECT RAISE(ABORT, 'idempotency identities are immutable');
END;
