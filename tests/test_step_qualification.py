"""Acceptance tests for local, named-receiver STEP readback qualification."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import pytest

import piton.qualification as qualification_module
from piton.parts.l_bracket import DEFAULT_PARAMETERS
from piton.qualification import QUALIFICATION_RECEIPT_NAME, qualify_step
from piton.realization import RealizationInputs, realize_exact


ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture()
def realized_attempt(tmp_path: Path) -> tuple[Path, dict[str, Any]]:
    inputs = RealizationInputs.from_repository(ROOT, DEFAULT_PARAMETERS)
    attempt = tmp_path / "attempt-a"
    receipt = realize_exact(inputs.revision, inputs, attempt)
    return attempt, receipt


def _qualification_path(tmp_path: Path, name: str = "evidence") -> Path:
    return tmp_path / name / QUALIFICATION_RECEIPT_NAME


def test_named_receiver_imports_and_publishes_bound_attempt_evidence(
    realized_attempt: tuple[Path, dict[str, Any]], tmp_path: Path
) -> None:
    attempt, realization = realized_attempt
    output = _qualification_path(tmp_path)

    qualification = qualify_step(attempt / "receipt.json", output)

    assert output.is_file()
    assert json.loads(output.read_text(encoding="utf-8")) == qualification
    assert qualification["schema"] == "piton.step-qualification-receipt.v1"
    assert qualification["status"] == "passed"
    assert qualification["revision_id"] == realization["revision_id"]
    assert qualification["attempt_scope"] == realization["attempt_scope"]
    assert qualification["units"] == "mm"
    assert qualification["source_realization"] == {
        "receipt": "receipt.json",
        "receipt_digest": qualification["source_realization"]["receipt_digest"],
        "receipt_schema": "piton.exact-realization-receipt.v1",
        "step": "part.step",
        "step_digest": realization["artifact_digests"]["step"],
    }
    assert qualification["source_realization"]["receipt_digest"].startswith("sha256:")
    assert qualification["receiver"] == {
        "name": "build123d.import_step",
        "version": "build123d@0.11.1",
        "profile": "piton.local-step-readback.v1",
        "geometry_backend": "cadquery-ocp-novtk@7.9.3.1",
    }
    assert qualification["environment"]["python"] == "3.12.11"
    assert qualification["environment"]["isolation_class"] == "trusted-local"
    assert qualification["readback"]["valid"] is True
    assert qualification["readback"]["topology_counts"]["solids"] == 1
    assert qualification["readback"]["topology_counts_claim_scope"].startswith("diagnostic-only")
    for field in ("min", "max", "size"):
        assert qualification["readback"]["bounding_box_mm"][field] == pytest.approx(
            realization["inspection"]["bounding_box_mm"][field], abs=1e-6
        )
    assert qualification["readback"]["volume_mm3"] == pytest.approx(
        realization["inspection"]["volume_mm3"], rel=1e-9, abs=1e-6
    )
    assert qualification["readback"]["area_mm2"] == pytest.approx(
        realization["inspection"]["area_mm2"], rel=1e-9, abs=1e-6
    )
    assert all(item["passed"] for item in qualification["comparisons"].values())
    assert qualification["tolerances"] == qualification_module.TOLERANCES
    assert qualification["warnings"] == []
    assert qualification["evidence_digest"].startswith("sha256:")


def test_qualification_declares_exchange_losses_without_minting_authority(
    realized_attempt: tuple[Path, dict[str, Any]], tmp_path: Path
) -> None:
    attempt, _ = realized_attempt

    qualification = qualify_step(attempt / "receipt.json", _qualification_path(tmp_path))

    assert "named profile only" in qualification["claim_scope"]
    for loss in (
        "source-native Python/build123d history",
        "source parameter editability",
        "semantic feature identity",
        "durable topology identity",
        "review disposition",
        "engineering approval",
        "fabrication release authority",
    ):
        assert loss in qualification["declared_losses"]
    assert qualification["authority"] == {
        "writable_design_authority": "source-native Python",
        "qualification_is_derived_evidence": True,
        "qualification_does_not_promote_build_or_channel": True,
        "qualification_is_not_review_approval_export_or_release": True,
    }
    assert qualification["review_state"] == "needs_human_review"
    assert qualification["fabrication_release"] is False
    assert qualification["machine_actuation"] is False


def test_identical_input_and_profile_produce_equivalent_evidence(
    realized_attempt: tuple[Path, dict[str, Any]], tmp_path: Path
) -> None:
    attempt, _ = realized_attempt

    first = qualify_step(attempt / "receipt.json", _qualification_path(tmp_path, "first"))
    second = qualify_step(attempt / "receipt.json", _qualification_path(tmp_path, "second"))

    assert first == second
    assert first["evidence_digest"] == second["evidence_digest"]
    with pytest.raises(FileExistsError, match="must be new"):
        qualify_step(attempt / "receipt.json", _qualification_path(tmp_path, "first"))
    with pytest.raises(ValueError, match="unsupported STEP receiver profile"):
        qualify_step(
            attempt / "receipt.json",
            _qualification_path(tmp_path, "wrong-profile"),
            receiver_profile="piton.local-step-readback.v999",
        )
    assert not _qualification_path(tmp_path, "wrong-profile").exists()


def test_qualification_fails_closed_on_unbound_or_unsupported_input(
    realized_attempt: tuple[Path, dict[str, Any]], tmp_path: Path
) -> None:
    attempt, _ = realized_attempt
    receipt_path = attempt / "receipt.json"

    (attempt / "part.step").write_bytes(b"not the bound STEP bytes")
    with pytest.raises(ValueError, match="STEP digest"):
        qualify_step(receipt_path, _qualification_path(tmp_path, "digest-mismatch"))
    assert not _qualification_path(tmp_path, "digest-mismatch").exists()

    (attempt / "part.step").unlink()
    with pytest.raises(FileNotFoundError, match="bound STEP must be a regular file"):
        qualify_step(receipt_path, _qualification_path(tmp_path, "missing-step"))

    unsuccessful_dir = tmp_path / "unsuccessful-attempt"
    unsuccessful_dir.mkdir()
    unsuccessful = json.loads(receipt_path.read_text(encoding="utf-8"))
    unsuccessful["status"] = "failed"
    unsuccessful["attempt_scope"] = unsuccessful_dir.name
    unsuccessful_path = unsuccessful_dir / "receipt.json"
    unsuccessful_path.write_text(json.dumps(unsuccessful), encoding="utf-8")
    with pytest.raises(ValueError, match="successful realization"):
        qualify_step(unsuccessful_path, _qualification_path(tmp_path, "unsuccessful"))

    unsupported = json.loads(receipt_path.read_text(encoding="utf-8"))
    unsupported["schema"] = "piton.exact-realization-receipt.v999"
    unsupported_dir = tmp_path / "unsupported-attempt"
    unsupported_dir.mkdir()
    unsupported_path = unsupported_dir / "receipt.json"
    unsupported_path.write_text(json.dumps(unsupported), encoding="utf-8")
    with pytest.raises(ValueError, match="unsupported realization receipt"):
        qualify_step(unsupported_path, _qualification_path(tmp_path, "unsupported"))

    with pytest.raises(FileNotFoundError, match="receipt must be a regular file"):
        qualify_step(tmp_path / "missing.json", _qualification_path(tmp_path, "missing"))
    wrong_name = tmp_path / "wrong-name.json"
    wrong_name.write_text("{}", encoding="utf-8")
    with pytest.raises(ValueError, match="receipt must be named receipt.json"):
        qualify_step(wrong_name, _qualification_path(tmp_path, "wrong-name"))
    with pytest.raises(ValueError, match="outside the immutable realization attempt"):
        qualify_step(receipt_path, attempt / "qualification.json")


def test_malformed_step_receiver_mismatch_and_zero_solid_emit_no_success(
    realized_attempt: tuple[Path, dict[str, Any]], tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    attempt, realization = realized_attempt
    receipt_path = attempt / "receipt.json"

    malformed = b"not a STEP file"
    (attempt / "part.step").write_bytes(malformed)
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    receipt["artifact_digests"]["step"] = "sha256:" + hashlib.sha256(malformed).hexdigest()
    receipt_path.write_text(json.dumps(receipt), encoding="utf-8")
    malformed_output = _qualification_path(tmp_path, "malformed")
    with pytest.raises(RuntimeError, match="could not import|one valid, non-empty solid"):
        qualify_step(receipt_path, malformed_output)
    assert not malformed_output.exists()

    # Restore a supported successful attempt for receiver and shape failures.
    restored = tmp_path / "restored"
    inputs = RealizationInputs.from_repository(ROOT, DEFAULT_PARAMETERS)
    realize_exact(inputs.revision, inputs, restored)
    original_version = qualification_module.importlib.metadata.version
    monkeypatch.setattr(
        qualification_module.importlib.metadata,
        "version",
        lambda name: "0.0.0" if name == "build123d" else original_version(name),
    )
    mismatch_output = _qualification_path(tmp_path, "receiver-mismatch")
    with pytest.raises(RuntimeError, match="environment mismatch"):
        qualify_step(restored / "receipt.json", mismatch_output)
    assert not mismatch_output.exists()

    monkeypatch.setattr(qualification_module.importlib.metadata, "version", original_version)
    invalid_readback = dict(realization["inspection"])
    invalid_readback["valid"] = False
    invalid_readback["topology_counts"] = dict(invalid_readback["topology_counts"])
    invalid_readback["topology_counts"]["solids"] = 0
    invalid_readback["topology_counts_claim_scope"] = "diagnostic-only"
    monkeypatch.setattr(qualification_module, "_inspection", lambda _part: invalid_readback)
    zero_output = _qualification_path(tmp_path, "zero-solid")
    with pytest.raises(RuntimeError, match="one valid, non-empty solid"):
        qualify_step(restored / "receipt.json", zero_output)
    assert not zero_output.exists()


def test_geometric_comparison_failure_emits_no_success_receipt(
    realized_attempt: tuple[Path, dict[str, Any]], tmp_path: Path
) -> None:
    attempt, _ = realized_attempt
    receipt_path = attempt / "receipt.json"
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    receipt["inspection"]["volume_mm3"] += 1.0
    receipt_path.write_text(json.dumps(receipt), encoding="utf-8")
    output = _qualification_path(tmp_path)

    with pytest.raises(RuntimeError, match="changed volume_mm3"):
        qualify_step(receipt_path, output)

    assert not output.exists()
