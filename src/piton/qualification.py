"""Fail-closed local qualification of a realization-bound STEP derivative.

Qualification is immutable derived evidence only. It cannot mutate authored
revisions, builds, channels, review dispositions, approvals, release state, or
machine state.
"""
from __future__ import annotations

import hashlib
import importlib.metadata
import json
import math
import os
import platform
import re
import tempfile
from pathlib import Path
from typing import Any, Mapping

from build123d import import_step

from .revision import DesignRevision, canonical_json_bytes

REALIZATION_SCHEMA = "piton.exact-realization-receipt.v1"
QUALIFICATION_SCHEMA = "piton.step-qualification-receipt.v1"
STEP_NAME = "part.step"
REALIZATION_RECEIPT_NAME = "receipt.json"
QUALIFICATION_RECEIPT_NAME = "qualification.json"
RECEIVER = {
    "name": "build123d.import_step",
    "version": "build123d@0.11.1",
    "profile": "piton.local-step-readback.v1",
    "geometry_backend": "cadquery-ocp-novtk@7.9.3.1",
}
TOLERANCES = {
    "bounding_box_mm": {"absolute": 1e-6, "relative": 1e-9},
    "volume_mm3": {"absolute": 1e-6, "relative": 1e-9},
    "area_mm2": {"absolute": 1e-6, "relative": 1e-9},
    "solid_count": {"absolute": 0, "relative": 0},
}
DECLARED_LOSSES = [
    "source-native Python/build123d history",
    "source parameter editability",
    "semantic feature identity",
    "durable topology identity",
    "assembly constraints and mates",
    "review disposition",
    "engineering approval",
    "export authority",
    "fabrication release authority",
]
_DIGEST_PATTERN = re.compile(r"^sha256:[0-9a-f]{64}$")
_ATTEMPT_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return "sha256:" + digest.hexdigest()


def _evidence_digest(receipt: Mapping[str, Any]) -> str:
    return "sha256:" + hashlib.sha256(
        b"piton.step-qualification-receipt.v1\0" + canonical_json_bytes(receipt)
    ).hexdigest()


