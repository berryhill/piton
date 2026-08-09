from __future__ import annotations

import hashlib
import sqlite3

import pytest

from piton.revision import DesignRevision
from piton.source_tree import SourceTree, SourceTreeFile
from piton.storage import (
    ActorAuthorityError,
    ChannelConflictError,
    RevisionRepository,
    StartupRecoveryError,
)
from piton.storage.blobs import BlobStore
from piton.storage.db import Database
from piton.storage.revisions import MutationCapability, _issue_server_mutation_capability


def source_tree(source: bytes = b"def build():\n    return None\n") -> SourceTree:
    return SourceTree(
        files=(
            SourceTreeFile("source/part.py", source, "text/x-python"),
            SourceTreeFile("locks/dependencies.lock", b"build123d==0.11.1\n", "text/plain"),
            SourceTreeFile("locks/toolchain.lock", b"python==3.12.11\n", "text/plain"),
        ),
        entrypoint="source/part.py:build",
        dependency_lock="locks/dependencies.lock",
        toolchain_lock="locks/toolchain.lock",
    )


def make_repository(tmp_path):
    database = Database(tmp_path / "piton.sqlite3")
    database.migrate()
    with database.immediate() as connection:
        connection.execute(
            "INSERT INTO projects(project_id, display_name, format_version, state, created_at) "
            "VALUES('project_one', 'One', 1, 'active', '2026-01-01T00:00:00Z')"
        )
    return (
        database,
        BlobStore(tmp_path),
        RevisionRepository(database, BlobStore(tmp_path)),
        _issue_server_mutation_capability(),
    )


def revision(tree: SourceTree, *, parent_revision_id=None, height="10 mm") -> DesignRevision:
    by_path = {item.path: item for item in tree.files}
    return DesignRevision(
        parent_revision_id=parent_revision_id,
        source_manifest_digest=tree.digest,
        entrypoint=tree.entrypoint,
        dependency_lock_digest=by_path[tree.dependency_lock].digest,
        toolchain_lock_digest=by_path[tree.toolchain_lock].digest,
        parameter_values={"height": height},
    )


def test_source_tree_identity_is_canonical_and_covers_every_authoritative_claim():
    original = source_tree()
    reordered = SourceTree(
        files=tuple(reversed(original.files)),
        entrypoint=original.entrypoint,
        dependency_lock=original.dependency_lock,
        toolchain_lock=original.toolchain_lock,
    )
    changed_bytes = source_tree(b"def build():\n    return 1\n")
    changed_media = SourceTree(
        files=(
            SourceTreeFile("source/part.py", original.files[0].content, "text/plain"),
            *original.files[1:],
        ),
        entrypoint=original.entrypoint,
        dependency_lock=original.dependency_lock,
        toolchain_lock=original.toolchain_lock,
    )

    assert reordered.canonical_bytes == original.canonical_bytes
    assert reordered.digest == original.digest
    assert changed_bytes.digest != original.digest
    assert changed_media.digest != original.digest
    assert hashlib.sha256(original.canonical_bytes).hexdigest() == original.digest[7:]


@pytest.mark.parametrize("path", ["../part.py", "/part.py", "source\\part.py", "source//part.py"])
def test_source_tree_rejects_nonportable_paths(path):
    with pytest.raises(ValueError, match="portable"):
        SourceTreeFile(path, b"pass\n", "text/x-python")


def test_publish_source_tree_and_revision_promotes_all_blobs_before_metadata(tmp_path):
    database, store, repository, authority = make_repository(tmp_path)
    tree = source_tree()
    record = revision(tree)

    repository.publish_source_tree("project_one", tree, capability=authority)
    repository.persist_revision("project_one", record, capability=authority)

    for item in tree.files:
        assert store.exists_verified(item.digest)
    assert store.exists_verified(tree.digest)
    manifest_digest = "sha256:" + hashlib.sha256(record.canonical_bytes).hexdigest()
    assert store.exists_verified(manifest_digest)
    with database.read() as connection:
        source_row = connection.execute(
            "SELECT manifest_digest, entrypoint FROM source_trees WHERE manifest_digest=?",
            (tree.digest,),
        ).fetchone()
        revision_row = connection.execute(
            "SELECT revision_id, manifest_digest FROM design_revisions WHERE revision_id=?",
            (record.revision_id,),
        ).fetchone()
    assert tuple(source_row) == (tree.digest, tree.entrypoint)
    assert tuple(revision_row) == (record.revision_id, manifest_digest)


