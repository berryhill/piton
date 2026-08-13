#!/usr/bin/env python3
from __future__ import annotations

import json
import pathlib
import subprocess
import sys
from dataclasses import replace

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from jsonschema import Draft202012Validator, ValidationError
from piton.assurance import (
    DEFAULT_P4_ASSURANCE_POLICY,
    GovernedAlphaEvidence,
    P4AssuranceEvidence,
    P4AssurancePolicy,
    P4AssuranceReceipt,
    emit_unavailable_p4_receipts,
    validate_p4_evidence_policy_binding,
)
from piton.human_review import FrameworkPacketClosure, HumanReviewIntake
from piton.implementation_loop import RetryErrorPacket
from piton.launch_assets import (
    build_restore_forward,
    build_review_export,
    validate_restore_forward,
    validate_review_export,
)
from piton.launch_verification import validate_launch_worker_contract
from piton.model import DraftExport
from piton.precision_worker import EXPECTED_OUTPUTS, PRECISION_WORKER_PIN
from piton.project_format import load_project_directory
from piton.revision import DesignRevision
from piton.seeded_readiness import (
    CRITICAL_COUNTER_NAMES,
    ReadinessPacketClosure,
    close_readiness_packet,
    run_readiness_campaign,
)
from piton.supply_chain import verify_first_party_supply_chain