def _mapping(value: object, name: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError(f"realization receipt {name} must be an object")
    return value


def _require_supported_receipt(receipt: Mapping[str, Any], attempt_scope: str) -> None:
    if receipt.get("schema") != REALIZATION_SCHEMA:
        raise ValueError("unsupported realization receipt")
    if receipt.get("status") != "succeeded":
        raise ValueError("realization receipt must record a successful realization")
    if not _ATTEMPT_PATTERN.fullmatch(attempt_scope):
        raise ValueError("attempt directory has an invalid scope")
    if receipt.get("attempt_scope") != attempt_scope:
        raise ValueError("realization receipt attempt_scope does not match its directory")
    if receipt.get("units") != "mm":
        raise ValueError("realization receipt must declare millimetres")

    revision_manifest = _mapping(receipt.get("revision_manifest"), "revision_manifest")
    try:
        revision = DesignRevision.from_manifest(revision_manifest)
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError("realization receipt has an invalid revision manifest") from exc
    if receipt.get("revision_id") != revision.revision_id:
        raise ValueError("realization receipt revision_id does not match its manifest")

    artifacts = _mapping(receipt.get("artifacts"), "artifacts")
    artifact_digests = _mapping(receipt.get("artifact_digests"), "artifact_digests")
    claim_scopes = _mapping(receipt.get("claim_scopes"), "claim_scopes")
    authority = _mapping(receipt.get("authority"), "authority")
    toolchain = _mapping(receipt.get("toolchain"), "toolchain")
    if artifacts.get("step") != STEP_NAME:
        raise ValueError("realization receipt does not bind the supported STEP artifact")
    step_digest = artifact_digests.get("step")
    if not isinstance(step_digest, str) or not _DIGEST_PATTERN.fullmatch(step_digest):
        raise ValueError("realization receipt has an invalid STEP digest")
    if claim_scopes.get("step") != "derived_exchange_representation":
        raise ValueError("realization receipt has an unsupported STEP claim scope")
    if authority.get("writable_design_authority") != "source-native Python" or (
        authority.get("realization_is_derived") is not True
    ):
        raise ValueError("realization receipt has an unsupported authority boundary")
    if dict(toolchain) != {
        "python": "3.12.11",
        "build123d": "0.11.1",
        "cadquery-ocp-novtk": "7.9.3.1",
    } or receipt.get("isolation_class") != "trusted-local":
        raise ValueError("realization receipt has an unsupported toolchain profile")
    if (
        receipt.get("review_state") != "needs_human_review"
        or receipt.get("fabrication_release") is not False
        or receipt.get("machine_actuation") is not False
    ):
        raise ValueError("realization receipt violates the Stage 1 safety boundary")
    _mapping(receipt.get("inspection"), "inspection")


def _inspection(part: Any) -> dict[str, Any]:
    bounding_box = part.bounding_box()
    inspection = {
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
        "topology_counts_claim_scope": "diagnostic-only; not durable topology identity",
    }
    numeric_values = [
        *inspection["bounding_box_mm"]["min"],
        *inspection["bounding_box_mm"]["max"],
        *inspection["bounding_box_mm"]["size"],
        inspection["volume_mm3"],
        inspection["area_mm2"],
    ]
    if not all(math.isfinite(value) for value in numeric_values):
        raise RuntimeError("named receiver produced non-finite inspection values")
    return inspection


def _close(actual: float, expected: float, tolerance: Mapping[str, float]) -> bool:
    return math.isclose(
        actual,
        expected,
        rel_tol=tolerance["relative"],
        abs_tol=tolerance["absolute"],
    )


def _verify_readback(
    readback: Mapping[str, Any], expected: Mapping[str, Any]
) -> dict[str, Any]:
    if (
        readback["valid"] is not True
        or readback["topology_counts"]["solids"] != 1
        or readback["volume_mm3"] <= 0
        or readback["area_mm2"] <= 0
    ):
        raise RuntimeError("named receiver did not read back one valid, non-empty solid")

    comparisons: dict[str, Any] = {}
    expected_bbox = _mapping(expected.get("bounding_box_mm"), "inspection.bounding_box_mm")
    for field in ("min", "max", "size"):
        actual_values = readback["bounding_box_mm"][field]
        expected_values = expected_bbox.get(field)
        if not isinstance(expected_values, list) or len(expected_values) != 3 or not all(
            isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
            for value in expected_values
        ):
            raise ValueError(f"realization receipt inspection {field} must contain three finite numbers")
        passed = all(
            _close(float(actual), float(reference), TOLERANCES["bounding_box_mm"])
            for actual, reference in zip(actual_values, expected_values)
        )
        comparisons[f"bounding_box_mm.{field}"] = {
            "passed": passed,
            "expected": list(expected_values),
            "actual": list(actual_values),
            "tolerance": TOLERANCES["bounding_box_mm"],
        }
        if not passed:
            raise RuntimeError(f"named receiver STEP readback changed bounding-box {field}")

    for field in ("volume_mm3", "area_mm2"):
        expected_value = expected.get(field)
        if (
            not isinstance(expected_value, (int, float))
            or isinstance(expected_value, bool)
            or not math.isfinite(expected_value)
        ):
            raise ValueError(f"realization receipt inspection {field} must be finite and numeric")
        passed = _close(float(readback[field]), float(expected_value), TOLERANCES[field])
        comparisons[field] = {
            "passed": passed,
            "expected": expected_value,
            "actual": readback[field],
            "tolerance": TOLERANCES[field],
        }
        if not passed:
            raise RuntimeError(f"named receiver STEP readback changed {field}")

    expected_topology = _mapping(expected.get("topology_counts"), "inspection.topology_counts")
    expected_solids = expected_topology.get("solids")
    if not isinstance(expected_solids, int) or isinstance(expected_solids, bool):
        raise ValueError("realization receipt inspection solid count must be an integer")
    solid_passed = readback["topology_counts"]["solids"] == expected_solids == 1
    comparisons["solid_count"] = {
        "passed": solid_passed,
        "expected": expected_solids,
        "actual": readback["topology_counts"]["solids"],
        "tolerance": TOLERANCES["solid_count"],
    }
    if not solid_passed:
        raise RuntimeError("named receiver STEP readback changed solid count")
    return comparisons


def _publish_no_clobber(receipt: Mapping[str, Any], output_path: Path) -> None:
    if output_path.name != QUALIFICATION_RECEIPT_NAME:
        raise ValueError("qualification receipt must be named qualification.json")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(receipt, indent=2, sort_keys=True, allow_nan=False) + "\n"
    temporary_name: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", prefix=".qualification-", suffix=".tmp",
            dir=output_path.parent, delete=False
        ) as temporary:
            temporary_name = temporary.name
            temporary.write(payload)
            temporary.flush()
            os.fsync(temporary.fileno())
        os.link(temporary_name, output_path)
    except FileExistsError as exc:
        raise FileExistsError("qualification receipt path must be new") from exc
    finally:
        if temporary_name is not None:
            Path(temporary_name).unlink(missing_ok=True)


def qualify_step(
    realization_receipt_path: Path,
    qualification_receipt_path: Path,
    *,
    receiver_profile: str = RECEIVER["profile"],
) -> dict[str, Any]:
    """Read back one bound STEP and atomically publish immutable evidence."""
    receipt_path = Path(realization_receipt_path)
    output_path = Path(qualification_receipt_path)
    if not receipt_path.is_file() or receipt_path.is_symlink():
        raise FileNotFoundError("realization receipt must be a regular file")
    if receipt_path.name != REALIZATION_RECEIPT_NAME:
        raise ValueError("realization receipt must be named receipt.json")
    receipt_path = receipt_path.resolve(strict=True)
    attempt_directory = receipt_path.parent
    if output_path.resolve(strict=False).is_relative_to(attempt_directory):
        raise ValueError("qualification receipt must be outside the immutable realization attempt")
    if output_path.exists():
        raise FileExistsError("qualification receipt path must be new")
    if receiver_profile != RECEIVER["profile"]:
        raise ValueError("unsupported STEP receiver profile")

    source_receipt_digest = _sha256_file(receipt_path)
    try:
        receipt_value = json.loads(receipt_path.read_text(encoding="utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("realization receipt must be valid UTF-8 JSON") from exc
    receipt = _mapping(receipt_value, "root")
    _require_supported_receipt(receipt, attempt_directory.name)

    step_path = attempt_directory / STEP_NAME
    if not step_path.is_file() or step_path.is_symlink():
        raise FileNotFoundError("bound STEP must be a regular file")
    step_digest = _sha256_file(step_path)
    expected_step_digest = _mapping(receipt["artifact_digests"], "artifact_digests")["step"]
    if step_digest != expected_step_digest:
        raise ValueError("STEP digest does not match the realization receipt")

    environment = {
        "python": platform.python_version(),
        "build123d": importlib.metadata.version("build123d"),
        "cadquery-ocp-novtk": importlib.metadata.version("cadquery-ocp-novtk"),
        "platform": platform.platform(),
        "machine": platform.machine(),
        "isolation_class": "trusted-local",
    }
    expected_versions = {
        "python": "3.12.11",
        "build123d": "0.11.1",
        "cadquery-ocp-novtk": "7.9.3.1",
    }
    if {name: environment[name] for name in expected_versions} != expected_versions:
        raise RuntimeError("named STEP receiver environment mismatch")

    try:
        imported = import_step(step_path)
    except Exception as exc:
        raise RuntimeError("named receiver could not import the bound STEP") from exc
    if _sha256_file(step_path) != step_digest:
        raise RuntimeError("bound STEP changed during receiver qualification")
    if _sha256_file(receipt_path) != source_receipt_digest:
        raise RuntimeError("source realization receipt changed during qualification")

    readback = _inspection(imported)
    comparisons = _verify_readback(readback, _mapping(receipt["inspection"], "inspection"))
    evidence: dict[str, Any] = {
        "schema": QUALIFICATION_SCHEMA,
        "status": "passed",
        "revision_id": receipt["revision_id"],
        "attempt_scope": receipt["attempt_scope"],
        "units": receipt["units"],
        "source_realization": {
            "receipt": REALIZATION_RECEIPT_NAME,
            "receipt_digest": source_receipt_digest,
            "receipt_schema": REALIZATION_SCHEMA,
            "step": STEP_NAME,
            "step_digest": step_digest,
        },
        "receiver": dict(RECEIVER),
        "environment": environment,
        "tolerances": TOLERANCES,
        "readback": readback,
        "comparisons": comparisons,
        "warnings": [],
        "declared_losses": list(DECLARED_LOSSES),
        "claim_scope": "receiver-qualified derived STEP readback for the named profile only",
        "invalidation_conditions": [
            "source realization receipt bytes change",
            "STEP bytes change",
            "receiver name, version, profile, or environment changes",
            "comparison policy or tolerances change",
        ],
        "authority": {
            "writable_design_authority": "source-native Python",
            "qualification_is_derived_evidence": True,
            "qualification_does_not_promote_build_or_channel": True,
            "qualification_is_not_review_approval_export_or_release": True,
        },
        "review_state": "needs_human_review",
        "fabrication_release": False,
        "machine_actuation": False,
    }
    evidence["evidence_digest"] = _evidence_digest(evidence)
    _publish_no_clobber(evidence, output_path)
    return evidence
