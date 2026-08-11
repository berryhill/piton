#!/usr/bin/env python3
from __future__ import annotations
import json
import tempfile
from dataclasses import fields
from importlib.resources import files
from pathlib import Path

from jsonschema import Draft202012Validator

import piton.storage as storage
from piton import DraftExport, FrameworkPacketClosure, HumanReviewIntake
from piton.implementation_loop import PITON_IMPLEMENTATION_LOOP
from piton.launch_assets import build_review_export
from piton.launch_verification import (
    CURRENT_PRECISION_WORKER_OUTPUTS,
    CURRENT_PRECISION_WORKER_PIN,
    validate_launch_worker_contract,
)
from piton.model import TruthBoundary
from piton.project_format import PitonProject, ProjectAuthority, ProjectSafety, SourceFile
from piton.review_packet import ReviewPacket, build_review_packet, validate_review_packet
from piton.portfolio.partner_scaffold_t001 import (
    PartnerScaffoldT001Receipt,
    validate_partner_scaffold_t001,
)
from piton.storage import BuildAdmission, BuildAttemptCoordinator, Database
from piton.worker_contracts import PrecisionWorkerRequest

PITON_IMPLEMENTATION_LOOP.validate()
TruthBoundary().assert_safe()
if not callable(build_review_packet) or not callable(validate_review_packet):
    raise SystemExit("installed review-packet API is unavailable")
if ReviewPacket.__name__ != "ReviewPacket":
    raise SystemExit("installed review-packet type is unavailable")
package_root = files("piton")
viewer_assets = ("index.html", "viewer.js", "viewer.css", "THIRD_PARTY_NOTICES.txt")
for asset_name in viewer_assets:
    asset_bytes = package_root.joinpath("viewer_assets", asset_name).read_bytes()
    if not asset_bytes:
        raise SystemExit(f"installed viewer asset is empty: {asset_name}")
viewer_surface = (
    package_root.joinpath("viewer_assets", "index.html").read_text(encoding="utf-8")
    + package_root.joinpath("viewer_assets", "viewer.js").read_text(encoding="utf-8")
)
if "default-src 'none'" not in viewer_surface or "connect-src 'none'" not in viewer_surface:
    raise SystemExit("installed viewer assets omit disconnected CSP")
if "https://" in viewer_surface or "http://" in viewer_surface:
    raise SystemExit("installed viewer assets contain a network URL")
