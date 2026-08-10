#!/usr/bin/env python3
from __future__ import annotations
import json
import tempfile
from dataclasses import fields
from pathlib import Path

import piton.storage as storage
from piton.implementation_loop import PITON_IMPLEMENTATION_LOOP
from piton.model import TruthBoundary
from piton.portfolio.partner_scaffold_t001 import (
    PartnerScaffoldT001Receipt,
    validate_partner_scaffold_t001,
)
from piton.storage import BuildAdmission, BuildAttemptCoordinator, Database

PITON_IMPLEMENTATION_LOOP.validate()
TruthBoundary().assert_safe()
receipt = PartnerScaffoldT001Receipt()
if not validate_partner_scaffold_t001(receipt):
    raise SystemExit("installed T001 scaffold failed zero-claim validation")

with tempfile.TemporaryDirectory() as temporary_directory:
    database = Database(Path(temporary_directory) / "piton.sqlite3")
    database.migrate()
    BuildAttemptCoordinator(database)
    if "attempt_id" in {field.name for field in fields(BuildAdmission)}:
        raise SystemExit("installed build admission accepts caller-supplied attempt identity")
    if hasattr(storage, "_issue_server_admission_capability"):
        raise SystemExit("installed storage API publicly exports admission capability issuance")
    with database.read() as connection:
        durable_tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table' "
                "AND name IN ('build_attempts','build_coordinator_state')"
            )
        }
        durable_triggers = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='trigger' "
                "AND name='build_attempts_no_duplicate_insert'"
            )
        }
    if durable_tables != {"build_attempts", "build_coordinator_state"}:
        raise SystemExit("installed build-attempt custody schema is incomplete")
    if durable_triggers != {"build_attempts_no_duplicate_insert"}:
        raise SystemExit("installed build-attempt replacement guard is incomplete")

print(
    json.dumps(
        {
            "fabrication_release": receipt.fabrication_release,
            "flow_id": PITON_IMPLEMENTATION_LOOP.flow_id,
            "machine_actuation": receipt.machine_actuation,
            "ok": True,
            "review_state": receipt.review_state,
            "build_attempt_custody": sorted(durable_tables),
            "build_attempt_replacement_guard": sorted(durable_triggers),
            "steps": len(PITON_IMPLEMENTATION_LOOP.steps),
            "t001_zero_claim": True,
        },
        sort_keys=True,
    )
)
