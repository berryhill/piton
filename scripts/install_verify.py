#!/usr/bin/env python3
from __future__ import annotations
import importlib.util
import json
import tempfile
from dataclasses import fields
from pathlib import Path

import piton.storage as storage
from piton.implementation_loop import PITON_IMPLEMENTATION_LOOP
from piton.launch_assets import build_review_export
from piton.launch_verification import (
    CURRENT_PRECISION_WORKER_OUTPUTS,
    CURRENT_PRECISION_WORKER_PIN,
    validate_precision_worker_source,
)
from piton.model import TruthBoundary
from piton.project_format import PitonProject, ProjectAuthority, ProjectSafety, SourceFile
from piton.portfolio.partner_scaffold_t001 import (
    PartnerScaffoldT001Receipt,
    validate_partner_scaffold_t001,
)
from piton.storage import BuildAdmission, BuildAttemptCoordinator, Database
from piton.worker_contracts import PrecisionWorkerRequest

PITON_IMPLEMENTATION_LOOP.validate()
TruthBoundary().assert_safe()
worker_spec = importlib.util.find_spec("piton.precision_worker")
if worker_spec is None or worker_spec.origin is None:
    raise SystemExit("installed precision-worker source is missing")
try:
    validate_precision_worker_source(Path(worker_spec.origin))
except (OSError, SyntaxError, ValueError) as error:
    raise SystemExit(str(error)) from error
receipt = PartnerScaffoldT001Receipt()
if not validate_partner_scaffold_t001(receipt):
    raise SystemExit("installed T001 scaffold failed zero-claim validation")

digest = "sha256:" + "0" * 64
worker_request = PrecisionWorkerRequest(
    project_id="install-smoke",
    revision_id="rev_" + "0" * 64,
    attempt_id="attempt_smoke",
    generation=0,
    fence=0,
    lease_id="lease_smoke",
    input_manifest_digest=digest,
    recipe_digest=digest,
    toolchain_digest=digest,
    capability_manifest_digest=digest,
    resource_limits_digest=digest,
    expected_outputs_digest=digest,
    request_signature_ref=digest,
    worker_id="precision_worker_one",
    worker_pin=CURRENT_PRECISION_WORKER_PIN,
    isolation_class="trusted-local",
    expected_outputs=CURRENT_PRECISION_WORKER_OUTPUTS,
)
if PrecisionWorkerRequest.from_manifest(worker_request.to_manifest()) != worker_request:
    raise SystemExit("installed precision-worker request contract failed canonical round trip")
install_project = PitonProject(
    project_id="install-smoke",
    units="mm",
    authority=ProjectAuthority(
        writable="source-native-python",
        entrypoint="source/part.py",
        dependency_lock="locks/dependencies.lock",
        toolchain_lock="locks/toolchain.lock",
    ),
    source_files=(
        SourceFile("source/part.py", digest, "text/x-python", "lf"),
        SourceFile("locks/dependencies.lock", digest, "text/plain", "lf"),
        SourceFile("locks/toolchain.lock", digest, "text/plain", "lf"),
    ),
    records=(),
    safety=ProjectSafety("needs_human_review", False, False),
)
launch_receipt = build_review_export(install_project)
if launch_receipt["safety"] != {
    "review_state": "needs_human_review",
    "fabrication_release": False,
    "machine_actuation": False,
}:
    raise SystemExit("installed launch-asset receipt violated safety truth")

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
            "launch_asset_package": launch_receipt["schema"],
            "precision_worker_request": worker_request.schema,
            "precision_worker_pin": worker_request.worker_pin,
            "precision_worker_roles": list(worker_request.expected_outputs),
            "steps": len(PITON_IMPLEMENTATION_LOOP.steps),
            "t001_zero_claim": True,
        },
        sort_keys=True,
    )
)
