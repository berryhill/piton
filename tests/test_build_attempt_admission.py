"""Acceptance coverage for durable build-attempt admission and coordinator state."""

from __future__ import annotations

import sqlite3
import uuid
from dataclasses import fields, replace
from pathlib import Path
from typing import Iterator

import pytest

from piton.service.application import PitonApplicationService, _issue_principal_context
from piton.service.commands import CreateProject, ImportSourceBase
from piton.source_tree import SourceTree, SourceTreeFile
from piton.storage.build_attempts import (
    AdmissionAuthorityError,
    AdmissionCapability,
    BuildAdmission,
    BuildAttemptConflictError,
    BuildAttemptCoordinator,
    _issue_server_admission_capability,
)
from piton.storage.db import Database

DIGEST = "sha256:" + "1" * 64


def source_tree() -> SourceTree:
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


def prepared_project(root: Path, project_id: str = "project_one") -> tuple[Database, str]:
    service = PitonApplicationService.open(root)
    context = _issue_principal_context("operator_one")
    service.create_project(CreateProject("cmd_create", project_id, "One"), context)
    receipt = service.import_source_base(
        ImportSourceBase("cmd_import", project_id, source_tree(), {"height": "10 mm"}), context
    )
    assert receipt.persisted_revision_id is not None
    return Database(root / ".piton" / "piton.sqlite3"), receipt.persisted_revision_id


def admission(revision_id: str) -> BuildAdmission:
    return BuildAdmission(
        project_id="project_one",
        revision_id=revision_id,
        input_manifest_digest=DIGEST,
        recipe_digest=DIGEST,
        toolchain_digest=DIGEST,
        capability_manifest_digest=DIGEST,
        resource_limits_digest=DIGEST,
        expected_outputs_digest=DIGEST,
        request_signature_digest=DIGEST,
        worker_id="precision_worker_one",
        isolation_class="container",
    )


def coordinator(database: Database, *attempt_ids: str) -> BuildAttemptCoordinator:
    identities: Iterator[str] = iter(attempt_ids or ("attempt_one",))
    return BuildAttemptCoordinator(database, attempt_id_factory=lambda: next(identities))


def admit(
    attempt_coordinator: BuildAttemptCoordinator,
    request: BuildAdmission,
    *,
    dispatch=None,
):
    return attempt_coordinator.admit(
        request,
        capability=_issue_server_admission_capability(),
        dispatch=dispatch,
    )


def test_fresh_migration_creates_strict_attempt_and_coordinator_custody(tmp_path: Path) -> None:
    database = Database(tmp_path / "piton.sqlite3")
    database.migrate()

    with database.read() as connection:
        tables = {
            row[0]: row[1]
            for row in connection.execute(
                "SELECT name, sql FROM sqlite_master WHERE type='table' "
                "AND name IN ('build_attempts','build_coordinator_state')"
            )
        }
        foreign_keys = {
            table: {tuple(row) for row in connection.execute(f"PRAGMA foreign_key_list({table})")}
            for table in tables
        }

    assert set(tables) == {"build_attempts", "build_coordinator_state"}
    assert all(sql.rstrip().endswith("STRICT") for sql in tables.values())
    assert any(row[2] == "design_revisions" for row in foreign_keys["build_attempts"])
    assert any(row[2] == "projects" for row in foreign_keys["build_attempts"])
    assert any(row[2] == "build_attempts" for row in foreign_keys["build_coordinator_state"])


def test_admission_is_durable_before_dispatch_and_survives_reopen(tmp_path: Path) -> None:
    database, revision_id = prepared_project(tmp_path)
    observed: list[tuple[int, int, str, int, int]] = []

    def dispatch(record) -> None:
        reopened = Database(database.path)
        with reopened.read() as connection:
            attempt_count = connection.execute(
                "SELECT count(*) FROM build_attempts WHERE attempt_id=?", (record.attempt_id,)
            ).fetchone()[0]
            state = connection.execute(
                "SELECT state, generation, fence FROM build_coordinator_state WHERE attempt_id=?",
                (record.attempt_id,),
            ).fetchone()
        observed.append((attempt_count, len(state), state[0], state[1], state[2]))

    admitted = admit(coordinator(database), admission(revision_id), dispatch=dispatch)

    assert admitted.project_id == "project_one"
    assert admitted.revision_id == revision_id
    assert observed == [(1, 3, "admitted", 0, 0)]
    assert BuildAttemptCoordinator(Database(database.path)).get_state(
        "project_one", "attempt_one"
    ).state == "admitted"


def test_invalid_project_revision_pair_and_dispatch_failure_fail_closed(tmp_path: Path) -> None:
    database, revision_id = prepared_project(tmp_path)
    with database.immediate() as connection:
        connection.execute(
            "INSERT INTO projects(project_id, display_name, format_version, state, created_at) "
            "VALUES('project_two','Two',1,'active','2026-01-01T00:00:00Z')"
        )

    attempt_coordinator = coordinator(database, "attempt_invalid", "attempt_one")
    with pytest.raises(ValueError, match="exact project"):
        admit(attempt_coordinator, replace(admission(revision_id), project_id="project_two"))

    def fail_dispatch(_record) -> None:
        raise RuntimeError("dispatch unavailable")

    with pytest.raises(RuntimeError, match="dispatch unavailable"):
        admit(attempt_coordinator, admission(revision_id), dispatch=fail_dispatch)
    assert BuildAttemptCoordinator(Database(database.path)).get_state(
        "project_one", "attempt_one"
    ).state == "admitted"


def test_attempts_are_immutable_and_retry_requires_a_new_identity(tmp_path: Path) -> None:
    database, revision_id = prepared_project(tmp_path)
    attempt_coordinator = coordinator(database, "attempt_one", "attempt_one", "attempt_two")
    admit(attempt_coordinator, admission(revision_id))

    for statement in (
        "UPDATE build_attempts SET worker_id='changed' WHERE attempt_id='attempt_one'",
        "DELETE FROM build_attempts WHERE attempt_id='attempt_one'",
    ):
        with pytest.raises(sqlite3.IntegrityError, match="immutable"):
            with database.immediate() as connection:
                connection.execute(statement)

    with pytest.raises(BuildAttemptConflictError):
        admit(attempt_coordinator, admission(revision_id))
    retry = admit(attempt_coordinator, admission(revision_id))
    assert retry.attempt_id == "attempt_two"


def test_insert_or_replace_cannot_bypass_immutable_attempt_custody(tmp_path: Path) -> None:
    database, revision_id = prepared_project(tmp_path)
    admit(coordinator(database), admission(revision_id))

    with pytest.raises(sqlite3.IntegrityError, match="immutable"):
        with database.immediate() as connection:
            connection.execute(
                "INSERT OR REPLACE INTO build_attempts SELECT * FROM build_attempts "
                "WHERE attempt_id='attempt_one'"
            )

    assert coordinator(database).get_attempt("project_one", "attempt_one").worker_id == (
        "precision_worker_one"
    )


def test_attempt_identity_is_coordinator_derived_and_defaults_to_uuid(tmp_path: Path) -> None:
    database, revision_id = prepared_project(tmp_path)

    assert "attempt_id" not in {field.name for field in fields(BuildAdmission)}
    deterministic = admit(coordinator(database, "server_attempt"), admission(revision_id))
    assert deterministic.attempt_id == "server_attempt"

    generated = admit(BuildAttemptCoordinator(database), admission(revision_id))
    assert str(uuid.UUID(generated.attempt_id)) == generated.attempt_id


def test_admission_requires_unforgeable_server_capability_before_dispatch(tmp_path: Path) -> None:
    database, revision_id = prepared_project(tmp_path)
    request = admission(revision_id)
    attempt_coordinator = coordinator(database)
    dispatched = []

    with pytest.raises(TypeError):
        attempt_coordinator.admit(request, dispatch=dispatched.append)
    with pytest.raises(AdmissionAuthorityError):
        AdmissionCapability()
    forged = object.__new__(AdmissionCapability)
    with pytest.raises(AdmissionAuthorityError, match="server-issued"):
        attempt_coordinator.admit(request, capability=forged, dispatch=dispatched.append)

    with database.read() as connection:
        assert connection.execute("SELECT count(*) FROM build_attempts").fetchone()[0] == 0
    assert dispatched == []


def test_attempt_and_state_reads_require_exact_project_scope(tmp_path: Path) -> None:
    database, revision_id = prepared_project(tmp_path)
    with database.immediate() as connection:
        connection.execute(
            "INSERT INTO projects(project_id, display_name, format_version, state, created_at) "
            "VALUES('project_two','Two',1,'active','2026-01-01T00:00:00Z')"
        )
    attempt_coordinator = coordinator(database)
    admit(attempt_coordinator, admission(revision_id))

    assert attempt_coordinator.get_attempt("project_one", "attempt_one").attempt_id == "attempt_one"
    assert attempt_coordinator.get_state("project_one", "attempt_one").state == "admitted"
    with pytest.raises(LookupError):
        attempt_coordinator.get_attempt("project_two", "attempt_one")
    with pytest.raises(LookupError):
        attempt_coordinator.get_state("project_two", "attempt_one")