def test_source_tree_metadata_stays_invisible_when_final_cas_readback_fails(
    tmp_path, monkeypatch
):
    database, store, repository, authority = make_repository(tmp_path)
    tree = source_tree()
    blocked_digest = tree.files[0].digest
    real_open_verified = repository.blobs.open_verified

    def fail_one_readback(digest, *, expected_size=None):
        if digest == blocked_digest:
            raise FileNotFoundError(digest)
        return real_open_verified(digest, expected_size=expected_size)

    monkeypatch.setattr(repository.blobs, "open_verified", fail_one_readback)

    with pytest.raises(StartupRecoveryError, match="source tree publication"):
        repository.publish_source_tree("project_one", tree, capability=authority)

    with database.read() as connection:
        assert connection.execute("SELECT count(*) FROM artifacts").fetchone()[0] == 0
        assert connection.execute("SELECT count(*) FROM source_trees").fetchone()[0] == 0

    monkeypatch.undo()
    recovered_repository = RevisionRepository(database, BlobStore(tmp_path))
    assert (
        recovered_repository.publish_source_tree(
            "project_one", tree, capability=authority
        )
        == tree.digest
    )


def test_revision_metadata_stays_invisible_when_referenced_source_file_is_corrupt(tmp_path):
    database, store, repository, authority = make_repository(tmp_path)
    tree = source_tree()
    record = revision(tree)
    repository.publish_source_tree("project_one", tree, capability=authority)

    source_path = store.object_path(tree.files[0].digest)
    source_path.chmod(0o600)
    source_path.write_bytes(b"corrupt\n")

    with pytest.raises(StartupRecoveryError, match="revision publication"):
        repository.persist_revision("project_one", record, capability=authority)

    with database.read() as connection:
        assert connection.execute("SELECT count(*) FROM design_revisions").fetchone()[0] == 0


def test_atomic_commit_metadata_stays_invisible_when_final_cas_readback_fails(
    tmp_path, monkeypatch
):
    database, _store, repository, authority = make_repository(tmp_path)
    base_tree = source_tree()
    base_revision = revision(base_tree)
    repository.publish_source_tree("project_one", base_tree, capability=authority)
    repository.persist_revision("project_one", base_revision, capability=authority)
    repository.move_channel(
        "project_one",
        "workspace",
        base_revision.revision_id,
        expected_revision_id=None,
        expected_generation=0,
        capability=authority,
    )
    changed_tree = source_tree(b"def build():\n    return 1\n")
    changed_revision = revision(
        changed_tree, parent_revision_id=base_revision.revision_id, height="11 mm"
    )
    blocked_digest = changed_tree.files[0].digest
    real_open_verified = repository.blobs.open_verified

    def fail_one_readback(digest, *, expected_size=None):
        if digest == blocked_digest:
            raise FileNotFoundError(digest)
        return real_open_verified(digest, expected_size=expected_size)

    monkeypatch.setattr(repository.blobs, "open_verified", fail_one_readback)

    with pytest.raises(StartupRecoveryError, match="atomic revision publication"):
        repository._commit_source_tree_revision_to_channel(
            "project_one",
            changed_tree,
            changed_revision,
            "workspace",
            expected_revision_id=base_revision.revision_id,
            expected_generation=1,
            capability=authority,
        )

    with database.read() as connection:
        assert connection.execute("SELECT count(*) FROM source_trees").fetchone()[0] == 1
        assert connection.execute("SELECT count(*) FROM design_revisions").fetchone()[0] == 1
        assert tuple(
            connection.execute(
                "SELECT revision_id, generation FROM channel_pointers "
                "WHERE project_id='project_one' AND channel='workspace'"
            ).fetchone()
        ) == (base_revision.revision_id, 1)


def test_startup_recovery_quarantines_incomplete_staging_before_repository_is_ready(tmp_path):
    database, store, _repository, _authority = make_repository(tmp_path)
    staged = store.stage_stream(
        "interrupted", "manifest", (b"{}\n",), media_type="application/json", max_bytes=3
    )

    RevisionRepository(database, BlobStore(tmp_path))

    assert not staged.path.exists()
    recovered = list((store.quarantine_root / "startup-incomplete-publication").iterdir())
    assert len(recovered) == 1
    assert (recovered[0] / staged.path.name).read_bytes() == b"{}\n"


