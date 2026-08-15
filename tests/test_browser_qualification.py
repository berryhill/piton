"""Acceptance tests for fail-closed, derived browser qualification evidence."""
from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path

import pytest

from piton import browser_qualification as browser_qualification_module
from piton.browser_qualification import (
    PERFORMANCE_BUDGETS,
    REQUIRED_GOLDEN_PATH_STEPS,
    SUPPORTED_ENVIRONMENT,
    BrowserQualificationError,
    qualify_browser_observation,
    validate_browser_qualification,
)
from piton.review_packet import build_review_packet
from tests.test_review_packet import _closed


def _packet(tmp_path: Path) -> tuple[Path, object]:
    _, closure, result, root = _closed(tmp_path)
    packet_root = tmp_path / "packet"
    packet = build_review_packet(closure, result, root, packet_root)
    return packet_root, packet


def _observation(packet_root: Path) -> dict:
    packet = json.loads((packet_root / "review-packet.json").read_bytes())
    return {
        "environment": deepcopy(SUPPORTED_ENVIRONMENT),
        "network": {
            "unavailable_mechanism": "browser-context-offline-and-request-abort",
            "attempted_remote_requests": 0,
            "completed_remote_requests": 0,
            "csp_violations": 0,
            "missing_vendored_bytes": 0,
        },
        "visible_state": {
            "status": "Loaded · packet validated",
            "project_id": packet["project_id"],
            "revision_id": packet["revision_id"],
            "build_attempt_id": packet["build_attempt_id"],
            "evidence_closure_digest": packet["evidence_closure_digest"],
            "worker_pin": packet["worker_pin"],
            "packet_digest": packet["packet_digest"],
            "truth_disclosures_visible": True,
        },
        "interactions": {
            name: True
            for name in (
                "keyboard_selection", "pointer_selection", "smart", "face", "component",
                "iso", "front", "top", "fit", "roll", "reset", "bounding_box_reset",
                "source_parameters", "selected_zone", "validation_issues", "bounding_box",
                "build_volume", "selection_context",
            )
        },
        "build_plane": {
            "artifact_z_min_mm": 0.0,
            "tolerance_mm": 1e-6,
            "mapping": "(x,y,z)->(x,y,z)",
            "world_grid_plane": "z=0",
            "exact_coordinates_reinterpreted": False,
        },
        "measurements": {
            "startup_to_loaded_ms": 100.0,
            "interaction_p95_ms": 25.0,
            "peak_memory_bytes": 64_000_000,
            "cpu_time_ms": 100.0,
            "idle_cpu_time_ms": 10.0,
            "graceful_failure_cases_passed": 3,
            "battery": "not_applicable_non_battery_software_renderer_row",
        },
        "golden_path": {name: "passed" for name in REQUIRED_GOLDEN_PATH_STEPS},
        "failure_injection": {
            "corrupt_packet_blocked": True,
            "missing_glb_blocked": True,
            "missing_selection_map_blocked": True,
            "fallback_network_requests": 0,
            "consequence_controls_exposed": False,
        },
    }


def test_caller_supplied_exact_literals_cannot_mint_passing_evidence(tmp_path: Path) -> None:
    packet_root, packet = _packet(tmp_path)
    observation = _observation(packet_root)

    first = qualify_browser_observation(packet_root, observation, tmp_path / "first.json")
    second = qualify_browser_observation(packet_root, observation, tmp_path / "second.json")

    assert first == second
    assert first["status"] == "failed"
    assert first["failed_checks"] == ["provenance.controlled_browser_execution_missing"]
    assert first["packet"]["packet_digest"] == packet.packet_digest
    assert first["budgets"] == PERFORMANCE_BUDGETS
    assert first["p4_requirement_ids"] == [
        "offline-golden-path",
        "supported-platform-matrix",
        "performance-budgets",
        "vendored-csp-license-privacy",
    ]
    assert first["truth"] == {
        "review_state": "needs_human_review",
        "fabrication_release": False,
        "machine_actuation": False,
        "release_state": "unreleased",
        "channel_transition": False,
    }
    assert validate_browser_qualification(tmp_path / "first.json") == first


