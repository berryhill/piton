#!/usr/bin/env python3
"""Emit or validate an immutable-history restore-forward request packet."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from piton.launch_assets import (
    atomic_write_json,
    build_restore_forward,
    load_strict_json,
    validate_restore_forward,
    validated_project,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    emit = commands.add_parser("emit", help="emit a request for a new review candidate")
    emit.add_argument("project_dir", type=Path)
    emit.add_argument("accepted_project_dir", type=Path)
    emit.add_argument("--out", required=True, type=Path, help="packet path outside the project directory")
    validate = commands.add_parser("validate", help="validate packet identity and optional project custody")
    validate.add_argument("packet", type=Path)
    validate.add_argument("--project-dir", type=Path)
    return parser.parse_args()


def _outside_project(project_dir: Path, output: Path) -> None:
    project = project_dir.resolve()
    destination = output.resolve()
    if destination == project or project in destination.parents:
        raise ValueError("request output must remain outside the canonical project directory")


def main() -> int:
    args = parse_args()
    try:
        if args.command == "emit":
            _outside_project(args.project_dir, args.out)
            _outside_project(args.accepted_project_dir, args.out)
            project = validated_project(args.project_dir)
            accepted_project = validated_project(args.accepted_project_dir)
            packet = build_restore_forward(project, accepted_project)
            atomic_write_json(args.out.resolve(), packet)
            print(args.out.resolve())
        else:
            packet = load_strict_json(args.packet)
            project = validated_project(args.project_dir) if args.project_dir else None
            validate_restore_forward(packet, project)
            print("restore-forward request: VALID")
    except Exception as exc:
        print(f"restore-forward request rejected: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