REQUIRED = [
    ROOT / "AGENTS.md",
    ROOT / ".otoxan/context.md",
    ROOT / ".otoxan/rules/safety.md",
    ROOT / ".otoxan/flows/piton-implementation-loop-v1.md",
    ROOT / "src/piton/model.py",
    ROOT / "src/piton/revision.py",
    ROOT / "src/piton/implementation_loop.py",
    ROOT / "src/piton/storage/build_attempts.py",
    ROOT / "src/piton/storage/custody.py",
    ROOT / "src/piton/storage/_backup_identity_process.py",
    ROOT / "src/piton/worker_contracts.py",
    ROOT / "src/piton/precision_worker.py",
    ROOT / "src/piton/evidence.py",
    ROOT / "src/piton/assurance.py",
    ROOT / "src/piton/mesh_derivatives.py",
    ROOT / "src/piton/launch_verification.py",
    ROOT / "src/piton/supply_chain.py",
    ROOT / "src/piton/review_packet.py",
    ROOT / "src/piton/browser_qualification.py",
    ROOT / "src/piton/human_review.py",
    ROOT / "src/piton/service/daemon.py",
    ROOT / "src/piton/viewer_assets/index.html",
    ROOT / "src/piton/viewer_assets/viewer.js",
    ROOT / "src/piton/viewer_assets/viewer.css",
    ROOT / "src/piton/viewer_assets/THIRD_PARTY_NOTICES.txt",
    ROOT / "src/piton/storage/migrations/0005_durable_build_attempts.sql",
    ROOT / "src/piton/storage/migrations/0006_evidence_closure.sql",
    ROOT / "src/piton/storage/migrations/0007_durable_leases.sql",
    ROOT / "src/piton/storage/migrations/0008_cancellation_lease_custody.sql",
    ROOT / "src/piton/storage/migrations/0009_crash_safe_publication.sql",
    ROOT / "src/piton/storage/migrations/0010_destructive_custody_admission.sql",
    ROOT / "tests/test_build_attempt_admission.py",
    ROOT / "tests/contract/test_precision_worker_custody.py",
    ROOT / "tests/contract/test_worker_contracts.py",
    ROOT / "tests/geometry/test_precision_worker.py",
    ROOT / "tests/unit/test_check_receipts.py",
    ROOT / "tests/integration/test_evidence_closure.py",
    ROOT / "tests/test_mesh_derivatives.py",
    ROOT / "tests/test_review_packet.py",
    ROOT / "tests/test_browser_qualification.py",
    ROOT / "tests/test_human_review_intake.py",
    ROOT / "tests/test_framework_packet_closure.py",
    ROOT / "tests/integration/test_daemon_command_admission.py",
    ROOT / "tests/integration/test_backup_restore_retention_deletion.py",
    ROOT / "tests/test_assurance_policy.py",
    ROOT / "flows/piton_implementation_loop_v1.json",
    ROOT / "schemas/retry-error-packet-v1.schema.json",
    ROOT / "schemas/design-revision-v1.schema.json",
    ROOT / "schemas/piton-project-v1.schema.json",
    ROOT / "schemas/draft-export-receipt-v1.schema.json",
    ROOT / "schemas/review-export-receipt-v1.schema.json",
    ROOT / "schemas/restore-forward-request-v1.schema.json",
    ROOT / "schemas/review-packet-v1.schema.json",
    ROOT / "schemas/browser-qualification-receipt-v1.schema.json",
    ROOT / "schemas/semantic-selection-map-v1.schema.json",
    ROOT / "schemas/human-review-intake-v1.schema.json",
    ROOT / "schemas/framework-packet-closure-v1.schema.json",
    ROOT / "schemas/readiness-packet-closure-v1.schema.json",
    ROOT / "schemas/governed-alpha-evidence-v1.schema.json",
    ROOT / "schemas/p4-assurance-policy-v1.schema.json",
    ROOT / "schemas/p4-assurance-evidence-v1.schema.json",
    ROOT / "schemas/p4-assurance-receipt-v1.schema.json",
    ROOT / "src/piton/schemas/governed-alpha-evidence-v1.schema.json",
    ROOT / "src/piton/schemas/p4-assurance-policy-v1.schema.json",
    ROOT / "src/piton/schemas/p4-assurance-evidence-v1.schema.json",
    ROOT / "src/piton/schemas/p4-assurance-receipt-v1.schema.json",
    ROOT / "src/piton/schemas/review-export-receipt-v1.schema.json",
    ROOT / "src/piton/schemas/restore-forward-request-v1.schema.json",
    ROOT / "src/piton/schemas/review-packet-v1.schema.json",
    ROOT / "src/piton/schemas/browser-qualification-receipt-v1.schema.json",
    ROOT / "src/piton/schemas/semantic-selection-map-v1.schema.json",
    ROOT / "src/piton/schemas/human-review-intake-v1.schema.json",
    ROOT / "src/piton/schemas/framework-packet-closure-v1.schema.json",
    ROOT / "src/piton/schemas/readiness-packet-closure-v1.schema.json",
    ROOT / "src/piton/schemas/draft-export-receipt-v1.schema.json",
    ROOT / "scripts/review_export.py",
    ROOT / "scripts/restore_forward.py",
    ROOT / "scripts/build_part.py",
    ROOT / "scripts/doctor.py",
    ROOT / "scripts/install_verify.py",
    ROOT / "templates/evidence-record-v1.json",
    ROOT / "templates/artifact-manifest-v1.json",
    ROOT / "docs/architecture.md",
    ROOT / "docs/human-review-launch-assets.md",
    ROOT / "docs/rollback.md",
    ROOT / "docs/fabrication-safety.md",
    ROOT / "docs/threat-model.md",
    ROOT / "tests/test_launch_assets.py",
    ROOT / "tests/test_supply_chain_gate.py",
    ROOT / ".github/workflows/ci.yml",
]

missing = [str(path.relative_to(ROOT)) for path in REQUIRED if not path.is_file()]
if missing:
    raise SystemExit("missing required files: " + ", ".join(missing))

supply_chain_receipt = verify_first_party_supply_chain(ROOT)
if (
    supply_chain_receipt.status != "pass"
    or supply_chain_receipt.review_state != "needs_human_review"
    or supply_chain_receipt.fabrication_release is not False
    or supply_chain_receipt.machine_actuation is not False
):
    raise SystemExit("first-party supply-chain gate violated root safety truth")

try:
    validate_launch_worker_contract(PRECISION_WORKER_PIN, EXPECTED_OUTPUTS)
except ValueError as error:
    raise SystemExit(str(error)) from error

for schema_name in (
    "draft-export-receipt-v1.schema.json",
    "review-export-receipt-v1.schema.json",
    "restore-forward-request-v1.schema.json",
    "review-packet-v1.schema.json",
    "browser-qualification-receipt-v1.schema.json",
    "semantic-selection-map-v1.schema.json",
    "human-review-intake-v1.schema.json",
    "framework-packet-closure-v1.schema.json",
    "readiness-packet-closure-v1.schema.json",
    "governed-alpha-evidence-v1.schema.json",
    "p4-assurance-policy-v1.schema.json",
    "p4-assurance-evidence-v1.schema.json",
    "p4-assurance-receipt-v1.schema.json",
):
    repository_schema = (ROOT / "schemas" / schema_name).read_bytes()
    packaged_schema = (ROOT / "src" / "piton" / "schemas" / schema_name).read_bytes()
    if packaged_schema != repository_schema:
        raise SystemExit(f"packaged launch schema drift: {schema_name}")

