#!/usr/bin/env python3
"""Emit a deterministic, unreleased review receipt without executing project source."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from piton.launch_assets import (
    atomic_write_json,
    build_review_export,
    load_strict_json,
    validate_review_export,
    validated_project,
)


def parse_args() -> argparse.Namespace:
    if len(sys.argv) > 1 and sys.argv[1] == "validate":
        parser = argparse.ArgumentParser(description="Validate a deterministic review receipt.")
        parser.set_defaults(command="validate")
        parser.add_argument("command")
        parser.add_argument("receipt", type=Path)
        parser.add_argument("--project-dir", type=Path)
        return parser.parse_args()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.set_defaults(command="emit")
    parser.add_argument("project_dir", type=Path, help="strict canonical Piton project directory")
    parser.add_argument("--out", required=True, type=Path, help="receipt path outside the project directory")
    return parser.parse_args()


def _outside_project(project_dir: Path, output: Path) -> None:
    project = project_dir.resolve()
    destination = output.resolve()
    if destination == project or project in destination.parents:
        raise ValueError("receipt output must remain outside the canonical project directory")


def main() -> int:
    args = parse_args()
    try:
        if args.command == "validate":
            receipt = load_strict_json(args.receipt)
            project = validated_project(args.project_dir) if args.project_dir else None
            validate_review_export(receipt, project)
            print("review export receipt: VALID")
        else:
            _outside_project(args.project_dir, args.out)
            project = validated_project(args.project_dir)
            receipt = build_review_export(project)
            atomic_write_json(args.out.resolve(), receipt)
            print(args.out.resolve())
    except Exception as exc:
        print(f"review export rejected: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
