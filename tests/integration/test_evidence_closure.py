"""Integration acceptance for daemon-owned deterministic evidence closure."""

from __future__ import annotations

import json
import sqlite3
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path

import pytest

from piton.evidence import EvidenceClosureError, PREDECLARED_CHECKS
from piton.parts.l_bracket import DEFAULT_PARAMETERS
from piton.precision_worker import (
    EXPECTED_OUTPUTS_DIGEST,
    PINNED_CAPABILITY_DIGEST,
    PINNED_RECIPE_DIGEST,
    PINNED_RESOURCE_LIMITS_DIGEST,
    PINNED_TOOLCHAIN_DIGEST,
    PRECISION_WORKER_ID,
)
from piton.realization import RealizationInputs
from piton.service.application import PitonApplicationService
from piton.storage.build_attempts import (
    BuildAdmission,
    BuildAttemptCoordinator,
    _issue_server_admission_capability,
)
from piton.storage.db import Database

ROOT = Path(__file__).resolve().parents[2]
DIGEST = "sha256:" + "7" * 64


def prepared(tmp_path: Path, *, precision_clock=None):
    inputs = RealizationInputs.from_repository(ROOT, DEFAULT_PARAMETERS)
    service = PitonApplicationService.open(
        tmp_path,
        precision_inputs=lambda project_id, revision_id, manifest_digest: inputs,
        precision_clock=precision_clock
        or (lambda: datetime(2026, 8, 10, 0, 30, tzinfo=UTC)),
    )
    database = Database(tmp_path / ".piton" / "piton.sqlite3")
    now = "2026-08-10T00:00:00Z"
    manifest_digest = "sha256:" + "8" * 64
    with database.immediate() as connection:
        connection.execute(
            "INSERT INTO projects(project_id,display_name,format_version,state,created_at) "
            "VALUES('project_one','One',1,'active',?)",
            (now,),
        )
        for digest, relpath in (
            (manifest_digest, "objects/seed/manifest"),
            (inputs.revision.source_manifest_digest, "objects/seed/source"),
        ):
            connection.execute(
                "INSERT INTO artifacts(digest,media_type,byte_length,storage_relpath,created_at,verified_at) "
                "VALUES(?, 'application/json', 1, ?, ?, ?)",
                (digest, relpath, now, now),
            )
        connection.execute(
            "INSERT INTO design_revisions(revision_id,project_id,parent_revision_id,proposal_id,"
            "manifest_digest,source_manifest_digest,authority_profile,created_at) "
            "VALUES(?, 'project_one', NULL, NULL, ?, ?, 'source-native/v0', ?)",
            (
                inputs.revision.revision_id,
                manifest_digest,
                inputs.revision.source_manifest_digest,
                now,
            ),
        )
        for channel in ("workspace", "candidate", "review", "last_good"):
            connection.execute(
                "INSERT INTO channel_pointers(project_id,channel,revision_id,generation,updated_at) "
                "VALUES('project_one', ?, ?, 0, ?)",
                (channel, inputs.revision.revision_id, now),
            )
    coordinator = BuildAttemptCoordinator(
        database, attempt_id_factory=lambda: "attempt_one"
    )
    coordinator.admit(
        BuildAdmission(
            project_id="project_one",
            revision_id=inputs.revision.revision_id,
            input_manifest_digest=inputs.revision.source_manifest_digest,
            recipe_digest=PINNED_RECIPE_DIGEST,
            toolchain_digest=PINNED_TOOLCHAIN_DIGEST,
            capability_manifest_digest=PINNED_CAPABILITY_DIGEST,
            resource_limits_digest=PINNED_RESOURCE_LIMITS_DIGEST,
            expected_outputs_digest=EXPECTED_OUTPUTS_DIGEST,
            request_signature_digest=DIGEST,
            worker_id=PRECISION_WORKER_ID,
            isolation_class="trusted-local",
        ),
        capability=_issue_server_admission_capability(),
    )
    with database.immediate() as connection:
        connection.execute(
            "UPDATE build_coordinator_state SET state='running', generation=2, fence=5, "
            "lease_id='lease_one', lease_expires_at='2026-08-10T01:00:00Z', updated_at=? "
            "WHERE attempt_id='attempt_one'",
            (now,),
        )
    return service, database, inputs


def test_closure_is_predeclared_atomic_deterministic_and_project_scoped(
    tmp_path: Path,
) -> None:
    service, database, inputs = prepared(tmp_path)
    request = service.issue_precision_worker_request("project_one", "attempt_one")
    with database.read() as connection:
        declaration = connection.execute(
            "SELECT declaration_digest, canonical_json FROM evidence_check_declarations "
            "WHERE attempt_id='attempt_one'"
        ).fetchone()
    assert declaration is not None
    assert len(json.loads(declaration["canonical_json"])["checks"]) == 3

    result = service.run_precision_worker(request)
    closure = service.close_precision_worker_evidence(request, result)
    replay = service.close_precision_worker_evidence(request, result)
    readback = service.get_evidence_closure("project_one", closure.closure_digest)

    assert replay.canonical_bytes == closure.canonical_bytes == readback.canonical_bytes
    assert tuple(item.check_id for item in readback.receipts) == tuple(
        item.check_id for item in PREDECLARED_CHECKS
    )
    assert all(item.status == "pass" for item in readback.receipts)
    assert readback.worker_result_digest == result.result_digest
    assert readback.revision_id == inputs.revision.revision_id
    assert readback.review_state == "needs_human_review"
    assert readback.fabrication_release is False
    assert readback.machine_actuation is False
    assert readback.artifacts["review_glb"]["claim_scope"] == "review-only"
    assert readback.artifacts["exact_brep"]["claim_scope"].startswith("exact_")
    with pytest.raises(LookupError):
        service.get_evidence_closure("project_two", closure.closure_digest)

    with database.read() as connection:
        assert (
            connection.execute("SELECT count(*) FROM evidence_closures").fetchone()[0]
            == 1
        )
        assert (
            connection.execute(
                "SELECT count(*) FROM evidence_check_receipts"
            ).fetchone()[0]
            == 3
        )
        assert (
            connection.execute(
                "SELECT state FROM build_coordinator_state WHERE attempt_id='attempt_one'"
            ).fetchone()[0]
            == "succeeded"
        )
        channels = connection.execute(
            "SELECT channel,revision_id,generation FROM channel_pointers ORDER BY channel"
        ).fetchall()
    assert all(tuple(row)[1:] == (inputs.revision.revision_id, 0) for row in channels)
    for statement in (
        "UPDATE evidence_closures SET review_state='needs_human_review'",
        "DELETE FROM evidence_check_receipts",
        "INSERT OR REPLACE INTO evidence_closures SELECT * FROM evidence_closures",
    ):
        with pytest.raises(sqlite3.IntegrityError, match="immutable"):
            with database.immediate() as connection:
                connection.execute(statement)