def test_schema_rejects_open_states_negative_counters_and_cross_project_pairs(tmp_path: Path) -> None:
    database, revision_id = prepared_project(tmp_path)
    admit(coordinator(database), admission(revision_id))

    bad_statements = (
        "UPDATE build_coordinator_state SET state='approved' WHERE attempt_id='attempt_one'",
        "UPDATE build_coordinator_state SET generation=-1 WHERE attempt_id='attempt_one'",
        "UPDATE build_coordinator_state SET fence=-1 WHERE attempt_id='attempt_one'",
    )
    for statement in bad_statements:
        with pytest.raises(sqlite3.IntegrityError):
            with database.immediate() as connection:
                connection.execute(statement)


@pytest.mark.parametrize(
    "column",
    (
        "input_manifest_digest",
        "recipe_digest",
        "toolchain_digest",
        "capability_manifest_digest",
        "resource_limits_digest",
        "expected_outputs_digest",
        "request_signature_digest",
    ),
)
def test_direct_sql_rejects_non_lowercase_sha256_digests(
    tmp_path: Path, column: str
) -> None:
    database, revision_id = prepared_project(tmp_path)
    admit(coordinator(database), admission(revision_id))

    columns = (
        "attempt_id",
        "project_id",
        "revision_id",
        "input_manifest_digest",
        "recipe_digest",
        "toolchain_digest",
        "capability_manifest_digest",
        "resource_limits_digest",
        "expected_outputs_digest",
        "request_signature_digest",
        "worker_id",
        "isolation_class",
        "admission_state",
        "admitted_at",
    )
    with database.read() as connection:
        original = list(
            connection.execute(
                f"SELECT {', '.join(columns)} FROM build_attempts WHERE attempt_id='attempt_one'"
            ).fetchone()
        )

    for counter, invalid_digest in enumerate(("sha256:" + "A" * 64, "sha256:" + "g" * 64)):
        values = original.copy()
        values[0] = f"bad_digest_{column}_{counter}"
        values[columns.index(column)] = invalid_digest
        with pytest.raises(sqlite3.IntegrityError):
            with database.immediate() as connection:
                connection.execute(
                    f"INSERT INTO build_attempts VALUES({', '.join('?' for _ in columns)})",
                    values,
                )


def test_direct_sql_rejects_cross_project_revision_foreign_key(tmp_path: Path) -> None:
    database, revision_id = prepared_project(tmp_path)
    admit(coordinator(database), admission(revision_id))
    with database.immediate() as connection:
        connection.execute(
            "INSERT INTO projects(project_id, display_name, format_version, state, created_at) "
            "VALUES('project_two','Two',1,'active','2026-01-01T00:00:00Z')"
        )

    with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):
        with database.immediate() as connection:
            connection.execute(
                "INSERT INTO build_attempts "
                "SELECT 'cross_project_attempt', 'project_two', revision_id, input_manifest_digest, "
                "recipe_digest, toolchain_digest, capability_manifest_digest, resource_limits_digest, "
                "expected_outputs_digest, request_signature_digest, worker_id, isolation_class, "
                "admission_state, admitted_at FROM build_attempts WHERE attempt_id='attempt_one'"
            )


def test_repository_proof_tracks_build_attempt_assets_and_uses_pytest() -> None:
    root = Path(__file__).resolve().parents[1]
    verifier = (root / "scripts" / "verify_repo.py").read_text(encoding="utf-8")
    readme = (root / "README.md").read_text(encoding="utf-8")

    for required_path in (
        "src/piton/storage/build_attempts.py",
        "src/piton/storage/migrations/0005_durable_build_attempts.sql",
        "tests/test_build_attempt_admission.py",
    ):
        assert required_path in verifier
    assert '"-m", "pytest"' in verifier
    assert "uv run --frozen python -m pytest" in readme
    assert "unittest discover" not in readme


def test_install_verifier_exercises_public_api_and_fresh_schema() -> None:
    root = Path(__file__).resolve().parents[1]
    verifier = (root / "scripts" / "install_verify.py").read_text(encoding="utf-8")
    architecture = (root / "docs" / "architecture.md").read_text(encoding="utf-8")

    assert "BuildAttemptCoordinator" in verifier
    assert "Database" in verifier
    assert "build_attempts" in verifier
    assert "build_coordinator_state" in verifier
    assert "Durable build admission and coordinator state" in architecture
    assert "fabrication_release" in architecture
    assert "machine_actuation" in architecture
