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
from piton.implementation_loop import RetryErrorPacket
from piton.launch_assets import (
    build_restore_forward,
    build_review_export,
    validate_restore_forward,
    validate_review_export,
)
from piton.launch_verification import validate_precision_worker_source
from piton.project_format import load_project_directory
from piton.revision import DesignRevision

REQUIRED = [
    ROOT / "AGENTS.md",
    ROOT / ".otoxan/context.md",
    ROOT / ".otoxan/rules/safety.md",
    ROOT / ".otoxan/flows/piton-implementation-loop-v1.md",
    ROOT / "src/piton/model.py",
    ROOT / "src/piton/revision.py",
    ROOT / "src/piton/implementation_loop.py",
    ROOT / "src/piton/storage/build_attempts.py",
    ROOT / "src/piton/worker_contracts.py",
    ROOT / "src/piton/precision_worker.py",
    ROOT / "src/piton/mesh_derivatives.py",
    ROOT / "src/piton/launch_verification.py",
    ROOT / "src/piton/storage/migrations/0005_durable_build_attempts.sql",
    ROOT / "tests/test_build_attempt_admission.py",
    ROOT / "tests/contract/test_precision_worker_custody.py",
    ROOT / "tests/contract/test_worker_contracts.py",
    ROOT / "tests/geometry/test_precision_worker.py",
    ROOT / "tests/test_mesh_derivatives.py",
    ROOT / "flows/piton_implementation_loop_v1.json",
    ROOT / "schemas/retry-error-packet-v1.schema.json",
    ROOT / "schemas/design-revision-v1.schema.json",
    ROOT / "schemas/piton-project-v1.schema.json",
    ROOT / "schemas/review-export-receipt-v1.schema.json",
    ROOT / "schemas/restore-forward-request-v1.schema.json",
    ROOT / "src/piton/schemas/review-export-receipt-v1.schema.json",
    ROOT / "src/piton/schemas/restore-forward-request-v1.schema.json",
    ROOT / "scripts/review_export.py",
    ROOT / "scripts/restore_forward.py",
    ROOT / "scripts/build_part.py",
    ROOT / "scripts/doctor.py",
    ROOT / "scripts/install_verify.py",
    ROOT / "templates/evidence-record-v1.json",
    ROOT / "templates/artifact-manifest-v1.json",
    ROOT / "docs/human-review-launch-assets.md",
    ROOT / "docs/rollback.md",
    ROOT / "docs/fabrication-safety.md",
    ROOT / "tests/test_launch_assets.py",
    ROOT / ".github/workflows/ci.yml",
]

missing = [str(path.relative_to(ROOT)) for path in REQUIRED if not path.is_file()]
if missing:
    raise SystemExit("missing required files: " + ", ".join(missing))

try:
    validate_precision_worker_source(ROOT / "src/piton/precision_worker.py")
except (OSError, SyntaxError, ValueError) as error:
    raise SystemExit(str(error)) from error

for schema_name in (
    "review-export-receipt-v1.schema.json",
    "restore-forward-request-v1.schema.json",
):
    repository_schema = (ROOT / "schemas" / schema_name).read_bytes()
    packaged_schema = (ROOT / "src" / "piton" / "schemas" / schema_name).read_bytes()
    if packaged_schema != repository_schema:
        raise SystemExit(f"packaged launch schema drift: {schema_name}")

flow_path = ROOT / "flows/piton_implementation_loop_v1.json"
json.loads(flow_path.read_text(encoding="utf-8"))

def load_validator(name: str) -> Draft202012Validator:
    schema = json.loads((ROOT / "schemas" / name).read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


design_validator = load_validator("design-revision-v1.schema.json")
retry_validator = load_validator("retry-error-packet-v1.schema.json")
project_validator = load_validator("piton-project-v1.schema.json")
review_export_validator = load_validator("review-export-receipt-v1.schema.json")
restore_forward_validator = load_validator("restore-forward-request-v1.schema.json")
digest = "sha256:" + "0" * 64
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
print("piton repository verification: PASS (schemas validated with representative instances)")
