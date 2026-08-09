"""Acceptance tests for the pinned, derived exact-realization lane."""
from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path

import pytest
from build123d import import_brep

from piton.parts.l_bracket import DEFAULT_PARAMETERS
from piton.realization import RealizationInputs, realize_exact


ROOT = Path(__file__).resolve().parents[1]


def test_realization_is_attempt_scoped_reproducible_and_inspectable(tmp_path: Path) -> None:
    inputs = RealizationInputs.from_repository(ROOT, DEFAULT_PARAMETERS)

    first = realize_exact(inputs.revision, inputs, tmp_path / "attempt-a")
    second = realize_exact(inputs.revision, inputs, tmp_path / "attempt-b")

    assert first["status"] == "succeeded"
    assert first["revision_id"] == inputs.revision.revision_id
    assert first["input_digests"] == second["input_digests"]
    assert first["artifact_digests"] == second["artifact_digests"]
    assert first["inspection"] == second["inspection"]
    assert set(first["artifact_digests"]) == {"exact_brep", "step"}
    assert first["claim_scopes"] == {
        "exact_brep": "exact_occt_brep_derived_realization",
        "step": "derived_exchange_representation",
    }

    exact_path = tmp_path / "attempt-a" / first["artifacts"]["exact_brep"]
    step_path = tmp_path / "attempt-a" / first["artifacts"]["step"]
    receipt_path = tmp_path / "attempt-a" / "receipt.json"
    assert exact_path.is_file() and step_path.is_file() and receipt_path.is_file()
    assert json.loads(receipt_path.read_text(encoding="utf-8")) == first

    imported = import_brep(exact_path)
    assert imported.is_valid
    assert len(imported.solids()) == first["inspection"]["topology_counts"]["solids"] == 1
    assert first["inspection"]["bounding_box_mm"]["size"] == pytest.approx(
        [120.0, 88.0, 40.0], abs=0.1
    )
    assert first["inspection"]["volume_mm3"] > 0


def test_realization_fails_closed_before_geometry_for_identity_mismatch(tmp_path: Path) -> None:
    inputs = RealizationInputs.from_repository(ROOT, DEFAULT_PARAMETERS)
    invalid_revision = replace(
        inputs.revision,
        source_manifest_digest="sha256:" + "0" * 64,
    )
    attempt_dir = tmp_path / "rejected"

    with pytest.raises(ValueError, match="source_manifest_digest"):
        realize_exact(invalid_revision, inputs, attempt_dir)

    assert not (attempt_dir / "part.brep").exists()
    assert not (attempt_dir / "part.step").exists()


def test_receipt_preserves_review_and_release_truth(tmp_path: Path) -> None:
    inputs = RealizationInputs.from_repository(ROOT, DEFAULT_PARAMETERS)
    receipt = realize_exact(inputs.revision, inputs, tmp_path / "attempt")

    assert receipt["authority"] == {
        "writable_design_authority": "source-native Python",
        "realization_is_derived": True,
    }
    assert receipt["toolchain"] == {
        "python": "3.12.11",
        "build123d": "0.11.1",
        "cadquery-ocp-novtk": "7.9.3.1",
    }
    assert receipt["fabrication_release"] is False
    assert receipt["machine_actuation"] is False
    assert receipt["review_state"] == "needs_human_review"
