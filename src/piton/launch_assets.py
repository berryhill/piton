"""Deterministic, review-only launch packet construction and validation."""
from __future__ import annotations

import hashlib
import json
import os
import tempfile
from importlib.resources import files
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator

from piton.project_format import PitonProject, load_project_directory, project_digest

SAFETY = {
    "review_state": "needs_human_review",
    "fabrication_release": False,
    "machine_actuation": False,
}


def canonical_json_bytes(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def _domain_digest(domain: str, value: Any) -> str:
    return "sha256:" + hashlib.sha256(domain.encode("ascii") + b"\0" + canonical_json_bytes(value)).hexdigest()


def _validator(schema_name: str) -> Draft202012Validator:
    schema_resource = files("piton").joinpath("schemas", schema_name)
    schema = json.loads(schema_resource.read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


def build_review_export(project: PitonProject) -> dict[str, Any]:
    """Describe validated custody without importing or executing project source."""
    body: dict[str, Any] = {
        "schema": "piton.review-export-receipt.v1",
        "project_id": project.project_id,
        "project_manifest_digest": project_digest(project),
        "source_closure": [
            {"path": source.path, "digest": source.digest}
            for source in sorted(project.source_files, key=lambda item: item.path)
        ],
        "claim_scope": "review_only_reference_export",
        "claim_scope_exclusions": ["approval", "fabrication_release", "machine_actuation", "channel_promotion"],
        "release_state": "unreleased",
        "channel_transition": False,
        "source_executed": False,
        "safety": dict(SAFETY),
    }
    receipt = {**body, "receipt_digest": _domain_digest("piton.review-export-receipt.v1", body)}
    validate_review_export(receipt, project)
    return receipt


def validate_review_export(receipt: Any, project: PitonProject | None = None) -> None:
    """Fail closed on schema, receipt identity, or canonical project custody mismatch."""
    _validator("review-export-receipt-v1.schema.json").validate(receipt)
    body = dict(receipt)
    claimed = body.pop("receipt_digest")
    expected = _domain_digest("piton.review-export-receipt.v1", body)
    if claimed != expected:
        raise ValueError("review export receipt digest mismatch")
    if project is not None:
        expected_source_closure = [
            {"path": source.path, "digest": source.digest}
            for source in sorted(project.source_files, key=lambda item: item.path)
        ]
        if (
            receipt["project_id"] != project.project_id
            or receipt["project_manifest_digest"] != project_digest(project)
            or receipt["source_closure"] != expected_source_closure
        ):
            raise ValueError("review export receipt does not match canonical project custody")


def build_restore_forward(project: PitonProject, accepted_project: PitonProject) -> dict[str, Any]:
    """Create a request for a new candidate; never modify accepted history."""
    candidate = project_digest(project)
    if accepted_project.project_id != project.project_id:
        raise ValueError("accepted and candidate projects must have the same project_id")
    accepted_project_digest = project_digest(accepted_project)
    if accepted_project_digest == candidate:
        raise ValueError("restore-forward candidate must differ from accepted project digest")
    body: dict[str, Any] = {
        "schema": "piton.restore-forward-request.v1",
        "operation": "restore_forward_new_revision",
        "project_id": project.project_id,
        "accepted_project_digest": accepted_project_digest,
        "candidate_project_digest": candidate,
        "history_rewrite": False,
        "accepted_state_mutation": False,
        "claim_scope": "human_review_request_only",
        "claim_scope_exclusions": ["acceptance", "approval", "history_rewrite", "fabrication_release", "machine_actuation"],
        "safety": dict(SAFETY),
    }
    packet = {**body, "request_digest": _domain_digest("piton.restore-forward-request.v1", body)}
    validate_restore_forward(packet, project)
    return packet


def validate_restore_forward(packet: Any, project: PitonProject | None = None) -> None:
    """Fail closed on schema, packet identity, or candidate custody mismatch."""
    _validator("restore-forward-request-v1.schema.json").validate(packet)
    body = dict(packet)
    claimed = body.pop("request_digest")
    expected = _domain_digest("piton.restore-forward-request.v1", body)
    if claimed != expected:
        raise ValueError("restore-forward request digest mismatch")
    if packet["accepted_project_digest"] == packet["candidate_project_digest"]:
        raise ValueError("restore-forward candidate must differ from accepted project digest")
    if project is not None:
        if packet["project_id"] != project.project_id or packet["candidate_project_digest"] != project_digest(project):
            raise ValueError("restore-forward request does not match canonical project custody")


def load_strict_json(path: Path) -> Any:
    def reject_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f"duplicate JSON key: {key}")
            result[key] = value
        return result

    return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=reject_duplicates)


def atomic_write_json(path: Path, payload: Any) -> None:
    """Publish a new packet without following symlinks or replacing any output."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if os.path.lexists(path):
        raise FileExistsError(f"refusing to replace existing or symlinked output: {path}")
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(canonical_json_bytes(payload))
            stream.flush()
            os.fsync(stream.fileno())
        os.link(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def validated_project(path: Path) -> PitonProject:
    return load_project_directory(path)
