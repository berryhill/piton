"""Fail-closed derivation of the Stage 1 exact-CAD feasibility predicate.

The gate consumes immutable realization and qualification evidence plus the
bound BREP and STEP bytes. It derives ``exact_cad_verified``; callers cannot
assert that predicate. The result is feasibility evidence only and carries no
review, approval, export, release, or machine authority.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Any, Mapping

from build123d import import_brep, import_step

from .parts.l_bracket import LBracketParameters, build_l_bracket
from .qualification import (
    QUALIFICATION_SCHEMA,
    RECEIVER,
    REALIZATION_SCHEMA,
    _inspection,
    _require_supported_receipt,
    _verify_readback,
)
from .revision import DesignRevision, canonical_json_bytes
from .realization import ENTRYPOINT, _verify_toolchain

_BREP_NAME = "part.brep"
_STEP_NAME = "part.step"
_REALIZATION_RECEIPT_NAME = "receipt.json"
_QUALIFICATION_RECEIPT_NAME = "qualification.json"
_DIGEST_PREFIX = "sha256:"


@dataclass(frozen=True, slots=True, init=False)
class ExactCadFeasibilityDecision:
    """Content-bound positive result from the exact-CAD feasibility gate."""

    exact_cad_verified: bool
    revision_id: str
    attempt_scope: str
    realization_receipt_digest: str
    qualification_receipt_digest: str
    artifact_digests: Mapping[str, str]
    receiver_profile: str
    claim_scope: str = (
        "exact-CAD feasibility for one revision and attempt; not engineering approval, "
        "review acceptance, export authority, or fabrication release"
    )
    review_state: str = "needs_human_review"
    fabrication_release: bool = False
    machine_actuation: bool = False

    def __init__(self) -> None:
        raise TypeError("exact-CAD feasibility decisions can only be derived by the gate")

    @classmethod
    def _derived(
        cls,
        *,
        revision_id: str,
        attempt_scope: str,
        realization_receipt_digest: str,
        qualification_receipt_digest: str,
        artifact_digests: Mapping[str, str],
        receiver_profile: str,
    ) -> "ExactCadFeasibilityDecision":
        decision = object.__new__(cls)
        values: Mapping[str, Any] = {
            "exact_cad_verified": True,
            "revision_id": revision_id,
            "attempt_scope": attempt_scope,
            "realization_receipt_digest": realization_receipt_digest,
            "qualification_receipt_digest": qualification_receipt_digest,
            "artifact_digests": MappingProxyType(dict(artifact_digests)),
            "receiver_profile": receiver_profile,
            "claim_scope": (
                "exact-CAD feasibility for one revision and attempt; not engineering approval, "
                "review acceptance, export authority, or fabrication release"
            ),
            "review_state": "needs_human_review",
            "fabrication_release": False,
            "machine_actuation": False,
        }
        for name, value in values.items():
            object.__setattr__(decision, name, value)
        return decision

    @property
    def predicates(self) -> Mapping[str, bool]:
        return MappingProxyType({"exact_cad_verified": True})

    def to_dict(self) -> dict[str, Any]:
        return {
            "exact_cad_verified": self.exact_cad_verified,
            "revision_id": self.revision_id,
            "attempt_scope": self.attempt_scope,
            "realization_receipt_digest": self.realization_receipt_digest,
            "qualification_receipt_digest": self.qualification_receipt_digest,
            "artifact_digests": dict(self.artifact_digests),
            "receiver_profile": self.receiver_profile,
            "claim_scope": self.claim_scope,
            "review_state": self.review_state,
            "fabrication_release": self.fabrication_release,
            "machine_actuation": self.machine_actuation,
        }


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return _DIGEST_PREFIX + digest.hexdigest()


def _regular_file(path: Path, label: str) -> Path:
    if not path.is_file() or path.is_symlink():
        raise FileNotFoundError(f"{label} must be a regular file")
    return path.resolve(strict=True)


def _read_json(path: Path, label: str) -> Mapping[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"{label} must be valid UTF-8 JSON") from exc
    if not isinstance(value, Mapping):
        raise ValueError(f"{label} must contain a JSON object")
    return value


def _mapping(value: object, label: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError(f"{label} must be an object")
    return value


def _source_native_part(revision: DesignRevision) -> Any:
    """Rebuild the revision's authoritative source geometry after identity checks."""
    repository_root = Path(__file__).resolve().parents[2]
    _verify_toolchain()
    source_path = Path(build_l_bracket.__code__.co_filename).resolve(strict=True)
    identity_paths = {
        "source_manifest_digest": source_path,
        "dependency_lock_digest": repository_root / "uv.lock",
        "toolchain_lock_digest": repository_root / "pyproject.toml",
    }
    for field_name, path in identity_paths.items():
        if _sha256_file(_regular_file(path, field_name)) != getattr(revision, field_name):
            raise ValueError(f"{field_name} does not match the current source-native authority")
    if revision.entrypoint != ENTRYPOINT:
        raise ValueError("revision entrypoint is not the supported source-native authority")

    values = dict(revision.parameter_values)
    expected_names = {
        "leg_length_mm",
        "leg_width_mm",
        "base_length_mm",
        "base_thickness_mm",
        "leg_thickness_mm",
        "hole_diameter_mm",
        "hole_count_base",
        "hole_count_leg",
        "hole_edge_offset_mm",
        "hole_pitch_mm",
        "fillet_radius_mm",
        "chamfer_mm",
    }
    if set(values) != expected_names:
        raise ValueError("revision parameters do not match the supported source-native Part")
    try:
        parameters = LBracketParameters(
            leg_length_mm=float(values["leg_length_mm"]),
            leg_width_mm=float(values["leg_width_mm"]),
            base_length_mm=float(values["base_length_mm"]),
            base_thickness_mm=float(values["base_thickness_mm"]),
            leg_thickness_mm=float(values["leg_thickness_mm"]),
            hole_diameter_mm=float(values["hole_diameter_mm"]),
            hole_count_base=int(values["hole_count_base"]),
            hole_count_leg=int(values["hole_count_leg"]),
            hole_edge_offset_mm=float(values["hole_edge_offset_mm"]),
            hole_pitch_mm=float(values["hole_pitch_mm"]),
            fillet_radius_mm=float(values["fillet_radius_mm"]),
            chamfer_mm=float(values["chamfer_mm"]),
        )
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError("revision parameters cannot realize the source-native Part") from exc
    if parameters.to_primitive_map() != values:
        raise ValueError("revision parameters are not in canonical source-native form")
    return build_l_bracket(parameters)


