"""Acceptance and adversarial tests for the exact-CAD feasibility gate."""
from __future__ import annotations

import hashlib
import inspect
import json
import sqlite3
from dataclasses import replace
from pathlib import Path
from typing import Any

import pytest
from build123d import Box, export_brep, export_step

from piton.feasibility import ExactCadFeasibilityDecision, evaluate_exact_cad_feasibility
from piton.parts.l_bracket import DEFAULT_PARAMETERS
from piton.portfolio import (
    Authority,
    Disposition,
    EvidenceArtifact,
    ExecutionStatus,
    Phase,
    PhaseExitReceipt,
    SafetyState,
    issue_phase_exit_receipt,
    receipt_digest,
)
from piton.qualification import qualify_step
from piton.realization import RealizationInputs, realize_exact
from piton.service.application import PitonApplicationService
from piton.storage.db import Database


ROOT = Path(__file__).resolve().parents[1]


def _sha256_file(path: Path) -> str:
    return "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()


def _inspection(part: Any) -> dict[str, Any]:
    bounding_box = part.bounding_box()
    return {
        "valid": bool(part.is_valid),
        "bounding_box_mm": {
            "min": [bounding_box.min.X, bounding_box.min.Y, bounding_box.min.Z],
            "max": [bounding_box.max.X, bounding_box.max.Y, bounding_box.max.Z],
            "size": [bounding_box.size.X, bounding_box.size.Y, bounding_box.size.Z],
        },
        "volume_mm3": float(part.volume),
        "area_mm2": float(part.area),
        "topology_counts": {
            "solids": len(part.solids()),
            "shells": len(part.shells()),
            "faces": len(part.faces()),
            "edges": len(part.edges()),
            "vertices": len(part.vertices()),
        },
    }


@pytest.fixture()
def exact_evidence(tmp_path: Path) -> tuple[RealizationInputs, Path, Path, dict[str, Any]]:
    inputs = RealizationInputs.from_repository(ROOT, DEFAULT_PARAMETERS)
    attempt = tmp_path / "attempt-a"
    realization = realize_exact(inputs.revision, inputs, attempt)
    qualification_path = tmp_path / "qualification" / "qualification.json"
    qualify_step(attempt / "receipt.json", qualification_path)
    return inputs, attempt, qualification_path, realization


def _authorized_p0_receipt(
    *,
    receipt_id: str = "p0-exact-predecessor",
    disposition: Disposition = Disposition.ADVANCE,
) -> PhaseExitReceipt:
    return issue_phase_exit_receipt(
        receipt_id=receipt_id,
        phase=Phase.P0,
        status=ExecutionStatus.COMPLETED,
        disposition=disposition,
        authority=Authority.HUMAN,
        predecessor_receipt_id=None,
        predecessor_receipt_digest=None,
        predicates={},
        evidence=(
            EvidenceArtifact.from_content(
                artifact_id="p0-category-decision",
                repository_path="evidence/p0/category-decision.json",
                content={"category_decision": "proceed_to_exact_cad_feasibility"},
            ),
        ),
        safety=SafetyState(),
    )


