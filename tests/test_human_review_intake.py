"""Acceptance tests for framework-only, powerless human-review intake."""
from __future__ import annotations

from dataclasses import FrozenInstanceError, replace
from importlib.resources import files
from pathlib import Path

import json
import pytest
from jsonschema import Draft202012Validator, ValidationError

from piton.human_review import HumanReviewIntake, HumanReviewIntakeError
from piton.storage.db import Database
from integration.test_evidence_closure import prepared


def _closed(tmp_path: Path):
    service, _, _ = prepared(tmp_path / "project")
    request = service.issue_precision_worker_request("project_one", "attempt_one")
    result = service.run_precision_worker(request)
    closure = service.close_precision_worker_evidence(request, result)
    root = (
        tmp_path
        / "project"
        / ".piton"
        / "build-attempts"
        / "project_one"
        / "attempt_one"
    )
    return service, closure, result, root


def _packet_and_intake(tmp_path: Path):
    service, closure, result, _ = _closed(tmp_path)
    packet_root = tmp_path / "packet"
    packet = service.build_precision_review_packet(
        closure.project_id, closure.closure_digest, result, packet_root
    )
    intake = HumanReviewIntake(
        intake_id="review-intake-one",
        project_id=closure.project_id,
        revision_id=closure.revision_id,
        attempt_id=closure.attempt_id,
        evidence_closure_digest=closure.closure_digest,
        review_packet_digest=packet.packet_digest,
        review_scope=("Inspect exact/review geometry correspondence",),
        questions=("Are the source parameters acceptable for the stated intent?",),
    )
    return service, closure, packet, packet_root, intake


def test_typed_intake_is_immutable_canonical_and_requires_review_work(tmp_path: Path) -> None:
    service, closure, packet, packet_root, intake = _packet_and_intake(tmp_path)

    admitted = service.intake_human_review(intake, packet_root)

    assert admitted is intake
    assert admitted.project_id == closure.project_id
    assert admitted.revision_id == closure.revision_id
    assert admitted.attempt_id == closure.attempt_id
    assert admitted.evidence_closure_digest == closure.closure_digest
    assert admitted.review_packet_digest == packet.packet_digest
    assert admitted.review_state == "needs_human_review"
    assert admitted.fabrication_release is False
    assert admitted.machine_actuation is False
    assert admitted.canonical_bytes == intake.canonical_bytes
    with pytest.raises(FrozenInstanceError):
        admitted.project_id = "project_other"  # type: ignore[misc]
    with pytest.raises(ValueError, match="review_scope or questions"):
        replace(intake, review_scope=(), questions=())


def test_typed_intake_matches_packaged_public_schema(tmp_path: Path) -> None:
    _, _, _, _, intake = _packet_and_intake(tmp_path)
    schema = json.loads(
        files("piton")
        .joinpath("schemas", "human-review-intake-v1.schema.json")
        .read_text(encoding="utf-8")
    )
    validator = Draft202012Validator(schema)

    validator.validate(intake.to_primitive())
    unsafe = intake.to_primitive()
    unsafe["fabrication_release"] = True
    with pytest.raises(ValidationError):
        validator.validate(unsafe)


def test_intake_rebinds_every_identity_to_daemon_custody_and_packet_readback(
    tmp_path: Path,
) -> None:
    service, closure, packet, packet_root, intake = _packet_and_intake(tmp_path)

    mismatches = (
        replace(intake, project_id="project_other"),
        replace(intake, revision_id="rev_" + "0" * 64),
        replace(intake, attempt_id="attempt_other"),
        replace(intake, evidence_closure_digest="sha256:" + "0" * 64),
        replace(intake, review_packet_digest="sha256:" + "0" * 64),
    )
    for changed in mismatches:
        with pytest.raises((LookupError, HumanReviewIntakeError)):
            service.intake_human_review(changed, packet_root)

    assert service.intake_human_review(intake, packet_root).review_packet_digest == packet.packet_digest
    assert service.get_evidence_closure(
        closure.project_id, closure.closure_digest
    ).closure_digest == closure.closure_digest


def test_intake_has_no_authored_or_lifecycle_side_effects(tmp_path: Path) -> None:
    service, _, _, packet_root, intake = _packet_and_intake(tmp_path)
    database = Database(tmp_path / "project" / ".piton" / "piton.sqlite3")

    with database.read() as connection:
        before = {
            table: connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
            for table in (
                "design_revisions",
                "channel_pointers",
                "build_attempts",
                "evidence_closures",
                "command_receipts",
            )
        }
    service.intake_human_review(intake, packet_root)
    with database.read() as connection:
        after = {
            table: connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
            for table in before
        }

    assert after == before
    assert intake.review_state == "needs_human_review"
    assert intake.fabrication_release is False
    assert intake.machine_actuation is False
