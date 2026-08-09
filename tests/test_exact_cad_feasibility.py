"""Acceptance and adversarial tests for the exact-CAD feasibility gate."""
from __future__ import annotations

import hashlib
import json
from dataclasses import replace
from pathlib import Path
from typing import Any

import pytest
from build123d import Box, export_brep, export_step

from piton.feasibility import ExactCadFeasibilityDecision, evaluate_exact_cad_feasibility
from piton.parts.l_bracket import DEFAULT_PARAMETERS
from piton.qualification import qualify_step
from piton.realization import RealizationInputs, realize_exact


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