def _open_service_with_custodied_p0(
    daemon_root: Path,
    predecessor: PhaseExitReceipt,
    *,
    stored_digest: str | None = None,
) -> tuple[PitonApplicationService, Path]:
    database_path = daemon_root / ".piton" / "piton.sqlite3"
    database = Database(database_path)
    database.migrate()
    receipt_json = json.dumps(
        predecessor.to_dict(), sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    with database.immediate() as connection:
        connection.execute(
            "INSERT INTO portfolio_phase_receipts("
            "receipt_id, phase, authority, receipt_digest, receipt_json, "
            "authenticated_actor_id, authenticated_at) VALUES(?, ?, ?, ?, ?, ?, ?)",
            (
                predecessor.receipt_id,
                predecessor.phase.value,
                predecessor.authority.value,
                stored_digest or receipt_digest(predecessor),
                receipt_json,
                "authenticated-human-reviewer",
                "2026-08-10T00:00:00.000000Z",
            ),
        )
        connection.execute(
            "INSERT INTO portfolio_phase_heads(phase, receipt_id, receipt_digest) "
            "VALUES(?, ?, ?)",
            (
                predecessor.phase.value,
                predecessor.receipt_id,
                stored_digest or receipt_digest(predecessor),
            ),
        )
    return PitonApplicationService.open(daemon_root), database_path


def test_daemon_custody_issuer_derives_and_binds_the_engineering_disposition(
    exact_evidence: tuple[RealizationInputs, Path, Path, dict[str, Any]],
    tmp_path: Path,
) -> None:
    inputs, attempt, qualification_path, _ = exact_evidence
    predecessor = _authorized_p0_receipt()
    service, database_path = _open_service_with_custodied_p0(tmp_path / "daemon", predecessor)

    receipt = service.issue_autonomous_p1_engineering_disposition(
        receipt_id="p1-engineering-disposition",
        predecessor_receipt_id=predecessor.receipt_id,
        revision=inputs.revision,
        realization_receipt_path=attempt / "receipt.json",
        qualification_receipt_path=qualification_path,
    )

    assert receipt.phase is Phase.P1
    assert receipt.status is ExecutionStatus.COMPLETED
    assert receipt.disposition is Disposition.ADVANCE
    assert receipt.authority is Authority.AUTONOMOUS
    assert receipt.predicates == {"exact_cad_verified": True}
    assert receipt.predecessor_receipt_id == predecessor.receipt_id
    assert receipt.predecessor_receipt_digest == receipt_digest(predecessor)
    assert receipt.successor_authorized is True
    assert len(receipt.evidence) == 1
    assert receipt.evidence[0].source.value == "repository_native"
    assert receipt.evidence[0].content["revision_id"] == inputs.revision.revision_id
    assert receipt.evidence[0].content["exact_cad_verified"] is True
    assert receipt.safety == SafetyState()

    with Database(database_path).read() as connection:
        stored = connection.execute(
            "SELECT phase, authority, receipt_digest, authenticated_actor_id "
            "FROM portfolio_phase_receipts WHERE receipt_id=?",
            (receipt.receipt_id,),
        ).fetchone()
        head = connection.execute(
            "SELECT receipt_id, receipt_digest FROM portfolio_phase_heads WHERE phase=?",
            (Phase.P1.value,),
        ).fetchone()
    assert tuple(stored) == (
        Phase.P1.value,
        Authority.AUTONOMOUS.value,
        receipt_digest(receipt),
        "piton-daemon:autonomous-p1",
    )
    assert tuple(head) == (receipt.receipt_id, receipt_digest(receipt))


def test_p1_issuer_accepts_only_a_custodied_reference_not_raw_authority() -> None:
    parameters = inspect.signature(
        PitonApplicationService.issue_autonomous_p1_engineering_disposition
    ).parameters
    assert "predecessor_receipt_id" in parameters
    assert "predecessor" not in parameters
    assert "exact_cad_verified" not in parameters
    assert "predicates" not in parameters
    assert "authority" not in parameters
    assert "safety" not in parameters


def test_structurally_valid_caller_minted_human_p0_receipt_is_rejected(
    exact_evidence: tuple[RealizationInputs, Path, Path, dict[str, Any]],
    tmp_path: Path,
) -> None:
    inputs, attempt, qualification_path, _ = exact_evidence
    caller_minted = _authorized_p0_receipt(receipt_id="caller-minted-human-p0")
    service = PitonApplicationService.open(tmp_path / "uncustodied-daemon")

    with pytest.raises(LookupError, match="current daemon-custodied P0 receipt"):
        service.issue_autonomous_p1_engineering_disposition(
            receipt_id="p1-from-caller-minted-p0",
            predecessor_receipt_id=caller_minted.receipt_id,
            revision=inputs.revision,
            realization_receipt_path=attempt / "receipt.json",
            qualification_receipt_path=qualification_path,
        )

    with pytest.raises(TypeError, match="unexpected keyword argument 'predecessor'"):
        service.issue_autonomous_p1_engineering_disposition(  # type: ignore[call-arg]
            receipt_id="p1-raw-object-attempt",
            predecessor=caller_minted,
            predecessor_receipt_id=caller_minted.receipt_id,
            revision=inputs.revision,
            realization_receipt_path=attempt / "receipt.json",
            qualification_receipt_path=qualification_path,
        )


def test_p1_issuer_rejects_a_custodied_but_noncurrent_p0_head(
    exact_evidence: tuple[RealizationInputs, Path, Path, dict[str, Any]],
    tmp_path: Path,
) -> None:
    inputs, attempt, qualification_path, _ = exact_evidence
    stale = _authorized_p0_receipt(receipt_id="p0-stale")
    service, database_path = _open_service_with_custodied_p0(tmp_path / "daemon", stale)
    current = _authorized_p0_receipt(receipt_id="p0-current")
    current_json = json.dumps(
        current.to_dict(), sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    database = Database(database_path)
    with database.immediate() as connection:
        connection.execute(
            "INSERT INTO portfolio_phase_receipts("
            "receipt_id, phase, authority, receipt_digest, receipt_json, "
            "authenticated_actor_id, authenticated_at) VALUES(?, ?, ?, ?, ?, ?, ?)",
            (
                current.receipt_id,
                current.phase.value,
                current.authority.value,
                receipt_digest(current),
                current_json,
                "authenticated-human-reviewer",
                "2026-08-10T00:01:00.000000Z",
            ),
        )
        connection.execute(
            "UPDATE portfolio_phase_heads SET receipt_id=?, receipt_digest=? WHERE phase=?",
            (current.receipt_id, receipt_digest(current), Phase.P0.value),
        )

    with pytest.raises(LookupError, match="current daemon-custodied P0 receipt"):
        service.issue_autonomous_p1_engineering_disposition(
            receipt_id="p1-from-stale-p0",
            predecessor_receipt_id=stale.receipt_id,
            revision=inputs.revision,
            realization_receipt_path=attempt / "receipt.json",
            qualification_receipt_path=qualification_path,
        )


def test_caller_cannot_bind_an_unselected_custodied_p0_receipt(
    exact_evidence: tuple[RealizationInputs, Path, Path, dict[str, Any]],
    tmp_path: Path,
) -> None:
    inputs, attempt, qualification_path, _ = exact_evidence
    current = _authorized_p0_receipt(receipt_id="current-human-p0")
    service, database_path = _open_service_with_custodied_p0(tmp_path / "daemon", current)
    unselected = _authorized_p0_receipt(receipt_id="unselected-human-p0")
    unselected_json = json.dumps(
        unselected.to_dict(), sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    with Database(database_path).immediate() as connection:
        connection.execute(
            "INSERT INTO portfolio_phase_receipts("
            "receipt_id, phase, authority, receipt_digest, receipt_json, "
            "authenticated_actor_id, authenticated_at) VALUES(?, ?, ?, ?, ?, ?, ?)",
            (
                unselected.receipt_id,
                unselected.phase.value,
                unselected.authority.value,
                receipt_digest(unselected),
                unselected_json,
                "authenticated-human-reviewer",
                "2026-08-10T00:00:00.000000Z",
            ),
        )

    with pytest.raises(LookupError, match="current daemon-custodied P0 receipt"):
        service.issue_autonomous_p1_engineering_disposition(
            receipt_id="p1-from-unselected-p0",
            predecessor_receipt_id=unselected.receipt_id,
            revision=inputs.revision,
            realization_receipt_path=attempt / "receipt.json",
            qualification_receipt_path=qualification_path,
        )


def test_daemon_custody_rejects_non_authorizing_or_digest_mismatched_p0(
    exact_evidence: tuple[RealizationInputs, Path, Path, dict[str, Any]],
    tmp_path: Path,
) -> None:
    inputs, attempt, qualification_path, _ = exact_evidence
    held = _authorized_p0_receipt(receipt_id="p0-held", disposition=Disposition.HOLD)
    held_service, _ = _open_service_with_custodied_p0(tmp_path / "held-daemon", held)
    with pytest.raises(ValueError, match="authorized human P0 predecessor"):
        held_service.issue_autonomous_p1_engineering_disposition(
            receipt_id="p1-held-predecessor",
            predecessor_receipt_id=held.receipt_id,
            revision=inputs.revision,
            realization_receipt_path=attempt / "receipt.json",
            qualification_receipt_path=qualification_path,
        )

    valid = _authorized_p0_receipt(receipt_id="p0-digest-mismatch")
    mismatch_service, _ = _open_service_with_custodied_p0(
        tmp_path / "mismatch-daemon",
        valid,
        stored_digest="sha256:" + "0" * 64,
    )
    with pytest.raises(RuntimeError, match="custodied P0 receipt digest"):
        mismatch_service.issue_autonomous_p1_engineering_disposition(
            receipt_id="p1-digest-mismatch",
            predecessor_receipt_id=valid.receipt_id,
            revision=inputs.revision,
            realization_receipt_path=attempt / "receipt.json",
            qualification_receipt_path=qualification_path,
        )


def test_custodied_phase_receipts_are_immutable(tmp_path: Path) -> None:
    predecessor = _authorized_p0_receipt()
    _, database_path = _open_service_with_custodied_p0(tmp_path / "daemon", predecessor)
    database = Database(database_path)

    for statement in (
        "UPDATE portfolio_phase_receipts SET authority='autonomous'",
        "DELETE FROM portfolio_phase_receipts",
    ):
        with pytest.raises(sqlite3.IntegrityError, match="immutable"):
            with database.immediate() as connection:
                connection.execute(statement)


def test_gate_derives_positive_predicate_from_bound_exact_bytes(
    exact_evidence: tuple[RealizationInputs, Path, Path, dict[str, Any]],
) -> None:
    inputs, attempt, qualification_path, realization = exact_evidence

    decision = evaluate_exact_cad_feasibility(
        inputs.revision,
        attempt / "receipt.json",
        qualification_path,
    )

    assert isinstance(decision, ExactCadFeasibilityDecision)
    assert decision.exact_cad_verified is True
    assert decision.predicates == {"exact_cad_verified": True}
    assert decision.revision_id == inputs.revision.revision_id
    assert decision.attempt_scope == attempt.name
    assert decision.realization_receipt_digest.startswith("sha256:")
    assert decision.qualification_receipt_digest.startswith("sha256:")
    assert decision.artifact_digests == realization["artifact_digests"]
    assert decision.receiver_profile == "piton.local-step-readback.v1"
    assert decision.review_state == "needs_human_review"
    assert decision.fabrication_release is False
    assert decision.machine_actuation is False
    assert "not engineering approval" in decision.claim_scope


def test_gate_rejects_caller_assertions_and_revision_or_attempt_rebinding(
    exact_evidence: tuple[RealizationInputs, Path, Path, dict[str, Any]], tmp_path: Path
) -> None:
    inputs, attempt, qualification_path, _ = exact_evidence

    with pytest.raises(TypeError):
        ExactCadFeasibilityDecision(  # type: ignore[call-arg]
            exact_cad_verified=True,
            revision_id=inputs.revision.revision_id,
            attempt_scope=attempt.name,
            realization_receipt_digest="sha256:" + "0" * 64,
            qualification_receipt_digest="sha256:" + "0" * 64,
            artifact_digests={"exact_brep": "sha256:" + "0" * 64},
            receiver_profile="attacker-asserted",
            fabrication_release=True,
        )

    with pytest.raises(TypeError, match="unexpected keyword"):
        evaluate_exact_cad_feasibility(  # type: ignore[call-arg]
            inputs.revision,
            attempt / "receipt.json",
            qualification_path,
            exact_cad_verified=True,
        )

    wrong_revision = replace(inputs.revision, source_manifest_digest="sha256:" + "0" * 64)
    with pytest.raises(ValueError, match="revision"):
        evaluate_exact_cad_feasibility(
            wrong_revision,
            attempt / "receipt.json",
            qualification_path,
        )

    rebound = tmp_path / "attempt-b"
    rebound.mkdir()
    for name in ("receipt.json", "part.brep", "part.step"):
        (rebound / name).write_bytes((attempt / name).read_bytes())
    with pytest.raises(ValueError, match="attempt_scope"):
        evaluate_exact_cad_feasibility(
            inputs.revision,
            rebound / "receipt.json",
            qualification_path,
        )


def test_gate_rejects_missing_tampered_or_symlinked_artifact_bytes(
    exact_evidence: tuple[RealizationInputs, Path, Path, dict[str, Any]], tmp_path: Path
) -> None:
    inputs, attempt, qualification_path, _ = exact_evidence
    original_brep = (attempt / "part.brep").read_bytes()

    (attempt / "part.brep").write_bytes(b"forged BREP")
    with pytest.raises(ValueError, match="BREP digest"):
        evaluate_exact_cad_feasibility(inputs.revision, attempt / "receipt.json", qualification_path)

    (attempt / "part.brep").unlink()
    with pytest.raises(FileNotFoundError, match="BREP must be a regular file"):
        evaluate_exact_cad_feasibility(inputs.revision, attempt / "receipt.json", qualification_path)
    (attempt / "part.brep").write_bytes(original_brep)

    other = tmp_path / "other.step"
    other.write_bytes(b"not bound")
    (attempt / "part.step").unlink()
    (attempt / "part.step").symlink_to(other)
    with pytest.raises(FileNotFoundError, match="STEP must be a regular file"):
        evaluate_exact_cad_feasibility(inputs.revision, attempt / "receipt.json", qualification_path)


def test_gate_rejects_forged_or_cross_attempt_qualification(
    exact_evidence: tuple[RealizationInputs, Path, Path, dict[str, Any]], tmp_path: Path
) -> None:
    inputs, attempt, qualification_path, _ = exact_evidence
    qualification = json.loads(qualification_path.read_text(encoding="utf-8"))

    qualification["source_realization"]["step_digest"] = "sha256:" + "0" * 64
    qualification_path.write_text(json.dumps(qualification), encoding="utf-8")
    with pytest.raises(ValueError, match="qualification evidence digest"):
        evaluate_exact_cad_feasibility(inputs.revision, attempt / "receipt.json", qualification_path)

    # Even a self-consistent, attacker-rehashed receipt cannot bind another attempt.
    inputs_b = RealizationInputs.from_repository(ROOT, DEFAULT_PARAMETERS)
    attempt_b = tmp_path / "attempt-b"
    realize_exact(inputs_b.revision, inputs_b, attempt_b)
    qualification_b = tmp_path / "qualification-b" / "qualification.json"
    qualify_step(attempt_b / "receipt.json", qualification_b)
    with pytest.raises(ValueError, match="attempt_scope"):
        evaluate_exact_cad_feasibility(inputs.revision, attempt / "receipt.json", qualification_b)


def test_gate_rejects_safety_promotion_even_when_receipt_is_rehashed(
    exact_evidence: tuple[RealizationInputs, Path, Path, dict[str, Any]],
) -> None:
    inputs, attempt, qualification_path, _ = exact_evidence
    qualification = json.loads(qualification_path.read_text(encoding="utf-8"))
    qualification["fabrication_release"] = True
    qualification.pop("evidence_digest")
    canonical = json.dumps(
        qualification, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False
    ).encode("utf-8")
    qualification["evidence_digest"] = "sha256:" + hashlib.sha256(
        b"piton.step-qualification-receipt.v1\0" + canonical
    ).hexdigest()
    qualification_path.write_text(json.dumps(qualification), encoding="utf-8")

    with pytest.raises(ValueError, match="safety boundary"):
        evaluate_exact_cad_feasibility(inputs.revision, attempt / "receipt.json", qualification_path)


def test_gate_rejects_self_consistent_forged_geometry_for_a_real_revision(
    exact_evidence: tuple[RealizationInputs, Path, Path, dict[str, Any]],
) -> None:
    inputs, attempt, qualification_path, _ = exact_evidence
    forged_part = Box(10, 11, 12)
    assert export_brep(forged_part, attempt / "part.brep") is True
    assert export_step(
        forged_part,
        attempt / "part.step",
        timestamp="1970-01-01T00:00:00+00:00",
    ) is True

    receipt_path = attempt / "receipt.json"
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    receipt["artifact_digests"] = {
        "exact_brep": _sha256_file(attempt / "part.brep"),
        "step": _sha256_file(attempt / "part.step"),
    }
    receipt["inspection"] = _inspection(forged_part)
    receipt_path.write_text(json.dumps(receipt, sort_keys=True), encoding="utf-8")

    qualification_path.unlink()
    qualify_step(receipt_path, qualification_path)

    with pytest.raises(ValueError, match="source-native geometry"):
        evaluate_exact_cad_feasibility(inputs.revision, receipt_path, qualification_path)
