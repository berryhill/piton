CREATE UNIQUE INDEX build_attempts_exact_evidence_idx
    ON build_attempts(attempt_id, project_id, revision_id);

CREATE TABLE evidence_check_declarations(
    attempt_id TEXT PRIMARY KEY REFERENCES build_attempts(attempt_id),
    project_id TEXT NOT NULL,
    revision_id TEXT NOT NULL,
    declaration_digest TEXT NOT NULL UNIQUE CHECK(length(declaration_digest)=71 AND substr(declaration_digest,1,7)='sha256:' AND substr(declaration_digest,8) NOT GLOB '*[^0-9a-f]*'),
    canonical_json BLOB NOT NULL,
    review_state TEXT NOT NULL CHECK(review_state='needs_human_review'),
    fabrication_release INTEGER NOT NULL CHECK(fabrication_release=0),
    machine_actuation INTEGER NOT NULL CHECK(machine_actuation=0),
    FOREIGN KEY(attempt_id, project_id, revision_id) REFERENCES build_attempts(attempt_id, project_id, revision_id)
) STRICT;

CREATE TABLE evidence_closures(
    closure_digest TEXT PRIMARY KEY CHECK(length(closure_digest)=71 AND substr(closure_digest,1,7)='sha256:' AND substr(closure_digest,8) NOT GLOB '*[^0-9a-f]*'),
    project_id TEXT NOT NULL,
    revision_id TEXT NOT NULL,
    attempt_id TEXT NOT NULL UNIQUE REFERENCES build_attempts(attempt_id),
    declaration_digest TEXT NOT NULL UNIQUE REFERENCES evidence_check_declarations(declaration_digest),
    worker_result_digest TEXT NOT NULL CHECK(length(worker_result_digest)=71 AND substr(worker_result_digest,1,7)='sha256:' AND substr(worker_result_digest,8) NOT GLOB '*[^0-9a-f]*'),
    generation INTEGER NOT NULL CHECK(generation>=0),
    fence INTEGER NOT NULL CHECK(fence>=0),
    lease_id TEXT NOT NULL CHECK(length(lease_id)>0),
    canonical_json BLOB NOT NULL,
    review_state TEXT NOT NULL CHECK(review_state='needs_human_review'),
    fabrication_release INTEGER NOT NULL CHECK(fabrication_release=0),
    machine_actuation INTEGER NOT NULL CHECK(machine_actuation=0),
    created_at TEXT NOT NULL,
    FOREIGN KEY(attempt_id, project_id, revision_id) REFERENCES build_attempts(attempt_id, project_id, revision_id)
) STRICT;
CREATE INDEX evidence_closures_project_revision_idx
    ON evidence_closures(project_id, revision_id, created_at);

CREATE TABLE evidence_check_receipts(
    receipt_digest TEXT PRIMARY KEY CHECK(length(receipt_digest)=71 AND substr(receipt_digest,1,7)='sha256:' AND substr(receipt_digest,8) NOT GLOB '*[^0-9a-f]*'),
    declaration_digest TEXT NOT NULL REFERENCES evidence_check_declarations(declaration_digest),
    check_id TEXT NOT NULL CHECK(length(check_id)>0),
    project_id TEXT NOT NULL,
    revision_id TEXT NOT NULL,
    attempt_id TEXT NOT NULL REFERENCES build_attempts(attempt_id),
    worker_result_digest TEXT NOT NULL CHECK(length(worker_result_digest)=71 AND substr(worker_result_digest,1,7)='sha256:' AND substr(worker_result_digest,8) NOT GLOB '*[^0-9a-f]*'),
    status TEXT NOT NULL CHECK(status IN ('pass','fail','blocked')),
    canonical_json BLOB NOT NULL,
    review_state TEXT NOT NULL CHECK(review_state='needs_human_review'),
    fabrication_release INTEGER NOT NULL CHECK(fabrication_release=0),
    machine_actuation INTEGER NOT NULL CHECK(machine_actuation=0),
    UNIQUE(declaration_digest, check_id),
    FOREIGN KEY(attempt_id, project_id, revision_id) REFERENCES build_attempts(attempt_id, project_id, revision_id)
) STRICT;