for schema_name in (
    "draft-export-receipt-v1.schema.json",
    "review-packet-v1.schema.json",
    "semantic-selection-map-v1.schema.json",
    "human-review-intake-v1.schema.json",
    "framework-packet-closure-v1.schema.json",
):
    schema = json.loads(package_root.joinpath("schemas", schema_name).read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
try:
    validate_launch_worker_contract(
        CURRENT_PRECISION_WORKER_PIN,
        CURRENT_PRECISION_WORKER_OUTPUTS,
    )
except ValueError as error:
    raise SystemExit(str(error)) from error
receipt = PartnerScaffoldT001Receipt()
if not validate_partner_scaffold_t001(receipt):
    raise SystemExit("installed T001 scaffold failed zero-claim validation")

digest = "sha256:" + "0" * 64
draft_export = DraftExport(
    receipt_id="install-smoke-draft-receipt",
    export_id="install-smoke-draft-export",
    project_id="install-smoke",
    revision_id="rev_" + "0" * 64,
    attempt_id="attempt_smoke",
    authority_profile="source-native/v0",
    exact_body_digest=digest,
    step_digest=digest,
    units="mm",
    warnings=("Framework-only unreleased draft export.",),
    environment_lock_digest=digest,
    validation_report_digest=digest,
)
draft_export_schema = json.loads(
    package_root.joinpath("schemas", "draft-export-receipt-v1.schema.json").read_text(
        encoding="utf-8"
    )
)
draft_export_payload = json.loads(draft_export.canonical_bytes)
Draft202012Validator(draft_export_schema).validate(draft_export_payload)
if draft_export_payload != draft_export.to_primitive():
    raise SystemExit("installed DraftExport canonical serialization is unstable")
human_review_intake = HumanReviewIntake(
    intake_id="install-smoke-intake",
    project_id="install-smoke",
    revision_id="rev_" + "0" * 64,
    attempt_id="attempt_smoke",
    evidence_closure_digest=digest,
    review_packet_digest=digest,
    review_scope=("Verify installed review intake",),
)
human_review_schema = json.loads(
    package_root.joinpath("schemas", "human-review-intake-v1.schema.json").read_text(
        encoding="utf-8"
    )
)
Draft202012Validator(human_review_schema).validate(human_review_intake.to_primitive())
if (
    human_review_intake.review_state != "needs_human_review"
    or human_review_intake.fabrication_release is not False
    or human_review_intake.machine_actuation is not False
):
    raise SystemExit("installed human-review intake API violated safety truth")
framework_packet_closure = FrameworkPacketClosure(
    closure_id="install-smoke-framework-closure",
    project_id="install-smoke",
    revision_id="rev_" + "0" * 64,
    attempt_id="attempt_smoke",
    evidence_closure_digest=digest,
    review_packet_digest=digest,
    worker_result_digest=digest,
    declaration_digest=digest,
    generation=0,
    fence=0,
    lease_id="lease_smoke",
    exact_brep_digest=digest,
    step_digest=digest,
    review_glb_digest=digest,
    review_selection_map_digest=digest,
)
framework_closure_schema = json.loads(
    package_root.joinpath(
        "schemas", "framework-packet-closure-v1.schema.json"
    ).read_text(encoding="utf-8")
)
Draft202012Validator(framework_closure_schema).validate(
    framework_packet_closure.to_primitive()
)
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
                "AND name IN ('build_attempts','build_coordinator_state',"
                "'evidence_check_declarations','evidence_check_receipts',"
                "'evidence_closures','evidence_closure_receipts',"
                "'evidence_closure_artifacts')"
            )
        }
        durable_triggers = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='trigger' "
                "AND (name='build_attempts_no_duplicate_insert' "
                "OR name GLOB 'evidence_*_no_*')"
            )
        }
    expected_tables = {
        "build_attempts",
        "build_coordinator_state",
        "evidence_check_declarations",
        "evidence_check_receipts",
        "evidence_closures",
        "evidence_closure_receipts",
        "evidence_closure_artifacts",
    }
    expected_triggers = {
        "build_attempts_no_duplicate_insert",
        "evidence_check_declarations_no_update",
        "evidence_check_declarations_no_duplicate_insert",
        "evidence_check_declarations_no_delete",
        "evidence_closures_no_update",
        "evidence_closures_no_duplicate_insert",
        "evidence_closures_no_delete",
        "evidence_check_receipts_no_update",
        "evidence_check_receipts_no_duplicate_insert",
        "evidence_check_receipts_no_delete",
        "evidence_closure_receipts_no_update",
        "evidence_closure_receipts_no_delete",
        "evidence_closure_artifacts_no_update",
        "evidence_closure_artifacts_no_delete",
    }
    if durable_tables != expected_tables:
        raise SystemExit("installed build-attempt/evidence-closure custody schema is incomplete")
    if durable_triggers != expected_triggers:
        raise SystemExit("installed build-attempt/evidence-closure immutability guards are incomplete")

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
            "evidence_closure_custody": sorted(
                table for table in durable_tables if table.startswith("evidence_")
            ),
            "launch_asset_package": launch_receipt["schema"],
            "draft_export_api": draft_export_payload["schema"],
            "review_packet_api": "piton.review-packet.v1",
            "review_packet_schemas": [
                "review-packet-v1.schema.json",
                "semantic-selection-map-v1.schema.json",
            ],
            "human_review_intake_api": human_review_intake.to_primitive()["schema"],
            "framework_packet_closure_api": framework_packet_closure.to_primitive()[
                "schema"
            ],
            "viewer_assets": list(viewer_assets),
            "precision_worker_request": worker_request.schema,
            "precision_worker_pin": worker_request.worker_pin,
            "precision_worker_roles": list(worker_request.expected_outputs),
            "steps": len(PITON_IMPLEMENTATION_LOOP.steps),
            "t001_zero_claim": True,
        },
        sort_keys=True,
    )
)