def test_stale_or_failed_result_publishes_no_closure_and_retains_declaration(
    tmp_path: Path,
) -> None:
    service, database, _ = prepared(tmp_path)
    request = service.issue_precision_worker_request("project_one", "attempt_one")
    result = service.run_precision_worker(request)
    stale = replace(result, fence=result.fence + 1)

    with pytest.raises(
        (ValueError, EvidenceClosureError), match="binding|request|custody"
    ):
        service.close_precision_worker_evidence(request, stale)

    with database.read() as connection:
        assert (
            connection.execute("SELECT count(*) FROM evidence_closures").fetchone()[0]
            == 0
        )
        assert (
            connection.execute(
                "SELECT count(*) FROM evidence_check_receipts"
            ).fetchone()[0]
            == 0
        )
        assert (
            connection.execute(
                "SELECT count(*) FROM evidence_check_declarations"
            ).fetchone()[0]
            == 1
        )
        assert (
            connection.execute(
                "SELECT state FROM build_coordinator_state WHERE attempt_id='attempt_one'"
            ).fetchone()[0]
            == "running"
        )


def test_lease_expiry_during_checks_publishes_no_evidence_or_state_change(
    tmp_path: Path,
) -> None:
    clock_calls = 0

    def clock() -> datetime:
        nonlocal clock_calls
        clock_calls += 1
        if clock_calls <= 3:
            return datetime(2026, 8, 10, 0, 30, tzinfo=UTC)
        return datetime(2026, 8, 10, 1, 0, tzinfo=UTC)

    service, database, inputs = prepared(tmp_path, precision_clock=clock)
    request = service.issue_precision_worker_request("project_one", "attempt_one")
    result = service.run_precision_worker(request)

    with pytest.raises(EvidenceClosureError, match="lease.*expired"):
        service.close_precision_worker_evidence(request, result)

    with database.read() as connection:
        assert connection.execute("SELECT count(*) FROM evidence_closures").fetchone()[0] == 0
        assert (
            connection.execute("SELECT count(*) FROM evidence_check_receipts").fetchone()[0]
            == 0
        )
        assert (
            connection.execute("SELECT count(*) FROM evidence_closure_artifacts").fetchone()[0]
            == 0
        )
        assert connection.execute("SELECT count(*) FROM artifacts").fetchone()[0] == 2
        assert tuple(
            connection.execute(
                "SELECT state,lease_id,lease_expires_at FROM build_coordinator_state "
                "WHERE attempt_id='attempt_one'"
            ).fetchone()
        ) == ("running", "lease_one", "2026-08-10T01:00:00Z")
        channels = connection.execute(
            "SELECT revision_id,generation FROM channel_pointers"
        ).fetchall()
    assert all(tuple(row) == (inputs.revision.revision_id, 0) for row in channels)


def test_closure_transaction_failure_rolls_back_all_metadata_and_preserves_channels(
    tmp_path: Path,
) -> None:
    service, database, inputs = prepared(tmp_path)
    request = service.issue_precision_worker_request("project_one", "attempt_one")
    result = service.run_precision_worker(request)
    with database.read() as connection:
        artifact_count = connection.execute(
            "SELECT count(*) FROM artifacts"
        ).fetchone()[0]
    with database.immediate() as connection:
        connection.execute(
            "CREATE TRIGGER injected_receipt_failure BEFORE INSERT ON evidence_check_receipts "
            "BEGIN SELECT RAISE(ABORT, 'injected receipt failure'); END"
        )

    with pytest.raises(sqlite3.IntegrityError, match="injected receipt failure"):
        service.close_precision_worker_evidence(request, result)

    with database.read() as connection:
        assert (
            connection.execute("SELECT count(*) FROM evidence_closures").fetchone()[0]
            == 0
        )
        assert (
            connection.execute(
                "SELECT count(*) FROM evidence_check_receipts"
            ).fetchone()[0]
            == 0
        )
        assert (
            connection.execute(
                "SELECT count(*) FROM evidence_closure_artifacts"
            ).fetchone()[0]
            == 0
        )
        assert (
            connection.execute("SELECT count(*) FROM artifacts").fetchone()[0]
            == artifact_count
        )
        assert (
            connection.execute(
                "SELECT state FROM build_coordinator_state WHERE attempt_id='attempt_one'"
            ).fetchone()[0]
            == "running"
        )
        channels = connection.execute(
            "SELECT revision_id,generation FROM channel_pointers"
        ).fetchall()
    assert all(tuple(row) == (inputs.revision.revision_id, 0) for row in channels)