flow_path = ROOT / "flows/piton_implementation_loop_v1.json"
json.loads(flow_path.read_text(encoding="utf-8"))

artifact_manifest = json.loads(
    (ROOT / "templates" / "artifact-manifest-v1.json").read_text(encoding="utf-8")
)
closure_template = artifact_manifest.get("evidence_closure", {})
expected_checks = [
    "exact-artifact-closure",
    "one-valid-solid",
    "review-artifact-binding",
]
receipts = closure_template.get("ordered_check_receipts", [])
if [receipt.get("check_id") for receipt in receipts] != expected_checks:
    raise SystemExit("artifact manifest does not preserve evidence declaration order")
required_receipt_fields = {
    "check_id",
    "status",
    "receipt_digest",
    "method",
    "units",
    "tolerance",
    "checker_digest",
    "comparator_digest",
    "environment_digest",
    "evidence_roles",
    "invalidation_conditions",
}
if any(set(receipt) != required_receipt_fields for receipt in receipts):
    raise SystemExit("artifact manifest check receipt bindings are incomplete")
if closure_template.get("channel_transition") is not False or closure_template.get(
    "release_consequence"
) != "none":
    raise SystemExit("artifact manifest implies a forbidden closure consequence")
packet_evidence = artifact_manifest.get("review_packet_evidence", {})
if (
    packet_evidence.get("packet_schema") != "piton.review-packet.v1"
    or packet_evidence.get("semantic_map_schema") != "piton.semantic-selection-map.v1"
    or packet_evidence.get("identity_scope")
    != "artifact-local; no durable topology identity; no nearest fallback"
    or set(packet_evidence.get("viewer_asset_digests", {}))
    != {"viewer.js", "viewer.css", "THIRD_PARTY_NOTICES.txt"}
    or "disconnected_load_evidence" not in packet_evidence
    or "viewer_loaded_state" not in packet_evidence
):
    raise SystemExit("artifact manifest omits review-packet/viewer evidence custody")
evidence_record = json.loads(
    (ROOT / "templates" / "evidence-record-v1.json").read_text(encoding="utf-8")
)
if evidence_record.get("review_packet", {}).get("packet_schema") != "piton.review-packet.v1":
    raise SystemExit("evidence record omits review-packet identity")
launch_templates = {
    "artifact manifest": artifact_manifest,
    "evidence record": evidence_record,
}
for template_name, template in launch_templates.items():
    try:
        governed_alpha = GovernedAlphaEvidence.from_primitive(
            template["governed_alpha_evidence"]
        )
        assurance = template["p4_assurance"]
        p4_evidence = P4AssuranceEvidence.from_primitive(assurance["evidence"])
    except (KeyError, TypeError, ValueError) as error:
        raise SystemExit(
            f"{template_name} omits representative P3/P4 bindings: {error}"
        ) from error
    if (
        assurance.get("policy_id") != DEFAULT_P4_ASSURANCE_POLICY.policy_id
        or assurance.get("policy_digest") != DEFAULT_P4_ASSURANCE_POLICY.digest
        or validate_p4_evidence_policy_binding(
            DEFAULT_P4_ASSURANCE_POLICY, p4_evidence
        )
    ):
        raise SystemExit(f"{template_name} P4 policy authority binding drifted")
    if (
        governed_alpha.review_state != "needs_human_review"
        or governed_alpha.fabrication_release is not False
        or governed_alpha.machine_actuation is not False
        or template.get("safety")
        != {
            "review_state": "needs_human_review",
            "fabrication_release": False,
            "machine_actuation": False,
        }
    ):
        raise SystemExit(f"{template_name} violates the launch safety truth")

