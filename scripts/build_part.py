#!/usr/bin/env python3
"""Build the Stage 1 L-bracket reference wedge and export a STEP file.

Usage:
  python3 scripts/build_part.py                       # build default params
  python3 scripts/build_part.py --out path/to.step   # custom output path
  python3 scripts/build_part.py --params-json '{...}'  # custom params

Emits:
  - dist/l_bracket_default.step (or --out path)
  - dist/l_bracket_manifest.json (parameter set identity + digests)

The .step file is a derived artifact, not a parallel authority. The
parameter set digest in the manifest identifies the canonical revision.
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path

from piton.parts.l_bracket import (
    DEFAULT_PARAMETERS,
    LBracketParameters,
    SCHEMA_ID,
    AUTHORITY_PROFILE,
    build_l_bracket,
    canonical_json_bytes,
    parameter_set_digest,
)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--out",
        type=Path,
        default=Path("dist/l_bracket_default.step"),
        help="Output STEP path (default: dist/l_bracket_default.step)",
    )
    p.add_argument(
        "--params-json",
        type=str,
        default=None,
        help="Optional JSON object with custom parameter values",
    )
    p.add_argument(
        "--source-path",
        type=Path,
        default=Path("src/piton/parts/l_bracket.py"),
        help="Path to the source file whose bytes feed source_manifest_digest",
    )
    return p.parse_args()


def build_parameters(args: argparse.Namespace) -> LBracketParameters:
    if args.params_json is None:
        return DEFAULT_PARAMETERS
    overrides = json.loads(args.params_json)
    defaults = asdict(DEFAULT_PARAMETERS)
    defaults.update(overrides)
    return LBracketParameters(**defaults)


def main() -> int:
    args = parse_args()
    params = build_parameters(args)
    source_path = args.source_path.resolve()
    if not source_path.exists():
        print(f"source file not found: {source_path}", file=sys.stderr)
        return 2

    part = build_l_bracket(params)
    bb = part.bounding_box()

    out_path: Path = args.out.resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    # Export STEP — build123d uses OCP serialization
    from build123d import export_step
    export_step(part, str(out_path))

    # Build manifest
    import hashlib
    source_digest = "sha256:" + hashlib.sha256(source_path.read_bytes()).hexdigest()
    step_bytes = out_path.read_bytes()
    step_digest = "sha256:" + hashlib.sha256(step_bytes).hexdigest()

    manifest = {
        "schema": SCHEMA_ID,
        "authority_profile": AUTHORITY_PROFILE,
        "part_class": "bracket",
        "wedge_class": "bracket",
        "source_path": str(source_path),
        "source_manifest_digest": source_digest,
        "step_path": str(out_path),
        "step_digest": step_digest,
        "step_size_bytes": len(step_bytes),
        "parameter_set": params.to_primitive_map(),
        "parameter_set_canonical_json": canonical_json_bytes(
            params.to_primitive_map()
        ).decode("utf-8"),
        "parameter_set_digest": parameter_set_digest(params),
        "geometry": {
            "bounding_box_mm": {
                "min": (bb.min.X, bb.min.Y, bb.min.Z),
                "max": (bb.max.X, bb.max.Y, bb.max.Z),
                "size": (bb.max.X - bb.min.X, bb.max.Y - bb.min.Y, bb.max.Z - bb.min.Z),
            },
            "volume_mm3": float(part.volume),
            "area_mm2": float(part.area),
        },
        "fabrication_release": False,
        "machine_actuation": False,
        "review_state": "needs_human_review",
    }

    manifest_path = out_path.with_name(out_path.stem + "_manifest.json")
    manifest_path.write_text(json.dumps(manifest, indent=2))

    print(json.dumps({
        "step_path": str(out_path),
        "manifest_path": str(manifest_path),
        "parameter_set_digest": manifest["parameter_set_digest"],
        "step_digest": step_digest,
        "step_size_bytes": len(step_bytes),
        "bounding_box_mm": manifest["geometry"]["bounding_box_mm"],
        "volume_mm3": manifest["geometry"]["volume_mm3"],
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())