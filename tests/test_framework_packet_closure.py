"""Acceptance tests for powerless framework-packet closure."""
from __future__ import annotations

from dataclasses import FrozenInstanceError, replace
from importlib.resources import files
import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator, ValidationError

from piton import FrameworkPacketClosure
from piton.human_review import FrameworkPacketClosureError
from piton.storage.db import Database
from integration.test_evidence_closure import prepared


def _closed(tmp_path: Path):
    service, _, _ = prepared(tmp_path / "project")
    request = service.issue_precision_worker_request("project_one", "attempt_one")
    result = service.run_precision_worker(request)
    evidence = service.close_precision_worker_evidence(request, result)
    packet_root = tmp_path / "packet"
    packet = service.build_precision_review_packet(
        evidence.project_id, evidence.closure_digest, result, packet_root
    )
    closure = FrameworkPacketClosure(
        closure_id="framework-packet-closure-one",
        project_id=evidence.project_id,
        revision_id=evidence.revision_id,
        attempt_id=evidence.attempt_id,
        evidence_closure_digest=evidence.closure_digest,
        review_packet_digest=packet.packet_digest,
        worker_result_digest=packet.worker_result_digest,
        declaration_digest=packet.declaration_digest,
        generation=packet.generation,
        fence=packet.fence,
        lease_id=packet.lease_id,
        exact_brep_digest=packet.artifacts["exact_brep"]["digest"],
        step_digest=packet.artifacts["step"]["digest"],
        review_glb_digest=packet.artifacts["review_glb"]["digest"],
        review_selection_map_digest=packet.artifacts["review_selection_map"]["digest"],
    )
    return service, evidence, packet, packet_root, closure


def test_closure_is_immutable_canonical_strict_and_powerless(tmp_path: Path) -> None:
    service, _, _, packet_root, closure = _closed(tmp_path)

    closed = service.close_framework_packet(closure, packet_root)

    assert closed is closure
    assert json.loads(closed.canonical_bytes) == closed.to_primitive()
    assert closed.review_state == "needs_human_review"
    assert closed.fabrication_release is False
    assert closed.machine_actuation is False
    assert closed.release_state == "unreleased"
    assert closed.channel_transition is False
    with pytest.raises(FrozenInstanceError):
        closed.project_id = "project_other"  # type: ignore[misc]

    schema = json.loads(
        files("piton")
        .joinpath("schemas", "framework-packet-closure-v1.schema.json")
        .read_text(encoding="utf-8")
    )
    validator = Draft202012Validator(schema)
    validator.validate(closed.to_primitive())
    with pytest.raises(ValidationError):
        validator.validate({**closed.to_primitive(), "review_accepted": True})


@pytest.mark.parametrize(
    ("field", "value"),
    (
        ("review_state", "accepted"),
        ("fabrication_release", True),
        ("machine_actuation", True),
        ("release_state", "released"),
        ("channel_transition", True),
    ),
)
def test_closure_constructor_rejects_forbidden_consequences(
    tmp_path: Path, field: str, value: object
) -> None:
    _, _, _, _, closure = _closed(tmp_path)
    with pytest.raises(ValueError, match="root truth boundary"):
        replace(closure, **{field: value})


def test_service_rebinds_every_identity_and_artifact_claim(tmp_path: Path) -> None:
    service, _, _, packet_root, closure = _closed(tmp_path)
    digest = "sha256:" + "0" * 64
    mismatches = (
        replace(closure, project_id="project_other"),
        replace(closure, revision_id="rev_" + "0" * 64),
        replace(closure, attempt_id="attempt_other"),
        replace(closure, evidence_closure_digest=digest),
        replace(closure, review_packet_digest=digest),
        replace(closure, worker_result_digest=digest),
        replace(closure, declaration_digest=digest),
        replace(closure, generation=closure.generation + 1),
        replace(closure, fence=closure.fence + 1),
        replace(closure, lease_id="lease_other"),
        replace(closure, exact_brep_digest=digest),
        replace(closure, step_digest=digest),
        replace(closure, review_glb_digest=digest),
        replace(closure, review_selection_map_digest=digest),
    )
    for changed in mismatches:
        with pytest.raises((LookupError, FrameworkPacketClosureError)):
            service.close_framework_packet(changed, packet_root)


def test_closure_has_no_durable_or_packet_side_effects(tmp_path: Path) -> None:
    service, _, _, packet_root, closure = _closed(tmp_path)
    database = Database(tmp_path / "project" / ".piton" / "piton.sqlite3")
    packet_before = {
        path.relative_to(packet_root).as_posix(): path.read_bytes()
        for path in packet_root.rglob("*")
        if path.is_file()
    }
    with database.read() as connection:
        before = {
            row[0]: connection.execute(f'SELECT count(*) FROM "{row[0]}"').fetchone()[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            )
        }

    service.close_framework_packet(closure, packet_root)

    with database.read() as connection:
        after = {
            table: connection.execute(f'SELECT count(*) FROM "{table}"').fetchone()[0]
            for table in before
        }
    packet_after = {
        path.relative_to(packet_root).as_posix(): path.read_bytes()
        for path in packet_root.rglob("*")
        if path.is_file()
    }
    assert after == before
    assert packet_after == packet_before
