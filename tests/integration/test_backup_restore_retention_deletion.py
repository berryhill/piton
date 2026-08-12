from __future__ import annotations

import hashlib
import json
import secrets
from pathlib import Path

import pytest
import piton.storage.custody as custody_module

from piton.revision import DesignRevision
from piton.source_tree import SourceTree, SourceTreeFile
from piton.storage import BlobStore, Database, RevisionRepository
from piton.storage.custody import (
    BackupValidationError,
    ProjectCustody,
    RetentionPolicy,
)
from piton.storage.revisions import _issue_server_mutation_capability


def _custody(database: Database, blobs: BlobStore) -> ProjectCustody:
    return ProjectCustody(database, blobs)


def _tree() -> SourceTree:
    return SourceTree(
        files=(
            SourceTreeFile("source/part.py", b"def build():\n    return None\n", "text/x-python"),
            SourceTreeFile("locks/dependencies.lock", b"build123d==0.11.1\n", "text/plain"),
            SourceTreeFile("locks/toolchain.lock", b"python==3.12.11\n", "text/plain"),
        ),
        entrypoint="source/part.py:build",
        dependency_lock="locks/dependencies.lock",
        toolchain_lock="locks/toolchain.lock",
    )


def _seed(root: Path) -> tuple[Database, BlobStore, DesignRevision]:
    database = Database(root / "piton.sqlite3")
    database.migrate()
    with database.immediate() as connection:
        connection.execute(
            "INSERT INTO projects(project_id,display_name,format_version,state,created_at) "
            "VALUES('project_one','One',1,'active','2026-01-01T00:00:00Z')"
        )
    blobs = BlobStore(root)
    repository = RevisionRepository(database, blobs)
    tree = _tree()
    files = {item.path: item for item in tree.files}
    revision = DesignRevision(
        parent_revision_id=None,
        source_manifest_digest=tree.digest,
        entrypoint=tree.entrypoint,
        dependency_lock_digest=files[tree.dependency_lock].digest,
        toolchain_lock_digest=files[tree.toolchain_lock].digest,
        parameter_values={"height": "10 mm"},
    )
    authority = _issue_server_mutation_capability()
    repository.publish_source_tree("project_one", tree, capability=authority)
    repository.persist_revision("project_one", revision, capability=authority)
    repository.move_channel(
        "project_one", "workspace", revision.revision_id,
        expected_revision_id=None, expected_generation=0, capability=authority,
    )
    return database, blobs, revision


def test_backup_is_deterministic_portable_closure_and_restore_survives_source_destruction(tmp_path: Path):
    source = tmp_path / "source"
    database, blobs, revision = _seed(source)
    custody = _custody(database, blobs)
    first = custody.backup(
        "project_one", tmp_path / "backup-a", created_at="2026-08-12T12:00:00Z"
    )
    second = custody.backup(
        "project_one", tmp_path / "backup-b", created_at="2026-08-12T12:00:00Z"
    )

    assert first.manifest_digest == second.manifest_digest
    manifest = json.loads((tmp_path / "backup-a" / "manifest.json").read_bytes())
    assert manifest["schema"] == "piton.project-backup.v1"
    assert manifest["project"]["project_id"] == "project_one"
    assert manifest["safety"] == {
        "fabrication_release": False,
        "machine_actuation": False,
        "review_state": "needs_human_review",
    }
    assert any("raw SQLite" in item for item in manifest["claim_scope_exclusions"])
    assert all(item["digest"].startswith("sha256:") for item in manifest["objects"])
    assert {item["digest"] for item in manifest["objects"]}.issuperset(
        item.digest for item in _tree().files
    )
    assert not any(item["relative_path"].endswith((".sqlite3", "-wal", "-shm")) for item in manifest["objects"])

    # Destructive drill: original database and CAS disappear before restore.
    for object_row in manifest["objects"]:
        blobs.object_path(object_row["digest"]).unlink()
    database.path.unlink()

    restored_root = tmp_path / "restored"
    restored_db = Database(restored_root / "piton.sqlite3")
    restored_db.migrate()
    pinned_identity = first.trusted_identity.serialize()
    del custody, first
    restored = _custody(restored_db, BlobStore(restored_root)).restore(
        tmp_path / "backup-a", trusted_identity=pinned_identity
    )
    assert restored.project_id == "project_one"
    assert restored.restored_objects == len(manifest["objects"])
    assert restored_db.integrity_check() == ()
    with restored_db.read() as connection:
        assert connection.execute(
            "SELECT revision_id FROM design_revisions"
        ).fetchone()[0] == revision.revision_id
        assert tuple(connection.execute(
            "SELECT revision_id,generation FROM channel_pointers WHERE channel='workspace'"
        ).fetchone()) == (revision.revision_id, 1)
    RevisionRepository(restored_db, BlobStore(restored_root))


def test_restore_rejects_tampering_and_never_partially_publishes(tmp_path: Path):
    source = tmp_path / "source"
    database, blobs, _revision = _seed(source)
    backup = tmp_path / "backup"
    receipt = _custody(database, blobs).backup(
        "project_one", backup, created_at="2026-08-12T12:00:00Z"
    )
    manifest = json.loads((backup / "manifest.json").read_bytes())
    victim = backup / manifest["objects"][0]["relative_path"]
    victim.chmod(0o600)
    victim.write_bytes(b"tampered")

    target = tmp_path / "target"
    target_db = Database(target / "piton.sqlite3")
    target_db.migrate()
    with pytest.raises(BackupValidationError, match="digest|length"):
        _custody(target_db, BlobStore(target)).restore(
            backup, trusted_identity=receipt.trusted_identity
        )
    with target_db.read() as connection:
        assert connection.execute("SELECT count(*) FROM projects").fetchone()[0] == 0
        assert connection.execute("SELECT count(*) FROM artifacts").fetchone()[0] == 0


