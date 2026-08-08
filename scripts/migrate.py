#!/usr/bin/env python3
"""Apply and verify Piton's local SQLite schema migrations."""

from __future__ import annotations

import argparse
from pathlib import Path

from piton.storage.db import Database, MigrationError


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", required=True, type=Path)
    parser.add_argument(
        "--check",
        action="store_true",
        help="apply pending migrations, then run schema and integrity checks",
    )
    args = parser.parse_args()

    database = Database(args.database)
    try:
        applied = database.migrate()
        problems = database.integrity_check() if args.check else ()
    except (MigrationError, OSError) as error:
        parser.exit(1, f"migration failed: {error}\n")
    if problems:
        parser.exit(1, "database check failed: " + "; ".join(problems) + "\n")
    print(f"schema_version={database.schema_version()} applied={applied} check=ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