architecture = (ROOT / "docs" / "architecture.md").read_text(encoding="utf-8")
publication_migration = (
    ROOT / "src/piton/storage/migrations/0009_crash_safe_publication.sql"
).read_text(encoding="utf-8")
evidence_source = (ROOT / "src/piton/evidence.py").read_text(encoding="utf-8")
blob_source = (ROOT / "src/piton/storage/blobs.py").read_text(encoding="utf-8")
publication_contract = {
    "artifact_publications": (publication_migration, "artifact_publications"),
    "artifact_publications_transition_guard": (
        publication_migration,
        "artifact_publications_transition_guard",
    ),
    "artifact_publications_no_delete": (
        publication_migration,
        "artifact_publications_no_delete",
    ),
    "recover_incomplete_publications": (evidence_source, "recover_incomplete_publications"),
    "evidence.closure.committed": (evidence_source, "evidence.closure.committed"),
    ".piton/objects/sha256/": (blob_source, '"objects" / "sha256"'),
}
missing_publication_contract = [
    name for name, (custody_source, marker) in publication_contract.items()
    if marker not in custody_source
]
if missing_publication_contract:
    raise SystemExit(
        "crash-safe publication custody inventory incomplete: "
        + ", ".join(missing_publication_contract)
    )
required_recovery_documentation = (
    "committing",
    "quarantined",
    "startup-incomplete-publication",
    "evidence.closure.committed",
    "delivery_attempts",
    "fabrication_release=false",
    "machine_actuation=false",
)
missing_recovery_documentation = [
    truth for truth in required_recovery_documentation if truth not in architecture
]
if missing_recovery_documentation:
    raise SystemExit(
        "architecture omits crash-recovery operator truth: "
        + ", ".join(missing_recovery_documentation)
    )
review_instructions = (ROOT / "docs" / "human-review-launch-assets.md").read_text(
    encoding="utf-8"
)
required_assurance_documentation = (
    "GovernedAlphaEvidence",
    "P4AssurancePolicy",
    "P4AssuranceEvidence",
    "P4AssuranceReceipt",
    "DEFAULT_P4_ASSURANCE_POLICY",
    "validate_p4_evidence_policy_binding",
    "emit_unavailable_p4_receipts",
    "exact-realization",
    "exact-exchange",
    "review-only",
    "needs_human_review",
)
for document_name, document in (
    ("architecture", architecture),
    ("human review instructions", review_instructions),
):
    missing_content = [
        content for content in required_assurance_documentation if content not in document
    ]
    if missing_content:
        raise SystemExit(
            f"{document_name} omits P3/P4 authority content: "
            + ", ".join(missing_content)
        )
for required_instruction in (
    "project-scoped readback",
    "generation`, monotonic `fence`, and",
    "channel_transition=false",
    "validate_review_packet",
    "packet file inventory",
    "disconnected browser",
    "visible loaded state",
    "Admit framework-only human-review work",
    "intake_human_review",
    "non-persistent",
    "Close a framework packet as needs_human_review",
    "close_framework_packet",
    "verify_successor_admission",
    "policy_digest",
    "evaluated_requirement_ids",
    "Stop review",
    "Close readiness evidence with G2 unaccepted",
    "close_readiness_packet",
    "g2_accepted is False",
):
    if required_instruction not in review_instructions:
        raise SystemExit("human review instructions omit evidence-closure custody")


