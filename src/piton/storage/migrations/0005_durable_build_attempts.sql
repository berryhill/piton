CREATE UNIQUE INDEX design_revisions_exact_project_idx
    ON design_revisions(revision_id, project_id);

CREATE TABLE build_attempts(
    attempt_id TEXT PRIMARY KEY CHECK(length(attempt_id)>0),
    project_id TEXT NOT NULL,
    revision_id TEXT NOT NULL,
    input_manifest_digest TEXT NOT NULL CHECK(length(input_manifest_digest)=71 AND substr(input_manifest_digest,1,7)='sha256:' AND substr(input_manifest_digest,8) NOT GLOB '*[^0-9a-f]*'),
    recipe_digest TEXT NOT NULL CHECK(length(recipe_digest)=71 AND substr(recipe_digest,1,7)='sha256:' AND substr(recipe_digest,8) NOT GLOB '*[^0-9a-f]*'),
    toolchain_digest TEXT NOT NULL CHECK(length(toolchain_digest)=71 AND substr(toolchain_digest,1,7)='sha256:' AND substr(toolchain_digest,8) NOT GLOB '*[^0-9a-f]*'),
    capability_manifest_digest TEXT NOT NULL CHECK(length(capability_manifest_digest)=71 AND substr(capability_manifest_digest,1,7)='sha256:' AND substr(capability_manifest_digest,8) NOT GLOB '*[^0-9a-f]*'),
    resource_limits_digest TEXT NOT NULL CHECK(length(resource_limits_digest)=71 AND substr(resource_limits_digest,1,7)='sha256:' AND substr(resource_limits_digest,8) NOT GLOB '*[^0-9a-f]*'),
    expected_outputs_digest TEXT NOT NULL CHECK(length(expected_outputs_digest)=71 AND substr(expected_outputs_digest,1,7)='sha256:' AND substr(expected_outputs_digest,8) NOT GLOB '*[^0-9a-f]*'),
    request_signature_digest TEXT NOT NULL CHECK(length(request_signature_digest)=71 AND substr(request_signature_digest,1,7)='sha256:' AND substr(request_signature_digest,8) NOT GLOB '*[^0-9a-f]*'),
    worker_id TEXT NOT NULL CHECK(length(worker_id)>0),
    isolation_class TEXT NOT NULL CHECK(isolation_class IN ('wasm','container','microvm','trusted-local')),
    admission_state TEXT NOT NULL CHECK(admission_state='admitted'),
    admitted_at TEXT NOT NULL,
    FOREIGN KEY(project_id) REFERENCES projects(project_id),
    FOREIGN KEY(revision_id, project_id) REFERENCES design_revisions(revision_id, project_id)
) STRICT;
CREATE INDEX build_attempts_project_revision_idx
    ON build_attempts(project_id, revision_id, admitted_at);

CREATE TABLE build_coordinator_state(
    attempt_id TEXT PRIMARY KEY REFERENCES build_attempts(attempt_id),
    state TEXT NOT NULL CHECK(state IN ('admitted','dispatching','leased','running','committing','succeeded','failed','cancelled','blocked')),
    generation INTEGER NOT NULL CHECK(generation>=0),
    fence INTEGER NOT NULL CHECK(fence>=0),
    lease_id TEXT,
    lease_expires_at TEXT,
    updated_at TEXT NOT NULL,
    CHECK((lease_id IS NULL AND lease_expires_at IS NULL) OR (length(lease_id)>0 AND lease_expires_at IS NOT NULL))
) STRICT;

CREATE TRIGGER build_attempts_no_update
BEFORE UPDATE ON build_attempts
BEGIN
    SELECT RAISE(ABORT, 'build attempts are immutable');
END;

CREATE TRIGGER build_attempts_no_duplicate_insert
BEFORE INSERT ON build_attempts
WHEN EXISTS(SELECT 1 FROM build_attempts WHERE attempt_id=NEW.attempt_id)
BEGIN
    SELECT RAISE(ABORT, 'build attempts are immutable');
END;

CREATE TRIGGER build_attempts_no_delete
BEFORE DELETE ON build_attempts
BEGIN
    SELECT RAISE(ABORT, 'build attempts are immutable');
END;

CREATE TRIGGER build_coordinator_state_no_delete
BEFORE DELETE ON build_coordinator_state
BEGIN
    SELECT RAISE(ABORT, 'build coordinator state is durable');
END;