def _verify_source_geometry(expected_part: Any, actual_part: Any) -> None:
    """Require zero-volume symmetric difference from rebuilt source authority."""
    try:
        missing_volume = float((expected_part - actual_part).volume)
        extra_volume = float((actual_part - expected_part).volume)
    except Exception as exc:
        raise ValueError("exact artifact cannot be compared with source-native geometry") from exc
    if missing_volume > 1e-7 or extra_volume > 1e-7:
        raise ValueError("exact artifact does not match the source-native geometry")


def _verify_qualification(
    qualification: Mapping[str, Any],
    *,
    revision_id: str,
    attempt_scope: str,
    realization_receipt_digest: str,
    step_digest: str,
) -> None:
    if qualification.get("schema") != QUALIFICATION_SCHEMA or qualification.get("status") != "passed":
        raise ValueError("unsupported or unsuccessful STEP qualification receipt")

    claimed_digest = qualification.get("evidence_digest")
    unsigned = dict(qualification)
    unsigned.pop("evidence_digest", None)
    expected_digest = _DIGEST_PREFIX + hashlib.sha256(
        b"piton.step-qualification-receipt.v1\0" + canonical_json_bytes(unsigned)
    ).hexdigest()
    if claimed_digest != expected_digest:
        raise ValueError("qualification evidence digest does not bind its content")

    if qualification.get("revision_id") != revision_id:
        raise ValueError("qualification revision_id does not match the bound revision")
    if qualification.get("attempt_scope") != attempt_scope:
        raise ValueError("qualification attempt_scope does not match the bound attempt")
    if qualification.get("units") != "mm":
        raise ValueError("qualification must declare millimetres")

    source = _mapping(qualification.get("source_realization"), "qualification source_realization")
    if dict(source) != {
        "receipt": _REALIZATION_RECEIPT_NAME,
        "receipt_digest": realization_receipt_digest,
        "receipt_schema": REALIZATION_SCHEMA,
        "step": _STEP_NAME,
        "step_digest": step_digest,
    }:
        raise ValueError("qualification does not bind the exact realization receipt and STEP")
    if dict(_mapping(qualification.get("receiver"), "qualification receiver")) != RECEIVER:
        raise ValueError("qualification does not use the named STEP receiver")

    environment = _mapping(qualification.get("environment"), "qualification environment")
    expected_environment = {
        "python": "3.12.11",
        "build123d": "0.11.1",
        "cadquery-ocp-novtk": "7.9.3.1",
        "isolation_class": "trusted-local",
    }
    if any(environment.get(name) != value for name, value in expected_environment.items()):
        raise ValueError("qualification named receiver environment mismatch")

    comparisons = _mapping(qualification.get("comparisons"), "qualification comparisons")
    if not comparisons or any(
        not isinstance(result, Mapping) or result.get("passed") is not True
        for result in comparisons.values()
    ):
        raise ValueError("qualification does not contain all-passing comparisons")
    authority = _mapping(qualification.get("authority"), "qualification authority")
    if dict(authority) != {
        "writable_design_authority": "source-native Python",
        "qualification_is_derived_evidence": True,
        "qualification_does_not_promote_build_or_channel": True,
        "qualification_is_not_review_approval_export_or_release": True,
    }:
        raise ValueError("qualification violates the source authority boundary")
    if (
        qualification.get("review_state") != "needs_human_review"
        or qualification.get("fabrication_release") is not False
        or qualification.get("machine_actuation") is not False
    ):
        raise ValueError("qualification violates the Stage 1 safety boundary")


