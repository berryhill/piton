#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from jsonschema import Draft202012Validator, ValidationError
from piton.implementation_loop import RetryErrorPacket
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
    ROOT / "flows/piton_implementation_loop_v1.json",
    ROOT / "schemas/retry-error-packet-v1.schema.json",
    ROOT / "schemas/design-revision-v1.schema.json",
    ROOT / "schemas/piton-project-v1.schema.json",
    ROOT / ".github/workflows/ci.yml",
]

missing = [str(path.relative_to(ROOT)) for path in REQUIRED if not path.is_file()]
if missing:
    raise SystemExit("missing required files: " + ", ".join(missing))

flow_path = ROOT / "flows/piton_implementation_loop_v1.json"
json.loads(flow_path.read_text(encoding="utf-8"))

def load_validator(name: str) -> Draft202012Validator:
    schema = json.loads((ROOT / "schemas" / name).read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


design_validator = load_validator("design-revision-v1.schema.json")
retry_validator = load_validator("retry-error-packet-v1.schema.json")
project_validator = load_validator("piton-project-v1.schema.json")
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

result = subprocess.run(
    [sys.executable, "-m", "unittest", "discover", "-s", str(ROOT / "tests"), "-v"],
    cwd=ROOT,
    env={**os.environ, "PYTHONPATH": str(ROOT / "src")},
    check=False,
)
if result.returncode:
    raise SystemExit(result.returncode)
print("piton repository verification: PASS (schemas validated with representative instances)")