def load_validator(name: str) -> Draft202012Validator:
    schema = json.loads((ROOT / "schemas" / name).read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


design_validator = load_validator("design-revision-v1.schema.json")
retry_validator = load_validator("retry-error-packet-v1.schema.json")
project_validator = load_validator("piton-project-v1.schema.json")
draft_export_validator = load_validator("draft-export-receipt-v1.schema.json")
review_export_validator = load_validator("review-export-receipt-v1.schema.json")
restore_forward_validator = load_validator("restore-forward-request-v1.schema.json")
load_validator("review-packet-v1.schema.json")
load_validator("browser-qualification-receipt-v1.schema.json")
load_validator("semantic-selection-map-v1.schema.json")
human_review_intake_validator = load_validator("human-review-intake-v1.schema.json")
framework_packet_closure_validator = load_validator(
    "framework-packet-closure-v1.schema.json"
)
readiness_packet_closure_validator = load_validator(
    "readiness-packet-closure-v1.schema.json"
)
governed_alpha_validator = load_validator("governed-alpha-evidence-v1.schema.json")
p4_policy_validator = load_validator("p4-assurance-policy-v1.schema.json")
p4_evidence_validator = load_validator("p4-assurance-evidence-v1.schema.json")
p4_receipt_validator = load_validator("p4-assurance-receipt-v1.schema.json")
p4_policy_round_trip = P4AssurancePolicy.from_primitive(
    DEFAULT_P4_ASSURANCE_POLICY.to_primitive()
)
if p4_policy_round_trip.digest != DEFAULT_P4_ASSURANCE_POLICY.digest:
    raise SystemExit("source-fixed P4 assurance policy canonical round trip drifted")
p4_policy_validator.validate(p4_policy_round_trip.to_primitive())
unavailable_receipts = emit_unavailable_p4_receipts()
if tuple(receipt.requirement_id for receipt in unavailable_receipts) != tuple(
    requirement.requirement_id
    for requirement in DEFAULT_P4_ASSURANCE_POLICY.requirements
):
    raise SystemExit("unavailable P4 receipts do not preserve policy declaration order")
for receipt in unavailable_receipts:
    primitive = receipt.to_primitive()
    p4_receipt_validator.validate(primitive)
    if P4AssuranceReceipt.from_primitive(primitive).digest != receipt.digest:
        raise SystemExit("unavailable P4 assurance receipt canonical round trip drifted")
    for field, unsafe_value in (
        ("availability", "available"),
        ("threshold_passed", True),
        ("evidence_refs", ["sha256:" + "0" * 64]),
    ):
        try:
            p4_receipt_validator.validate({**primitive, field: unsafe_value})
        except ValidationError:
            pass
        else:
            raise SystemExit(f"P4 assurance receipt schema accepted unsafe {field}")
for template_name, template in launch_templates.items():
    governed_alpha_validator.validate(template["governed_alpha_evidence"])
    p4_evidence_validator.validate(template["p4_assurance"]["evidence"])
digest = "sha256:" + "0" * 64
draft_export = DraftExport(
    receipt_id="verify-draft-receipt",
    export_id="verify-draft-export",
    project_id="verify-project",
    revision_id="rev_" + "0" * 64,
    attempt_id="verify-attempt",
    authority_profile="source-native/v0",
    exact_body_digest=digest,
    step_digest=digest,
    units="mm",
    warnings=("Framework-only unreleased draft export.",),
    environment_lock_digest=digest,
    validation_report_digest=digest,
)
draft_export_validator.validate(draft_export.to_primitive())
human_review_intake = HumanReviewIntake(
    intake_id="verify-intake",
    project_id="verify-project",
    revision_id="rev_" + "0" * 64,
    attempt_id="verify-attempt",
    evidence_closure_digest=digest,
    review_packet_digest=digest,
    review_scope=("Verify exact review identity",),
)
human_review_intake_validator.validate(human_review_intake.to_primitive())
framework_packet_closure = FrameworkPacketClosure(
    closure_id="verify-framework-closure",
    project_id="verify-project",
    revision_id="rev_" + "0" * 64,
    attempt_id="verify-attempt",
    evidence_closure_digest=digest,
    review_packet_digest=digest,
    worker_result_digest=digest,
    declaration_digest=digest,
    generation=0,
    fence=0,
    lease_id="verify-lease",
    exact_brep_digest=digest,
    step_digest=digest,
    review_glb_digest=digest,
    review_selection_map_digest=digest,
)
framework_packet_closure_validator.validate(framework_packet_closure.to_primitive())
readiness_campaign = run_readiness_campaign(
    candidate_commit="0" * 40,
    policy_digest=digest,
    method_digest=digest,
    comparator_digest=digest,
    implementation_digest=digest,
    environment_digest=digest,
    toolchain_digest=digest,
)
readiness_packet_closure = close_readiness_packet(
    candidate_commit=readiness_campaign.candidate_commit,
    readiness_campaign_digest=readiness_campaign.digest,
    campaign=readiness_campaign,
)
readiness_payload = readiness_packet_closure.to_primitive()
readiness_packet_closure_validator.validate(readiness_payload)
if ReadinessPacketClosure.from_primitive(readiness_payload) != readiness_packet_closure:
    raise SystemExit("readiness packet closure canonical round trip drifted")
if (
    readiness_packet_closure.g2_accepted is not False
    or readiness_packet_closure.review_state != "needs_human_review"
    or readiness_packet_closure.fabrication_release is not False
    or readiness_packet_closure.machine_actuation is not False
    or dict(readiness_packet_closure.counters)
    != {name: 0 for name in CRITICAL_COUNTER_NAMES}
):
    raise SystemExit("readiness packet closure violated G2-unaccepted safety truth")
for field in ("g2_accepted", "fabrication_release", "machine_actuation"):
    try:
        readiness_packet_closure_validator.validate({**readiness_payload, field: True})
    except ValidationError:
        pass
    else:
        raise SystemExit(f"readiness packet closure schema accepted unsafe {field}")
revision = DesignRevision(
    parent_revision_id=None,
    source_manifest_digest=digest,
    entrypoint="part.py:build",
    dependency_lock_digest=digest,
    toolchain_lock_digest=digest,
    parameter_values={"height": "10 mm"},
)
design_validator.validate(revision.to_manifest())
project = load_project_directory(ROOT / "examples" / "minimal-project")
project_validator.validate(project.to_primitive())
review_receipt = build_review_export(project)
review_export_validator.validate(review_receipt)
validate_review_export(review_receipt, project)
candidate_project = replace(project, records=project.records[:-1])
restore_packet = build_restore_forward(candidate_project, project)
restore_forward_validator.validate(restore_packet)
validate_restore_forward(restore_packet, candidate_project)

packet = RetryErrorPacket(
    attempt=1,
    failed_step="test_the_behavior",
    head_sha=None,
    commands=("python -m unittest",),
    exit_codes=(1,),
    failed_checks=("representative",),
    diagnosis="representative failure",
    changed_files=(),
    next_fix=("repair",),
    evidence_refs=(),
    sanitized_logs=("failure",),
    terminal_blockers=(),
)
retry_validator.validate(packet.to_payload())

invalid_manifest = revision.to_manifest()
invalid_manifest["authority_profile"] = "caller-minted"
try:
    design_validator.validate(invalid_manifest)
except ValidationError:
    pass
else:
    raise SystemExit("design revision schema accepted caller-minted authority")

# Launch-boundary mutation checks: safety escalation and packet tampering must fail.
for validator, payload, field in (
    (review_export_validator, review_receipt, "fabrication_release"),
    (restore_forward_validator, restore_packet, "machine_actuation"),
):
    mutated = json.loads(json.dumps(payload))
    mutated["safety"][field] = True
    try:
        validator.validate(mutated)
    except ValidationError:
        pass
    else:
        raise SystemExit(f"launch schema accepted unsafe {field}=true mutation")

for field in ("fabrication_release", "machine_actuation"):
    mutated_draft = draft_export.to_primitive()
    mutated_draft[field] = True
    try:
        draft_export_validator.validate(mutated_draft)
    except ValidationError:
        pass
    else:
        raise SystemExit(f"draft export schema accepted unsafe {field}=true mutation")

tampered_review = json.loads(json.dumps(review_receipt))
tampered_review["project_manifest_digest"] = "sha256:" + "3" * 64
try:
    validate_review_export(tampered_review, project)
except ValueError:
    pass
else:
    raise SystemExit("review export validation accepted a tampered receipt digest")

tampered_restore = json.loads(json.dumps(restore_packet))
tampered_restore["accepted_project_digest"] = "sha256:" + "2" * 64
try:
    validate_restore_forward(tampered_restore, candidate_project)
except ValueError:
    pass
else:
    raise SystemExit("restore-forward validation accepted a tampered request digest")

for script_name in ("doctor.py", "install_verify.py"):
    script_result = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / script_name)],
        cwd=ROOT,
        check=False,
    )
    if script_result.returncode:
        raise SystemExit(f"required launch verification failed: {script_name}")

result = subprocess.run(
    [sys.executable, "-m", "pytest", "-q", str(ROOT / "tests")],
    cwd=ROOT,
    check=False,
)
if result.returncode:
    raise SystemExit(result.returncode)
print(
    "piton repository verification: PASS "
    "(schemas validated; crash-safe custody inventory: artifact_publications, "
    "transition/delete guards, CAS artifact paths, quarantine recovery, closure outbox)"
)