def test_restore_collision_fails_closed_without_replacing_existing_project(tmp_path: Path):
    source = tmp_path / "source"
    database, blobs, _revision = _seed(source)
    backup = tmp_path / "backup"
    receipt = _custody(database, blobs).backup(
        "project_one", backup, created_at="2026-08-12T12:00:00Z"
    )
    with pytest.raises(BackupValidationError, match="already exists"):
        _custody(database, blobs).restore(
            backup, trusted_identity=receipt.trusted_identity
        )
    with database.read() as connection:
        assert connection.execute("SELECT count(*) FROM projects").fetchone()[0] == 1
        assert connection.execute("SELECT count(*) FROM design_revisions").fetchone()[0] == 1


def test_restore_requires_externally_pinned_manifest_identity_and_rejects_injection(
    tmp_path: Path,
):
    database, blobs, _revision = _seed(tmp_path / "source")
    backup = tmp_path / "backup"
    receipt = _custody(database, blobs).backup(
        "project_one", backup, created_at="2026-08-12T12:00:00Z"
    )
    target = tmp_path / "target"
    target_db = Database(target / "piton.sqlite3")
    target_db.migrate()
    target_custody = _custody(target_db, BlobStore(target))

    assert not hasattr(custody_module, "_issue_backup_identity")
    assert not hasattr(target_custody, "_issue_backup_identity")

    with pytest.raises(TypeError):
        target_custody.restore(backup)

    manifest_path = backup / "manifest.json"
    manifest_path.chmod(0o600)
    manifest = json.loads(manifest_path.read_bytes())
    projects = next(item for item in manifest["metadata"] if item["table"] == "projects")
    injected = dict(projects["rows"][0])
    injected["project_id"] = "project_injected"
    injected["display_name"] = "Injected"
    projects["rows"].append(injected)
    forged_manifest = json.dumps(
        manifest, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    manifest_path.write_bytes(forged_manifest)
    caller_minted_digest = "sha256:" + hashlib.sha256(forged_manifest).hexdigest()

    # A caller-recomputed digest is only a checksum. It cannot mint the
    # daemon-held identity returned through the separate backup receipt.
    with pytest.raises(TypeError, match="trusted_identity"):
        target_custody.restore(backup, trusted_identity=caller_minted_digest)
    forged_identity = json.dumps(
        {"manifest_digest": caller_minted_digest, "project_id": "project_one", "signature": "00" * 32},
        sort_keys=True,
        separators=(",", ":"),
    )
    with pytest.raises(BackupValidationError, match="signature"):
        target_custody.restore(backup, trusted_identity=forged_identity)
    with pytest.raises(BackupValidationError, match="trusted manifest digest"):
        target_custody.restore(backup, trusted_identity=receipt.trusted_identity)
    with target_db.read() as connection:
        assert connection.execute("SELECT count(*) FROM projects").fetchone()[0] == 0
        assert connection.execute("SELECT count(*) FROM design_revisions").fetchone()[0] == 0


def test_backup_signing_authority_cannot_be_supplied_or_invoked_by_a_caller(tmp_path: Path):
    database, blobs, _revision = _seed(tmp_path / "source")

    with pytest.raises(TypeError):
        ProjectCustody(database, blobs, identity_key=secrets.token_bytes(32))
    with pytest.raises(TypeError):
        ProjectCustody(database, blobs, identity_authority=object())

    custody = _custody(database, blobs)
    assert not hasattr(custody, "_ProjectCustody__issue_backup_identity")
    assert not hasattr(custody, "issue_backup_identity")

def test_retention_deletion_tombstones_authority_and_only_prunes_unreferenced_objects(tmp_path: Path):
    database, blobs, revision = _seed(tmp_path / "source")
    custody = _custody(database, blobs)
    orphan = blobs.promote_no_clobber(blobs.stage_stream(
        "orphan", "cache", (b"disposable",), media_type="application/octet-stream", max_bytes=10
    ))
    authoritative = blobs.object_path(_tree().digest)

    preview = custody.apply_retention(RetentionPolicy(keep_unreferenced=False), dry_run=True)
    assert preview.deleted_digests == (orphan.digest,)
    assert blobs.object_path(orphan.digest).exists()
    applied = custody.apply_retention(RetentionPolicy(keep_unreferenced=False), dry_run=False)
    assert applied.deleted_digests == (orphan.digest,)
    assert not blobs.object_path(orphan.digest).exists()
    assert authoritative.exists()

    receipt = custody.delete_project("project_one", reason="operator-requested tombstone")
    assert receipt.project_id == "project_one"
    assert receipt.state == "tombstoned"
    assert receipt.fabrication_release is False
    assert receipt.machine_actuation is False
    with database.read() as connection:
        assert connection.execute(
            "SELECT state FROM projects WHERE project_id='project_one'"
        ).fetchone()[0] == "tombstoned"
        assert connection.execute(
            "SELECT count(*) FROM design_revisions WHERE revision_id=?", (revision.revision_id,)
        ).fetchone()[0] == 1
    assert authoritative.exists()
