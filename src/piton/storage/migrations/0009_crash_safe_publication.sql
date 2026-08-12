CREATE TABLE artifact_publications(
    attempt_id TEXT PRIMARY KEY REFERENCES build_attempts(attempt_id),
    project_id TEXT NOT NULL,
    revision_id TEXT NOT NULL,
    worker_result_digest TEXT NOT NULL,
    generation INTEGER NOT NULL CHECK(generation>=0),
    fence INTEGER NOT NULL CHECK(fence>=0),
    lease_id TEXT NOT NULL CHECK(length(lease_id)>0),
    closure_digest TEXT UNIQUE,
    state TEXT NOT NULL CHECK(state IN ('committing','committed','quarantined')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK((state='committed' AND closure_digest IS NOT NULL) OR
          (state!='committed' AND closure_digest IS NULL)),
    FOREIGN KEY(attempt_id) REFERENCES build_attempts(attempt_id),
    FOREIGN KEY(revision_id, project_id) REFERENCES design_revisions(revision_id, project_id)
) STRICT;

CREATE TRIGGER artifact_publications_transition_guard
BEFORE UPDATE ON artifact_publications
WHEN OLD.state!='committing' OR NEW.state NOT IN ('committed','quarantined') OR
     NEW.attempt_id!=OLD.attempt_id OR NEW.project_id!=OLD.project_id OR
     NEW.revision_id!=OLD.revision_id OR NEW.worker_result_digest!=OLD.worker_result_digest OR
     NEW.generation!=OLD.generation OR NEW.fence!=OLD.fence OR NEW.lease_id!=OLD.lease_id OR
     NEW.created_at!=OLD.created_at
BEGIN
    SELECT RAISE(ABORT, 'artifact publication transition is immutable');
END;

CREATE TRIGGER artifact_publications_no_delete
BEFORE DELETE ON artifact_publications
BEGIN
    SELECT RAISE(ABORT, 'artifact publications are durable');
END;