def test_environment_substitution_and_missing_measurement_fail_closed(tmp_path: Path) -> None:
    packet_root, _ = _packet(tmp_path)
    changed = _observation(packet_root)
    changed["environment"]["browser_version"] = "nearest-is-not-supported"
    with pytest.raises(BrowserQualificationError, match="supported environment row"):
        qualify_browser_observation(packet_root, changed, tmp_path / "changed.json")

    missing = _observation(packet_root)
    del missing["measurements"]["peak_memory_bytes"]
    with pytest.raises(BrowserQualificationError, match="measurements contract"):
        qualify_browser_observation(packet_root, missing, tmp_path / "missing.json")


def test_network_attempt_and_budget_excess_emit_failed_evidence(tmp_path: Path) -> None:
    packet_root, _ = _packet(tmp_path)
    observation = _observation(packet_root)
    observation["network"]["attempted_remote_requests"] = 1
    observation["measurements"]["startup_to_loaded_ms"] = (
        PERFORMANCE_BUDGETS["startup_to_loaded_ms"] + 1
    )

    receipt = qualify_browser_observation(packet_root, observation, tmp_path / "failed.json")

    assert receipt["status"] == "failed"
    assert "network.attempted_remote_requests" in receipt["failed_checks"]
    assert "budget.startup_to_loaded_ms" in receipt["failed_checks"]
    assert receipt["truth"]["fabrication_release"] is False


def test_receipt_is_separate_no_clobber_and_tampering_is_rejected(tmp_path: Path) -> None:
    packet_root, _ = _packet(tmp_path)
    output = tmp_path / "receipt.json"
    qualify_browser_observation(packet_root, _observation(packet_root), output)

    with pytest.raises(FileExistsError, match="must be new"):
        qualify_browser_observation(packet_root, _observation(packet_root), output)
    with pytest.raises(BrowserQualificationError, match="outside the immutable packet"):
        qualify_browser_observation(packet_root, _observation(packet_root), packet_root / "receipt.json")

    value = json.loads(output.read_bytes())
    value["truth"]["fabrication_release"] = True
    value["evidence_digest"] = review_digest = browser_qualification_module._receipt_digest(
        {key: item for key, item in value.items() if key != "evidence_digest"}
    )
    assert review_digest.startswith("sha256:")
    output.write_text(json.dumps(value), encoding="utf-8")
    with pytest.raises(BrowserQualificationError):
        validate_browser_qualification(output)


def test_self_consistent_budget_substitution_is_rejected(tmp_path: Path) -> None:
    packet_root, _ = _packet(tmp_path)
    output = tmp_path / "receipt.json"
    qualify_browser_observation(packet_root, _observation(packet_root), output)
    value = json.loads(output.read_bytes())
    value["budgets"]["startup_to_loaded_ms"] += 1
    value["evidence_digest"] = browser_qualification_module._receipt_digest(
        {key: item for key, item in value.items() if key != "evidence_digest"}
    )
    output.write_text(json.dumps(value), encoding="utf-8")

    with pytest.raises(BrowserQualificationError, match="fixed qualification contract"):
        validate_browser_qualification(output)


def test_self_consistent_provenance_removal_cannot_create_a_pass(tmp_path: Path) -> None:
    packet_root, _ = _packet(tmp_path)
    output = tmp_path / "receipt.json"
    qualify_browser_observation(packet_root, _observation(packet_root), output)
    value = json.loads(output.read_bytes())
    value["failed_checks"] = []
    value["status"] = "passed"
    value["evidence_digest"] = browser_qualification_module._receipt_digest(
        {key: item for key, item in value.items() if key != "evidence_digest"}
    )
    output.write_text(json.dumps(value), encoding="utf-8")

    with pytest.raises(BrowserQualificationError):
        validate_browser_qualification(output)
