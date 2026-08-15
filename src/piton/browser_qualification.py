"""Fail-closed qualification evidence for one packet-local browser run.

The browser harness supplies raw observations. This module independently admits
one exact supported environment row, recomputes packet custody, applies
source-fixed budgets, and publishes immutable derived evidence. It has no API
for source, revision, lifecycle, channel, review, export, release, or machine
mutation.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import tempfile
from importlib.resources import files
from pathlib import Path
from typing import Any, Mapping

from jsonschema import Draft202012Validator, ValidationError

from .review_packet import ReviewPacket, validate_review_packet
from .worker_contracts import canonical_json_bytes

SCHEMA = "piton.browser-qualification-receipt.v1"
SUPPORTED_ENVIRONMENT: dict[str, Any] = {
    "browser_name": "Google Chrome",
    "browser_version": "143.0.7499.192",
    "os": "Ubuntu 24.04 noble",
    "kernel": "Linux 6.17.9-76061709-generic x86_64",
    "rendering_mode": "headless-software",
    "renderer": "ANGLE SwiftShader Vulkan 1.3.0 (Subzero); SwANGLE 5.0.0",
    "viewport": {"width": 1440, "height": 900},
    "device_scale_factor": 1,
    "cpu": "Intel(R) Core(TM) Ultra 5 225H; 14 logical CPUs",
    "memory_bytes": 100_520_669_184,
    "qualification_tools": {
        "python": "3.12.11",
        "node": "22.22.3",
        "playwright": "1.62.1",
        "uv": "0.11.6",
    },
}
PERFORMANCE_BUDGETS: dict[str, int] = {
    "review_glb_bytes": 1_048_576,
    "packet_bytes": 2_097_152,
    "startup_to_loaded_ms": 2_000,
    "interaction_p95_ms": 250,
    "peak_memory_bytes": 268_435_456,
    "cpu_time_ms": 5_000,
    "idle_cpu_time_ms": 500,
    "graceful_failure_cases_passed_minimum": 3,
}
REQUIRED_GOLDEN_PATH_STEPS = (
    "reopen_canonical_custody",
    "inspect_immutable_base",
    "admit_bounded_proposal",
    "commit_candidate_revision",
    "persist_build_attempt_before_dispatch",
    "execute_pinned_precision_worker",
    "realize_exact_brep_and_step",
    "derive_review_glb_and_semantic_map",
    "execute_predeclared_checks",
    "close_and_read_back_evidence",
    "assemble_and_validate_review_packet",
    "open_and_interact_packet_locally",
    "admit_human_review_intake_without_acceptance",
    "create_unreleased_draft_export_record",
    "create_restore_forward_candidate",
    "reopen_all_bound_objects_and_digests",
)
_INTERACTIONS = frozenset(
    {
        "keyboard_selection", "pointer_selection", "smart", "face", "component",
        "iso", "front", "top", "fit", "roll", "reset", "bounding_box_reset",
        "source_parameters", "selected_zone", "validation_issues", "bounding_box",
        "build_volume", "selection_context",
    }
)
_TRUTH = {
    "review_state": "needs_human_review",
    "fabrication_release": False,
    "machine_actuation": False,
    "release_state": "unreleased",
    "channel_transition": False,
}
_P4_REQUIREMENTS = [
    "offline-golden-path",
    "supported-platform-matrix",
    "performance-budgets",
    "vendored-csp-license-privacy",
]
_METHOD = {
    "id": "piton.packet-local-disconnected-browser.v1",
    "network_enforcement": "browser-context-offline",
    "network_observer": "request-event-and-route-abort",
    "comparator": "closed exact-row equality and numeric threshold comparison",
}
_MEASUREMENT_KEYS = {
    "review_glb_bytes", "packet_bytes", "startup_to_loaded_ms", "interaction_p95_ms",
    "peak_memory_bytes", "cpu_time_ms", "idle_cpu_time_ms",
    "graceful_failure_cases_passed", "battery",
}
_UNTRUSTED_PROVENANCE_FAILURE = "provenance.controlled_browser_execution_missing"


class BrowserQualificationError(RuntimeError):
    """The observation or derived qualification receipt failed admission."""


def _digest_bytes(value: bytes) -> str:
    return "sha256:" + hashlib.sha256(value).hexdigest()


def _receipt_digest(value: Mapping[str, Any]) -> str:
    return _digest_bytes(SCHEMA.encode() + b"\0" + canonical_json_bytes(value))


def _closed_mapping(value: object, keys: set[str] | frozenset[str], label: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping) or set(value) != set(keys):
        raise BrowserQualificationError(f"{label} contract is not closed")
    return value


def _finite_nonnegative(value: object, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
        raise BrowserQualificationError(f"{label} must be a finite non-negative number")
    return float(value)


def _packet_measurements(packet_root: Path, packet: ReviewPacket) -> dict[str, int]:
    packet_bytes = 0
    for path in packet_root.rglob("*"):
        if path.is_symlink():
            raise BrowserQualificationError("packet inventory contains a symbolic link")
        if path.is_file():
            packet_bytes += path.stat().st_size
    return {
        "review_glb_bytes": int(packet.artifacts["review_glb"]["byte_length"]),
        "packet_bytes": packet_bytes,
    }


def _packet_identity(packet: ReviewPacket) -> dict[str, Any]:
    return {
        "project_id": packet.project_id,
        "revision_id": packet.revision_id,
        "build_attempt_id": packet.build_attempt_id,
        "evidence_closure_digest": packet.evidence_closure_digest,
        "worker_result_digest": packet.worker_result_digest,
        "worker_pin": packet.worker_pin,
        "packet_digest": packet.packet_digest,
        "viewer_asset_digests": dict(packet.viewer["asset_digests"]),
        "artifact_digests": {
            role: value["digest"] for role, value in sorted(packet.artifacts.items())
        },
    }


def _validate_observation(packet: ReviewPacket, raw: Mapping[str, Any]) -> tuple[dict[str, Any], list[str]]:
    required = {
        "environment", "network", "visible_state", "interactions", "build_plane",
        "measurements", "golden_path", "failure_injection",
    }
    _closed_mapping(raw, required, "browser observation")
    environment = raw["environment"]
    if not isinstance(environment, Mapping) or dict(environment) != SUPPORTED_ENVIRONMENT:
        raise BrowserQualificationError("observation does not match the exact supported environment row")

    network = _closed_mapping(raw["network"], {
        "unavailable_mechanism", "attempted_remote_requests", "completed_remote_requests",
        "csp_violations", "missing_vendored_bytes",
    }, "network observation")
    if network["unavailable_mechanism"] != "browser-context-offline-and-request-abort":
        raise BrowserQualificationError("network unavailability mechanism is unsupported")

    expected_visible = {
        **{key: value for key, value in _packet_identity(packet).items() if key in {
            "project_id", "revision_id", "build_attempt_id", "evidence_closure_digest",
            "worker_pin", "packet_digest",
        }},
        "status": "Loaded · packet validated",
        "truth_disclosures_visible": True,
    }
    visible = _closed_mapping(raw["visible_state"], set(expected_visible), "visible state")

    interactions = _closed_mapping(raw["interactions"], _INTERACTIONS, "interactions")
    build_plane = _closed_mapping(raw["build_plane"], {
        "artifact_z_min_mm", "tolerance_mm", "mapping", "world_grid_plane",
        "exact_coordinates_reinterpreted",
    }, "build-plane observation")
    measurements = _closed_mapping(raw["measurements"], _MEASUREMENT_KEYS - {
        "review_glb_bytes", "packet_bytes"
    }, "measurements")
    golden_path = _closed_mapping(raw["golden_path"], set(REQUIRED_GOLDEN_PATH_STEPS), "golden path")
    failure = _closed_mapping(raw["failure_injection"], {
        "corrupt_packet_blocked", "missing_glb_blocked", "missing_selection_map_blocked",
        "fallback_network_requests", "consequence_controls_exposed",
    }, "failure injection")

    failed: list[str] = []
    for key in ("attempted_remote_requests", "completed_remote_requests", "csp_violations", "missing_vendored_bytes"):
        if _finite_nonnegative(network[key], f"network.{key}") != 0:
            failed.append(f"network.{key}")
    if dict(visible) != expected_visible:
        failed.append("visible_state.identity_or_status")
    for key, value in interactions.items():
        if value is not True:
            failed.append(f"interaction.{key}")
    z_min = _finite_nonnegative(abs(build_plane["artifact_z_min_mm"]), "build_plane.artifact_z_min_mm")
    tolerance = _finite_nonnegative(build_plane["tolerance_mm"], "build_plane.tolerance_mm")
    if (
        z_min > tolerance
        or build_plane["mapping"] != "(x,y,z)->(x,y,z)"
        or build_plane["world_grid_plane"] != "z=0"
        or build_plane["exact_coordinates_reinterpreted"] is not False
    ):
        failed.append("build_plane")
    for key, value in golden_path.items():
        if value != "passed":
            failed.append(f"golden_path.{key}")
    for key in ("corrupt_packet_blocked", "missing_glb_blocked", "missing_selection_map_blocked"):
        if failure[key] is not True:
            failed.append(f"failure_injection.{key}")
    if failure["fallback_network_requests"] != 0:
        failed.append("failure_injection.fallback_network_requests")
    if failure["consequence_controls_exposed"] is not False:
        failed.append("failure_injection.consequence_controls_exposed")
    if measurements["battery"] != "not_applicable_non_battery_software_renderer_row":
        failed.append("measurement.battery_disposition")
    return dict(measurements), sorted(failed)


def _publish_no_clobber(value: Mapping[str, Any], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(value, indent=2, sort_keys=True, allow_nan=False).encode() + b"\n"
    temporary_name: str | None = None
    try:
        with tempfile.NamedTemporaryFile(dir=output_path.parent, prefix=".browser-qualification-", delete=False) as stream:
            temporary_name = stream.name
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.link(temporary_name, output_path)
    except FileExistsError as exc:
        raise FileExistsError("browser qualification receipt path must be new") from exc
    finally:
        if temporary_name:
            Path(temporary_name).unlink(missing_ok=True)


def qualify_browser_observation(
    packet_root: Path, observation: Mapping[str, Any], output_path: Path
) -> dict[str, Any]:
    """Record an untrusted observation without granting qualification authority.

    A caller-provided mapping is useful diagnostic evidence, but it is not proof
    that a controlled browser harness performed the claimed actions. Therefore
    this boundary always fails the controlled-execution provenance check. A
    future source-fixed harness must expose a separate API rather than adding a
    caller-selectable trust flag here.
    """
    root = Path(packet_root).resolve(strict=True)
    destination = Path(output_path).resolve(strict=False)
    if destination.is_relative_to(root):
        raise BrowserQualificationError("qualification receipt must remain outside the immutable packet")
    if destination.exists():
        raise FileExistsError("browser qualification receipt path must be new")
    packet = validate_review_packet(root)
    observed_measurements, failed = _validate_observation(packet, observation)
    failed.append(_UNTRUSTED_PROVENANCE_FAILURE)
    measurements = {**_packet_measurements(root, packet), **observed_measurements}
    for key, budget in PERFORMANCE_BUDGETS.items():
        measurement_key = (
            "graceful_failure_cases_passed" if key == "graceful_failure_cases_passed_minimum" else key
        )
        actual = _finite_nonnegative(measurements[measurement_key], f"measurement.{measurement_key}")
        exceeded = actual < budget if key.endswith("_minimum") else actual > budget
        if exceeded:
            failed.append(f"budget.{key}")
    value: dict[str, Any] = {
        "schema": SCHEMA,
        "status": "passed" if not failed else "failed",
        "packet": _packet_identity(packet),
        "environment": SUPPORTED_ENVIRONMENT,
        "method": _METHOD,
        "budgets": PERFORMANCE_BUDGETS,
        "measurements": measurements,
        "observation": dict(observation),
        "failed_checks": sorted(set(failed)),
        "p4_requirement_ids": _P4_REQUIREMENTS,
        "invalidation_conditions": [
            "candidate commit changes", "packet or artifact digest changes",
            "browser, OS, kernel, renderer, viewport, device scale, CPU, memory, or tool changes",
            "method, comparator, budget, CSP, notice, dependency lock, cache, or golden-path step changes",
        ],
        "authority": "derived review qualification evidence only; not review acceptance, approval, export, release, or actuation",
        "truth": _TRUTH,
    }
    value["evidence_digest"] = _receipt_digest(value)
    _validate_receipt_value(value)
    _publish_no_clobber(value, destination)
    if validate_browser_qualification(destination) != value:
        raise BrowserQualificationError("browser qualification readback changed canonical evidence")
    return value


def _validate_receipt_value(value: Mapping[str, Any]) -> None:
    schema = json.loads(files("piton").joinpath("schemas", "browser-qualification-receipt-v1.schema.json").read_text())
    try:
        Draft202012Validator(schema).validate(value)
    except ValidationError as exc:
        raise BrowserQualificationError("browser qualification receipt violates its closed schema") from exc
    observation = value.get("observation")
    if not isinstance(observation, Mapping):
        raise BrowserQualificationError("browser qualification receipt has no observation")
    if (
        dict(value["truth"]) != _TRUTH
        or dict(value["environment"]) != SUPPORTED_ENVIRONMENT
        or dict(value["budgets"]) != PERFORMANCE_BUDGETS
        or dict(value["method"]) != _METHOD
        or value["p4_requirement_ids"] != _P4_REQUIREMENTS
        or observation.get("environment") != SUPPORTED_ENVIRONMENT
        or _UNTRUSTED_PROVENANCE_FAILURE not in value["failed_checks"]
        or value["status"] != ("passed" if not value["failed_checks"] else "failed")
    ):
        raise BrowserQualificationError(
            "browser qualification receipt violates its fixed qualification contract"
        )
    without_digest = {key: item for key, item in value.items() if key != "evidence_digest"}
    if value["evidence_digest"] != _receipt_digest(without_digest):
        raise BrowserQualificationError("browser qualification evidence digest mismatch")


def validate_browser_qualification(path: Path) -> dict[str, Any]:
    """Read back one immutable qualification receipt without granting authority."""
    receipt_path = Path(path)
    if not receipt_path.is_file() or receipt_path.is_symlink():
        raise BrowserQualificationError("browser qualification receipt must be a regular file")
    try:
        value = json.loads(receipt_path.read_bytes())
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise BrowserQualificationError("browser qualification receipt must be UTF-8 JSON") from exc
    if not isinstance(value, dict):
        raise BrowserQualificationError("browser qualification receipt must be an object")
    _validate_receipt_value(value)
    return value
