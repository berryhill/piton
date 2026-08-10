#!/usr/bin/env python3
"""Build the fixed Stage 1 L-bracket review reference.

This utility has no parameter or source authority input. It always builds the
tracked DEFAULT_PARAMETERS from the fixed repository module. The STEP and
manifest are nonauthoritative, unreleased review artifacts.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import os
import platform
import re
import tempfile
from pathlib import Path
from typing import Any

from piton.parts import l_bracket as _l_bracket

ROOT = Path(__file__).resolve().parents[1]
DERIVED_OUTPUT_ROOT = (ROOT / "dist").resolve()
DETERMINISTIC_STEP_NAME = "piton-l-bracket-reference.step"
DETERMINISTIC_STEP_TIMESTAMP = "1970-01-01T00:00:00"

TRACKED_INPUT_CLOSURE = (
    "pyproject.toml",
    "uv.lock",
    "scripts/build_part.py",
    "src/piton/parts/l_bracket.py",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("dist/l_bracket_default.step"),
        help="derived STEP output path (default: dist/l_bracket_default.step)",
    )
    return parser.parse_args()


def _bind_repository_module() -> None:
    expected = (ROOT / "src" / "piton" / "parts" / "l_bracket.py").resolve(strict=True)
    module_file = getattr(_l_bracket, "__file__", None)
    try:
        actual = Path(module_file).resolve(strict=True) if module_file is not None else None
    except OSError:
        actual = None
    if actual != expected:
        raise RuntimeError("reference build module is not bound to tracked repository source")


def tracked_input_closure() -> tuple[list[dict[str, str]], str]:
    """Digest the fixed, repository-relative input closure with domain separation."""
    members: list[dict[str, str]] = []
    for relative in TRACKED_INPUT_CLOSURE:
        raw = (ROOT / relative).read_bytes()
        members.append({"path": relative, "digest": "sha256:" + hashlib.sha256(raw).hexdigest()})
    canonical = (json.dumps(members, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")
    digest = "sha256:" + hashlib.sha256(b"piton.reference-build-input-closure.v1\0" + canonical).hexdigest()
    return members, digest


def _reject_existing_output(path: Path) -> None:
    if os.path.lexists(path):
        raise FileExistsError(f"refusing to replace existing or symlinked output: {path}")


def _confine_output(path: Path) -> None:
    """Reject repository output outside dist before source is realized as geometry."""
    if path.suffix.lower() != ".step":
        raise ValueError("reference build output must use the .step suffix")
    if path.is_relative_to(ROOT) and not path.is_relative_to(DERIVED_OUTPUT_ROOT):
        raise ValueError(f"repository output must stay under derived output root: {DERIVED_OUTPUT_ROOT}")


def _normalize_step_header(step_bytes: bytes) -> bytes:
    """Remove exporter filename/time volatility while preserving the STEP body."""
    pattern = re.compile(rb"FILE_NAME\('[^']*','[^']*',")
    replacement = f"FILE_NAME('{DETERMINISTIC_STEP_NAME}','{DETERMINISTIC_STEP_TIMESTAMP}',".encode("ascii")
    normalized, count = pattern.subn(replacement, step_bytes, count=1)
    if count != 1:
        raise RuntimeError("STEP export did not contain exactly one normalizable FILE_NAME header")
    return normalized


def _distribution_version(name: str) -> str:
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return "not-installed"


def _publish_pair_without_overwrite(
    staged_step: Path,
    step_path: Path,
    staged_manifest: Path,
    manifest_path: Path,
) -> None:
    """Publish both artifacts without overwrite; remove our first link on second-link failure."""
    _reject_existing_output(step_path)
    _reject_existing_output(manifest_path)
    published_step = False
    try:
        os.link(staged_step, step_path)
        published_step = True
        os.link(staged_manifest, manifest_path)
    except Exception:
        if published_step:
            step_path.unlink(missing_ok=True)
        raise


def _manifest(
    *,
    out_path: Path,
    step_bytes: bytes,
    closure: list[dict[str, str]],
    closure_digest: str,
    params: Any,
    part: Any,
    bounding_box: Any,
) -> dict[str, Any]:
    step_digest = "sha256:" + hashlib.sha256(step_bytes).hexdigest()
    return {
        "schema": "piton.reference-build-manifest.v1",
        "source_contract": {
            "schema": _l_bracket.SCHEMA_ID,
            "authority_profile": _l_bracket.AUTHORITY_PROFILE,
        },
        "part_class": "bracket",
        "wedge_class": "bracket",
        "claim_scope": "nonauthoritative_review_reference_build",
        "claim_scope_exclusions": [
            "source_authority",
            "revision_acceptance",
            "approval",
            "fabrication_release",
            "machine_actuation",
        ],
        "release_state": "unreleased",
        "units": "mm",
        "runtime": {
            "python_implementation": platform.python_implementation(),
            "python_version": platform.python_version(),
            "build123d_version": _distribution_version("build123d"),
            "cadquery_ocp_version": _distribution_version("cadquery-ocp-novtk"),
        },
        "export_policy": {
            "format": "ISO-10303-21 STEP",
            "step_header_name": DETERMINISTIC_STEP_NAME,
            "step_header_timestamp": DETERMINISTIC_STEP_TIMESTAMP,
            "deterministic_header_normalization": True,
        },
        "tolerance_policy": {
            "geometry_claim": "exact_worker_realization_for_review",
            "manufacturing_tolerance_claimed": False,
            "manufacturing_method_selected": False,
        },
        "recipe": {
            "module": "piton.parts.l_bracket",
            "function": "build_l_bracket",
            "parameter_authority": "tracked_default_parameters",
        },
        "governed_authority": {
            "design_revision_id": None,
            "build_attempt_id": None,
            "authored_state_mutated": False,
        },
        "tracked_input_closure": closure,
        "tracked_input_closure_digest": closure_digest,
        "step_path": str(out_path),
        "step_digest": step_digest,
        "step_size_bytes": len(step_bytes),
        "parameter_set": params.to_primitive_map(),
        "parameter_set_canonical_json": _l_bracket.canonical_json_bytes(params.to_primitive_map()).decode("utf-8"),
        "parameter_set_digest": _l_bracket.parameter_set_digest(params),
        "geometry": {
            "bounding_box_mm": {
                "min": (bounding_box.min.X, bounding_box.min.Y, bounding_box.min.Z),
                "max": (bounding_box.max.X, bounding_box.max.Y, bounding_box.max.Z),
                "size": (
                    bounding_box.max.X - bounding_box.min.X,
                    bounding_box.max.Y - bounding_box.min.Y,
                    bounding_box.max.Z - bounding_box.min.Z,
                ),
            },
            "volume_mm3": float(part.volume),
            "area_mm2": float(part.area),
        },
        "fabrication_release": False,
        "machine_actuation": False,
        "review_state": "needs_human_review",
    }


def main() -> int:
    args = parse_args()
    _bind_repository_module()
    requested_out = args.out.expanduser()
    if not requested_out.is_absolute():
        requested_out = Path.cwd() / requested_out
    out_path = requested_out.parent.resolve() / requested_out.name
    manifest_path = out_path.with_name(out_path.stem + "_manifest.json")
    _confine_output(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    _reject_existing_output(out_path)
    _reject_existing_output(manifest_path)

    closure_before, closure_digest_before = tracked_input_closure()
    params = _l_bracket.DEFAULT_PARAMETERS
    part = _l_bracket.build_l_bracket(params)
    bounding_box = part.bounding_box()

    from build123d import export_step

    with tempfile.TemporaryDirectory(prefix=".piton-reference-build-", dir=out_path.parent) as temporary:
        temporary_dir = Path(temporary)
        staged_step = temporary_dir / "part.step"
        staged_manifest = temporary_dir / "manifest.json"
        export_step(part, str(staged_step))
        step_bytes = _normalize_step_header(staged_step.read_bytes())
        staged_step.write_bytes(step_bytes)
        manifest = _manifest(
            out_path=out_path,
            step_bytes=step_bytes,
            closure=closure_before,
            closure_digest=closure_digest_before,
            params=params,
            part=part,
            bounding_box=bounding_box,
        )
        closure_after, closure_digest_after = tracked_input_closure()
        if closure_after != closure_before or closure_digest_after != closure_digest_before:
            raise RuntimeError("tracked reference-build input closure changed during execution")
        staged_manifest.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        _publish_pair_without_overwrite(staged_step, out_path, staged_manifest, manifest_path)

    print(
        json.dumps(
            {
                "step_path": str(out_path),
                "manifest_path": str(manifest_path),
                "tracked_input_closure_digest": closure_digest_before,
                "parameter_set_digest": manifest["parameter_set_digest"],
                "step_digest": manifest["step_digest"],
                "review_state": "needs_human_review",
                "fabrication_release": False,
                "machine_actuation": False,
            },
            indent=2,
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