def evaluate_exact_cad_feasibility(
    revision: DesignRevision,
    realization_receipt_path: Path,
    qualification_receipt_path: Path,
) -> ExactCadFeasibilityDecision:
    """Derive a positive exact-CAD predicate from one fully bound evidence set.

    Every malformed, missing, unsupported, ambiguous, changed, or mismatched
    input raises before a positive decision exists.
    """
    if not isinstance(revision, DesignRevision):
        raise TypeError("revision must be a DesignRevision")

    receipt_path = _regular_file(Path(realization_receipt_path), "realization receipt")
    if receipt_path.name != _REALIZATION_RECEIPT_NAME:
        raise ValueError("realization receipt must be named receipt.json")
    attempt_directory = receipt_path.parent
    qualification_path = _regular_file(Path(qualification_receipt_path), "qualification receipt")
    if qualification_path.name != _QUALIFICATION_RECEIPT_NAME:
        raise ValueError("qualification receipt must be named qualification.json")
    if qualification_path.is_relative_to(attempt_directory):
        raise ValueError("qualification receipt must be outside the immutable realization attempt")

    realization_receipt_digest = _sha256_file(receipt_path)
    realization = _read_json(receipt_path, "realization receipt")
    _require_supported_receipt(realization, attempt_directory.name)
    if realization.get("revision_id") != revision.revision_id:
        raise ValueError("realization revision does not match the requested revision")
    if realization.get("revision_manifest") != revision.to_manifest():
        raise ValueError("realization revision manifest does not match the requested revision")

    artifacts = _mapping(realization.get("artifacts"), "realization artifacts")
    artifact_digests = _mapping(realization.get("artifact_digests"), "realization artifact_digests")
    claim_scopes = _mapping(realization.get("claim_scopes"), "realization claim_scopes")
    if dict(artifacts) != {"exact_brep": _BREP_NAME, "step": _STEP_NAME}:
        raise ValueError("realization does not bind the supported exact artifacts")
    if dict(claim_scopes) != {
        "exact_brep": "exact_occt_brep_derived_realization",
        "step": "derived_exchange_representation",
    }:
        raise ValueError("realization artifact claim scopes are unsupported")

    brep_path = _regular_file(attempt_directory / _BREP_NAME, "bound BREP")
    step_path = _regular_file(attempt_directory / _STEP_NAME, "bound STEP")
    brep_digest = _sha256_file(brep_path)
    step_digest = _sha256_file(step_path)
    if brep_digest != artifact_digests.get("exact_brep"):
        raise ValueError("BREP digest does not match the realization receipt")
    if step_digest != artifact_digests.get("step"):
        raise ValueError("STEP digest does not match the realization receipt")

    qualification_receipt_digest = _sha256_file(qualification_path)
    qualification = _read_json(qualification_path, "qualification receipt")
    _verify_qualification(
        qualification,
        revision_id=revision.revision_id,
        attempt_scope=attempt_directory.name,
        realization_receipt_digest=realization_receipt_digest,
        step_digest=step_digest,
    )

    try:
        brep_part = import_brep(brep_path)
        step_part = import_step(step_path)
    except Exception as exc:
        raise RuntimeError("bound exact artifact could not be imported") from exc
    expected_part = _source_native_part(revision)
    expected_inspection = _mapping(realization.get("inspection"), "realization inspection")
    _verify_source_geometry(expected_part, brep_part)
    _verify_source_geometry(expected_part, step_part)
    _verify_readback(_inspection(brep_part), expected_inspection)
    step_inspection = _inspection(step_part)
    _verify_readback(step_inspection, expected_inspection)
    _verify_readback(
        step_inspection,
        _mapping(qualification.get("readback"), "qualification readback"),
    )

    if _sha256_file(brep_path) != brep_digest or _sha256_file(step_path) != step_digest:
        raise RuntimeError("bound exact artifact changed during feasibility evaluation")
    if _sha256_file(receipt_path) != realization_receipt_digest:
        raise RuntimeError("realization receipt changed during feasibility evaluation")
    if _sha256_file(qualification_path) != qualification_receipt_digest:
        raise RuntimeError("qualification receipt changed during feasibility evaluation")

    return ExactCadFeasibilityDecision._derived(
        revision_id=revision.revision_id,
        attempt_scope=attempt_directory.name,
        realization_receipt_digest=realization_receipt_digest,
        qualification_receipt_digest=qualification_receipt_digest,
        artifact_digests={"exact_brep": brep_digest, "step": step_digest},
        receiver_profile=RECEIVER["profile"],
    )