CREATE TABLE evidence_closure_receipts(
    closure_digest TEXT NOT NULL REFERENCES evidence_closures(closure_digest),
    ordinal INTEGER NOT NULL CHECK(ordinal>=0 AND ordinal<5),
    receipt_digest TEXT NOT NULL UNIQUE REFERENCES evidence_check_receipts(receipt_digest),
    PRIMARY KEY(closure_digest, ordinal)
) STRICT;

CREATE TABLE evidence_closure_artifacts(
    closure_digest TEXT NOT NULL REFERENCES evidence_closures(closure_digest),
    role TEXT NOT NULL CHECK(length(role)>0),
    artifact_digest TEXT NOT NULL REFERENCES artifacts(digest),
    claim_scope TEXT NOT NULL CHECK(length(claim_scope)>0),
    units TEXT NOT NULL CHECK(length(units)>0),
    relative_path TEXT NOT NULL CHECK(length(relative_path)>0),
    PRIMARY KEY(closure_digest, role)
) STRICT;

CREATE TRIGGER evidence_check_declarations_no_update
BEFORE UPDATE ON evidence_check_declarations BEGIN
    SELECT RAISE(ABORT, 'evidence check declarations are immutable');
END;
CREATE TRIGGER evidence_check_declarations_no_duplicate_insert
BEFORE INSERT ON evidence_check_declarations
WHEN EXISTS(SELECT 1 FROM evidence_check_declarations WHERE attempt_id=NEW.attempt_id)
BEGIN
    SELECT RAISE(ABORT, 'evidence check declarations are immutable');
END;
CREATE TRIGGER evidence_check_declarations_no_delete
BEFORE DELETE ON evidence_check_declarations BEGIN
    SELECT RAISE(ABORT, 'evidence check declarations are immutable');
END;
CREATE TRIGGER evidence_closures_no_update
BEFORE UPDATE ON evidence_closures BEGIN
    SELECT RAISE(ABORT, 'evidence closures are immutable');
END;
CREATE TRIGGER evidence_closures_no_duplicate_insert
BEFORE INSERT ON evidence_closures
WHEN EXISTS(SELECT 1 FROM evidence_closures WHERE closure_digest=NEW.closure_digest OR attempt_id=NEW.attempt_id)
BEGIN
    SELECT RAISE(ABORT, 'evidence closures are immutable');
END;
CREATE TRIGGER evidence_closures_no_delete
BEFORE DELETE ON evidence_closures BEGIN
    SELECT RAISE(ABORT, 'evidence closures are immutable');
END;
CREATE TRIGGER evidence_check_receipts_no_update
BEFORE UPDATE ON evidence_check_receipts BEGIN
    SELECT RAISE(ABORT, 'evidence check receipts are immutable');
END;
CREATE TRIGGER evidence_check_receipts_no_duplicate_insert
BEFORE INSERT ON evidence_check_receipts
WHEN EXISTS(SELECT 1 FROM evidence_check_receipts WHERE receipt_digest=NEW.receipt_digest OR (declaration_digest=NEW.declaration_digest AND check_id=NEW.check_id))
BEGIN
    SELECT RAISE(ABORT, 'evidence check receipts are immutable');
END;
CREATE TRIGGER evidence_check_receipts_no_delete
BEFORE DELETE ON evidence_check_receipts BEGIN
    SELECT RAISE(ABORT, 'evidence check receipts are immutable');
END;
CREATE TRIGGER evidence_closure_receipts_no_update
BEFORE UPDATE ON evidence_closure_receipts BEGIN
    SELECT RAISE(ABORT, 'evidence closure receipt links are immutable');
END;
CREATE TRIGGER evidence_closure_receipts_no_delete
BEFORE DELETE ON evidence_closure_receipts BEGIN
    SELECT RAISE(ABORT, 'evidence closure receipt links are immutable');
END;
CREATE TRIGGER evidence_closure_artifacts_no_update
BEFORE UPDATE ON evidence_closure_artifacts BEGIN
    SELECT RAISE(ABORT, 'evidence closure artifact links are immutable');
END;
CREATE TRIGGER evidence_closure_artifacts_no_delete
BEFORE DELETE ON evidence_closure_artifacts BEGIN
    SELECT RAISE(ABORT, 'evidence closure artifact links are immutable');
END;