def test_startup_recovery_refuses_committed_metadata_with_missing_cas_object(tmp_path):
    database, store, repository, authority = make_repository(tmp_path)
    tree = source_tree()
    repository.publish_source_tree("project_one", tree, capability=authority)
    store.object_path(tree.files[0].digest).unlink()

    with pytest.raises(StartupRecoveryError, match="committed artifact"):
        RevisionRepository(database, BlobStore(tmp_path))


def test_missing_source_manifest_fails_closed(tmp_path):
    database, _store, repository, authority = make_repository(tmp_path)
    tree = source_tree()
    record = revision(tree)

    with pytest.raises(ValueError, match="source tree"):
        repository.persist_revision("project_one", record, capability=authority)
    with database.read() as connection:
        assert connection.execute("SELECT count(*) FROM design_revisions").fetchone()[0] == 0


@pytest.mark.parametrize("forged_actor", ["author", "operator", "daemon"])
def test_caller_actor_assertions_cannot_mint_any_mutation_authority(tmp_path, forged_actor):
    database, _store, repository, _authority = make_repository(tmp_path)
    tree = source_tree()
    record = revision(tree)

    operations = (
        lambda: repository.publish_source_tree("project_one", tree, capability=forged_actor),
        lambda: repository.persist_revision("project_one", record, capability=forged_actor),
        lambda: repository.move_channel(
            "project_one",
            "candidate",
            None,
            expected_revision_id=None,
            expected_generation=0,
            capability=forged_actor,
        ),
    )
    for operation in operations:
        with pytest.raises(ActorAuthorityError):
            operation()

    with pytest.raises(ActorAuthorityError):
        MutationCapability()
    forged_capability = object.__new__(MutationCapability)
    with pytest.raises(ActorAuthorityError):
        repository.publish_source_tree("project_one", tree, capability=forged_capability)
    with database.read() as connection:
        assert connection.execute("SELECT count(*) FROM source_trees").fetchone()[0] == 0
        assert connection.execute("SELECT count(*) FROM design_revisions").fetchone()[0] == 0
        assert connection.execute("SELECT count(*) FROM channel_pointers").fetchone()[0] == 0


def test_revision_rows_are_idempotent_but_cannot_be_replaced_or_deleted(tmp_path):
    database, _store, repository, authority = make_repository(tmp_path)
    tree = source_tree()
    record = revision(tree)
    repository.publish_source_tree("project_one", tree, capability=authority)
    repository.persist_revision("project_one", record, capability=authority)
    repository.persist_revision("project_one", record, capability=authority)

    with pytest.raises(sqlite3.IntegrityError, match="immutable"):
        with database.immediate() as connection:
            connection.execute(
                "UPDATE design_revisions SET created_at='later' WHERE revision_id=?",
                (record.revision_id,),
            )
    with pytest.raises(sqlite3.IntegrityError, match="immutable"):
        with database.immediate() as connection:
            connection.execute("DELETE FROM source_trees WHERE manifest_digest=?", (tree.digest,))


def test_channel_move_requires_expected_head_and_generation_cas(tmp_path):
    _database, _store, repository, authority = make_repository(tmp_path)
    tree = source_tree()
    first = revision(tree)
    second = revision(tree, parent_revision_id=first.revision_id, height="11 mm")
    repository.publish_source_tree("project_one", tree, capability=authority)
    repository.persist_revision("project_one", first, capability=authority)
    repository.persist_revision("project_one", second, capability=authority)

    pointer = repository.move_channel(
        "project_one",
        "candidate",
        first.revision_id,
        expected_revision_id=None,
        expected_generation=0,
        capability=authority,
    )
    assert (pointer.revision_id, pointer.generation) == (first.revision_id, 1)

    with pytest.raises(ChannelConflictError):
        repository.move_channel(
            "project_one",
            "candidate",
            second.revision_id,
            expected_revision_id=None,
            expected_generation=0,
            capability=authority,
        )
    with pytest.raises(ChannelConflictError):
        repository.move_channel(
            "project_one",
            "candidate",
            second.revision_id,
            expected_revision_id=first.revision_id,
            expected_generation=0,
            capability=authority,
        )

    pointer = repository.move_channel(
        "project_one",
        "candidate",
        second.revision_id,
        expected_revision_id=first.revision_id,
        expected_generation=1,
        capability=authority,
    )
    assert (pointer.revision_id, pointer.generation) == (second.revision_id, 2)
