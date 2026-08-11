"""Sandboxed child-process entrypoint for the pinned precision worker."""
from __future__ import annotations

import json
import sys
from dataclasses import fields
from pathlib import Path
from typing import Any, Mapping

from .parts.l_bracket import LBracketParameters
from .precision_worker import execute_precision_worker
from .precision_worker_launch import input_bundle_digest, validate_execution_manifest
from .realization import RealizationInputs
from .revision import DesignRevision
from .worker_contracts import PrecisionWorkerRequest

_INTEGER_PARAMETERS = {"hole_count_base", "hole_count_leg"}


def _parameters(value: Mapping[str, str]) -> LBracketParameters:
    expected = {item.name for item in fields(LBracketParameters)}
    if set(value) != expected:
        raise ValueError("execution parameter fields do not match the pinned part")
    converted: dict[str, Any] = {}
    for name, raw in value.items():
        if not isinstance(raw, str):
            raise TypeError("execution parameter values must be canonical strings")
        converted[name] = int(raw) if name in _INTEGER_PARAMETERS else float(raw)
    return LBracketParameters(**converted)


def execute_manifest(value: Mapping[str, Any]):
    """Validate closed sandbox inputs, reconstruct the revision, and realize derivatives."""
    validate_execution_manifest(value)
    request = PrecisionWorkerRequest.from_manifest(value["request"])
    revision = DesignRevision.from_manifest(value["revision"])
    repository_root = Path(value["repository_root"])
    control_root = Path(value["control_root"])
    if input_bundle_digest(repository_root) != value["input_bundle_digest"]:
        raise ValueError("input_bundle_digest does not match mounted immutable inputs")
    parameters = _parameters(revision.parameter_values)
    inputs = RealizationInputs.from_repository(repository_root, parameters)
    if inputs.revision.canonical_bytes != revision.canonical_bytes:
        raise ValueError("execution revision does not match immutable repository inputs")
    if request.revision_id != revision.revision_id:
        raise ValueError("execution request does not match immutable revision")
    return execute_precision_worker(request, revision, inputs, control_root)


def main(validated_manifest: Mapping[str, Any] | None = None) -> int:
    try:
        if validated_manifest is None:
            raw = sys.stdin.buffer.read(1024 * 1024 + 1)
            if not raw or len(raw) > 1024 * 1024:
                raise ValueError("precision worker execution manifest is empty or oversized")
            value = json.loads(raw.decode("utf-8", errors="strict"))
        else:
            value = validated_manifest
        if not isinstance(value, dict):
            raise TypeError("precision worker execution manifest must be an object")
        result = execute_manifest(value)
        sys.stdout.buffer.write(result.canonical_bytes)
        return 0
    except Exception:
        # The parent never trusts child diagnostics or stderr as evidence.
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
