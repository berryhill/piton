CREATE TABLE source_trees(
    manifest_digest TEXT PRIMARY KEY REFERENCES artifacts(digest),
    project_id TEXT NOT NULL REFERENCES projects(project_id),
    entrypoint TEXT NOT NULL,
    dependency_lock_digest TEXT NOT NULL REFERENCES artifacts(digest),
    toolchain_lock_digest TEXT NOT NULL REFERENCES artifacts(digest),
    created_at TEXT NOT NULL
) STRICT;
CREATE INDEX source_trees_project_idx ON source_trees(project_id);

CREATE TRIGGER source_trees_no_update
BEFORE UPDATE ON source_trees
BEGIN
    SELECT RAISE(ABORT, 'source trees are immutable');
END;

CREATE TRIGGER source_trees_no_delete
BEFORE DELETE ON source_trees
BEGIN
    SELECT RAISE(ABORT, 'source trees are immutable');
END;

CREATE TRIGGER design_revisions_no_update
BEFORE UPDATE ON design_revisions
BEGIN
    SELECT RAISE(ABORT, 'design revisions are immutable');
END;

CREATE TRIGGER design_revisions_no_delete
BEFORE DELETE ON design_revisions
BEGIN
    SELECT RAISE(ABORT, 'design revisions are immutable');
END;
