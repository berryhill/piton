"""Pinned trusted-local exact realization for the Stage 1 source-native Part.

The Python source revision remains the only writable design authority. BREP and
STEP files emitted here are immutable, attempt-scoped derivatives and carry no
review, approval, release, or machine-actuation authority.
"""
from __future__ import annotations

import hashlib
import importlib.metadata
import json
import os
import platform
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from build123d import export_brep, export_step

from .parts.l_bracket import (
    LBracketParameters,
    build_l_bracket,
    parameter_set_digest,
)
from .revision import DesignRevision

EXPECTED_TOOLCHAIN = {
    "python": "3.12.11",
    "build123d": "0.11.1",
    "cadquery-ocp-novtk": "7.9.3.1",
}
ENTRYPOINT = "piton.parts.l_bracket:build_l_bracket"
EXACT_BREP_NAME = "part.brep"
STEP_NAME = "part.step"
RECEIPT_NAME = "receipt.json"
_STEP_TIMESTAMP = "1970-01-01T00:00:00+00:00"


def _sha256_bytes(value: bytes) -> str:
    return "sha256:" + hashlib.sha256(value).hexdigest()


def _sha256_file(path: Path) -> str:
    return _sha256_bytes(path.read_bytes())


@dataclass(frozen=True)
class RealizationInputs:
    """Identity-bearing immutable inputs admitted to one realization attempt."""

    repository_root: Path
    source_path: Path
    dependency_lock_path: Path
    toolchain_lock_path: Path
    parameters: LBracketParameters
    revision: DesignRevision

    @classmethod
    def from_repository(
        cls,
        repository_root: Path,
        parameters: LBracketParameters,
    ) -> "RealizationInputs":
        root = repository_root.resolve(strict=True)
        source_path = (root / "src/piton/parts/l_bracket.py").resolve(strict=True)
        dependency_lock_path = (root / "uv.lock").resolve(strict=True)
        toolchain_lock_path = (root / "pyproject.toml").resolve(strict=True)
        revision = DesignRevision(
            parent_revision_id=None,
            source_manifest_digest=_sha256_file(source_path),
            entrypoint=ENTRYPOINT,
            dependency_lock_digest=_sha256_file(dependency_lock_path),
            toolchain_lock_digest=_sha256_file(toolchain_lock_path),
            parameter_values=parameters.to_primitive_map(),
        )
        return cls(
            repository_root=root,
            source_path=source_path,
            dependency_lock_path=dependency_lock_path,
            toolchain_lock_path=toolchain_lock_path,
            parameters=parameters,
            revision=revision,
        )


def _verify_toolchain() -> dict[str, str]:
    actual = {
        "python": platform.python_version(),
        "build123d": importlib.metadata.version("build123d"),
        "cadquery-ocp-novtk": importlib.metadata.version("cadquery-ocp-novtk"),
    }
    if actual != EXPECTED_TOOLCHAIN:
        raise RuntimeError(
            "exact realization blocked by toolchain mismatch: "
            + json.dumps({"actual": actual, "expected": EXPECTED_TOOLCHAIN}, sort_keys=True)
        )
    return actual


def _verify_inputs(revision: DesignRevision, inputs: RealizationInputs) -> dict[str, str]:
    """Fail closed on every identity-bearing input before building geometry."""
    if not isinstance(revision, DesignRevision):
        raise TypeError("revision must be a DesignRevision")
    identity_fields = (
        "source_manifest_digest",
        "dependency_lock_digest",
        "toolchain_lock_digest",
        "entrypoint",
        "parameter_values",
    )
    for field_name in identity_fields:
        if getattr(revision, field_name) != getattr(inputs.revision, field_name):
            raise ValueError(f"{field_name} does not match admitted realization inputs")
    if revision.revision_id != inputs.revision.revision_id:
        raise ValueError("revision_id does not match admitted realization inputs")

    digests = {
        "source_manifest": _sha256_file(inputs.source_path),
        "dependency_lock": _sha256_file(inputs.dependency_lock_path),
        "toolchain_lock": _sha256_file(inputs.toolchain_lock_path),
        "parameter_set": parameter_set_digest(inputs.parameters),
    }
    expected = {
        "source_manifest": revision.source_manifest_digest,
        "dependency_lock": revision.dependency_lock_digest,
        "toolchain_lock": revision.toolchain_lock_digest,
        "parameter_set": parameter_set_digest(inputs.parameters),
    }
    for name, actual_digest in digests.items():
        if actual_digest != expected[name]:
            raise ValueError(f"{name}_digest does not match the immutable revision")
    if revision.entrypoint != ENTRYPOINT:
        raise ValueError("entrypoint does not match the pinned exact-realization entrypoint")
    if dict(revision.parameter_values) != inputs.parameters.to_primitive_map():
        raise ValueError("parameter_values do not match the immutable revision")
    return digests


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


def realize_exact(
    revision: DesignRevision,
    inputs: RealizationInputs,
    attempt_directory: Path,
) -> dict[str, Any]:
    """Realize exact BREP and STEP derivatives into one new attempt directory."""
    input_digests = _verify_inputs(revision, inputs)
    toolchain = _verify_toolchain()

    attempt_directory = attempt_directory.resolve()
    if attempt_directory.exists():
        raise FileExistsError("attempt_directory must be new and attempt-scoped")
    attempt_directory.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(
        tempfile.mkdtemp(prefix=f".{attempt_directory.name}.staging-", dir=attempt_directory.parent)
    )

    try:
        part = build_l_bracket(inputs.parameters)
        inspection = _inspection(part)
        if not inspection["valid"] or inspection["topology_counts"]["solids"] != 1:
            raise RuntimeError("exact realization did not produce one valid solid")

        brep_path = staging / EXACT_BREP_NAME
        step_path = staging / STEP_NAME
        if export_brep(part, brep_path) is not True:
            raise RuntimeError("exact BREP export failed")
        if export_step(part, step_path, timestamp=_STEP_TIMESTAMP) is not True:
            raise RuntimeError("STEP export failed")

        receipt: dict[str, Any] = {
            "schema": "piton.exact-realization-receipt.v1",
            "status": "succeeded",
            "attempt_scope": attempt_directory.name,
            "revision_id": revision.revision_id,
            "revision_manifest": revision.to_manifest(),
            "authority": {
                "writable_design_authority": "source-native Python",
                "realization_is_derived": True,
            },
            "isolation_class": "trusted-local",
            "toolchain": toolchain,
            "environment": {
                "platform": platform.platform(),
                "machine": platform.machine(),
                "python_implementation": platform.python_implementation(),
                "geometry_backend": "OCCT via cadquery-ocp-novtk",
            },
            "units": "mm",
            "input_digests": input_digests,
            "artifacts": {
                "exact_brep": EXACT_BREP_NAME,
                "step": STEP_NAME,
            },
            "artifact_digests": {
                "exact_brep": _sha256_file(brep_path),
                "step": _sha256_file(step_path),
            },
            "claim_scopes": {
                "exact_brep": "exact_occt_brep_derived_realization",
                "step": "derived_exchange_representation",
            },
            "inspection": inspection,
            "review_state": "needs_human_review",
            "fabrication_release": False,
            "machine_actuation": False,
        }
        (staging / RECEIPT_NAME).write_text(
            json.dumps(receipt, indent=2, sort_keys=True, allow_nan=False) + "\n",
            encoding="utf-8",
        )
        os.replace(staging, attempt_directory)
        return receipt
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise
