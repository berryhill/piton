"""Immutable canonical contracts for the Stage 1 precision-worker boundary.

These records carry execution facts only. They cannot mutate authored revisions,
review dispositions, channels, approvals, exports, release state, or machinery.
"""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Any, ClassVar, Mapping, Sequence

_DIGEST = re.compile(r"^sha256:[0-9a-f]{64}$")
_REVISION = re.compile(r"^rev_[0-9a-f]{64}$")
_IDENTIFIER = re.compile(r"^[A-Za-z][A-Za-z0-9_.:-]{0,127}$")
_REQUEST_SCHEMA = "piton.precision-worker-request.v1"
_RESULT_SCHEMA = "piton.precision-worker-result.v1"
_TRUTH = {
    "review_state": "needs_human_review",
    "fabrication_release": False,
    "machine_actuation": False,
}


def canonical_json_bytes(value: Mapping[str, Any]) -> bytes:
    return (
        json.dumps(
            value,
            ensure_ascii=False,
            allow_nan=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        + "\n"
    ).encode("utf-8")


def _identity(namespace: str, primitive: Mapping[str, Any]) -> str:
    payload = namespace.encode("ascii") + b"\0" + canonical_json_bytes(primitive)
    return "sha256:" + hashlib.sha256(payload).hexdigest()


def _required(name: str, value: str) -> None:
    if not isinstance(value, str) or not value:
        raise ValueError(f"{name} must be a non-empty string")


def _identifier(name: str, value: str) -> None:
    if not isinstance(value, str) or _IDENTIFIER.fullmatch(value) is None:
        raise ValueError(f"{name} must be a shaped identifier")


def _digest(name: str, value: str) -> None:
    if not isinstance(value, str) or _DIGEST.fullmatch(value) is None:
        raise ValueError(f"{name} must be a sha256:<64 lowercase hex> digest")


def _revision(name: str, value: str) -> None:
    if not isinstance(value, str) or _REVISION.fullmatch(value) is None:
        raise ValueError(f"{name} must be a canonical revision ID")


def _counter(name: str, value: int) -> None:
    if type(value) is not int or value < 0:
        raise ValueError(f"{name} must be a non-negative integer")


def _freeze_json(value: Any) -> Any:
    if isinstance(value, Mapping):
        copied: dict[str, Any] = {}
        for key, item in value.items():
            if not isinstance(key, str) or not key:
                raise ValueError("canonical mapping keys must be non-empty strings")
            copied[key] = _freeze_json(item)
        return MappingProxyType(copied)
    if isinstance(value, (tuple, list)):
        return tuple(_freeze_json(item) for item in value)
    if value is None or isinstance(value, (str, bool, int)):
        return value
    raise TypeError("worker contract values must be canonical JSON scalars, mappings, or sequences")


def _primitive(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {key: _primitive(item) for key, item in value.items()}
    if isinstance(value, tuple):
        return [_primitive(item) for item in value]
    return value


def _truth(value: Mapping[str, Any]) -> Mapping[str, Any]:
    frozen = _freeze_json(value)
    if set(frozen) != set(_TRUTH):
        raise ValueError("root safety truth fields do not match the closed contract")
    if frozen["fabrication_release"] is not False:
        raise ValueError("fabrication_release must remain false")
    if frozen["machine_actuation"] is not False:
        raise ValueError("machine_actuation must remain false")
    if (
        type(frozen["review_state"]) is not str
        or frozen["review_state"] != "needs_human_review"
    ):
        raise ValueError("review_state must remain needs_human_review")
    return frozen


@dataclass(frozen=True, slots=True)
class WorkerArtifact:
    """One bounded derivative output; never authored or release authority."""

    relative_path: str
    digest: str
    byte_length: int
    media_type: str
    claim_scope: str
    units: str

    def __post_init__(self) -> None:
        _required("relative_path", self.relative_path)
        if self.relative_path.startswith("/") or ".." in self.relative_path.split("/"):
            raise ValueError("relative_path must remain inside the attempt output")
        _digest("artifact digest", self.digest)
        if type(self.byte_length) is not int or self.byte_length < 0:
            raise ValueError("byte_length must be a non-negative integer")
        for name in ("media_type", "claim_scope", "units"):
            _required(name, getattr(self, name))

    def to_primitive(self) -> dict[str, Any]:
        return {
            "relative_path": self.relative_path,
            "digest": self.digest,
            "byte_length": self.byte_length,
            "media_type": self.media_type,
            "claim_scope": self.claim_scope,
            "units": self.units,
        }

    @classmethod
    def from_primitive(cls, value: Mapping[str, Any]) -> "WorkerArtifact":
        fields = {
            "relative_path",
            "digest",
            "byte_length",
            "media_type",
            "claim_scope",
            "units",
        }
        if set(value) != fields:
            raise ValueError("worker artifact fields do not match schema v1")
        return cls(**{name: value[name] for name in fields})


@dataclass(frozen=True, slots=True)
class PrecisionWorkerRequest:
    project_id: str
    revision_id: str
    attempt_id: str
    generation: int
    fence: int
    lease_id: str
    input_manifest_digest: str
    recipe_digest: str
    toolchain_digest: str
    capability_manifest_digest: str
    resource_limits_digest: str
    expected_outputs_digest: str
    request_signature_ref: str
    worker_id: str
    worker_pin: str
    isolation_class: str
    expected_outputs: Sequence[str]
    truth: Mapping[str, Any] = field(default_factory=lambda: dict(_TRUTH))
    request_digest: str = field(init=False)

    schema: ClassVar[str] = _REQUEST_SCHEMA

    def __post_init__(self) -> None:
        for name in ("project_id", "attempt_id", "lease_id", "worker_id", "worker_pin"):
            _identifier(name, getattr(self, name))
        _revision("revision_id", self.revision_id)
        _counter("generation", self.generation)
        _counter("fence", self.fence)
        for name in (
            "input_manifest_digest",
            "recipe_digest",
            "toolchain_digest",
            "capability_manifest_digest",
            "resource_limits_digest",
            "expected_outputs_digest",
            "request_signature_ref",
        ):
            _digest(name, getattr(self, name))
        if self.isolation_class != "trusted-local":
            raise ValueError("precision worker must honestly declare trusted-local isolation")
        outputs = tuple(self.expected_outputs)
        if not outputs or len(outputs) != len(set(outputs)):
            raise ValueError("expected_outputs must be unique and non-empty")
        for output in outputs:
            _identifier("expected output", output)
        object.__setattr__(self, "expected_outputs", tuple(sorted(outputs)))
        object.__setattr__(self, "truth", _truth(self.truth))
        object.__setattr__(self, "request_digest", _identity(self.schema, self._identity_fields()))

    def _identity_fields(self) -> dict[str, Any]:
        return {
            "schema": self.schema,
            "project_id": self.project_id,
            "revision_id": self.revision_id,
            "attempt_id": self.attempt_id,
            "generation": self.generation,
            "fence": self.fence,
            "lease_id": self.lease_id,
            "input_manifest_digest": self.input_manifest_digest,
            "recipe_digest": self.recipe_digest,
            "toolchain_digest": self.toolchain_digest,
            "capability_manifest_digest": self.capability_manifest_digest,
            "resource_limits_digest": self.resource_limits_digest,
            "expected_outputs_digest": self.expected_outputs_digest,
            "request_signature_ref": self.request_signature_ref,
            "worker_id": self.worker_id,
            "worker_pin": self.worker_pin,
            "isolation_class": self.isolation_class,
            "expected_outputs": list(self.expected_outputs),
            "truth": _primitive(self.truth),
        }

    def to_manifest(self) -> dict[str, Any]:
        manifest = self._identity_fields()
        manifest["request_digest"] = self.request_digest
        return manifest

    @property
    def canonical_bytes(self) -> bytes:
        return canonical_json_bytes(self.to_manifest())

    @classmethod
    def from_manifest(cls, value: Mapping[str, Any]) -> "PrecisionWorkerRequest":
        required = {
            "schema",
            "project_id",
            "revision_id",
            "attempt_id",
            "generation",
            "fence",
            "lease_id",
            "input_manifest_digest",
            "recipe_digest",
            "toolchain_digest",
            "capability_manifest_digest",
            "resource_limits_digest",
            "expected_outputs_digest",
            "request_signature_ref",
            "worker_id",
            "worker_pin",
            "isolation_class",
            "expected_outputs",
            "truth",
            "request_digest",
        }
        if set(value) != required:
            raise ValueError("precision worker request fields do not match schema v1")
        if value["schema"] != cls.schema:
            raise ValueError("unsupported precision worker request schema")
        claimed = value["request_digest"]
        _digest("request_digest", claimed)
        request = cls(**{name: value[name] for name in required - {"schema", "request_digest"}})
        if request.request_digest != claimed:
            raise ValueError("request_digest does not match canonical request content")
        return request


@dataclass(frozen=True, slots=True)
class PrecisionWorkerResult:
    project_id: str
    revision_id: str
    attempt_id: str
    generation: int
    fence: int
    lease_id: str
    request_digest: str
    status: str
    worker_id: str
    worker_pin: str
    toolchain_digest: str
    isolation_class: str
    authenticated: bool
    result_signature_ref: str | None
    toolchain: Mapping[str, Any]
    environment: Mapping[str, Any]
    artifacts: Mapping[str, WorkerArtifact]
    diagnostics: Sequence[str]
    expected_output_closure: bool
    truth: Mapping[str, Any] = field(default_factory=lambda: dict(_TRUTH))
    result_digest: str = field(init=False)

    schema: ClassVar[str] = _RESULT_SCHEMA

    def __post_init__(self) -> None:
        for name in ("project_id", "attempt_id", "lease_id", "worker_id", "worker_pin"):
            _identifier(name, getattr(self, name))
        _revision("revision_id", self.revision_id)
        _counter("generation", self.generation)
        _counter("fence", self.fence)
        _digest("request_digest", self.request_digest)
        _digest("toolchain_digest", self.toolchain_digest)
        if self.status not in {"succeeded", "failed", "blocked"}:
            raise ValueError("status must be succeeded, failed, or blocked")
        if self.isolation_class != "trusted-local":
            raise ValueError("result must attest actual trusted-local isolation")
        if self.authenticated is not False or self.result_signature_ref is not None:
            raise ValueError("trusted-local result must not claim unimplemented authentication")
        toolchain = _freeze_json(self.toolchain)
        environment = _freeze_json(self.environment)
        copied_artifacts = dict(self.artifacts)
        if not all(isinstance(key, str) and isinstance(item, WorkerArtifact) for key, item in copied_artifacts.items()):
            raise TypeError("artifacts must map roles to WorkerArtifact values")
        diagnostics = tuple(self.diagnostics)
        if not all(isinstance(item, str) and item for item in diagnostics):
            raise ValueError("diagnostics must contain non-empty sanitized messages")
        if len(diagnostics) > 16 or any(len(item) > 256 for item in diagnostics):
            raise ValueError("diagnostics exceed the bounded worker contract")
        if self.status == "succeeded":
            if not self.expected_output_closure or diagnostics:
                raise ValueError("successful result requires closed outputs and no diagnostics")
        elif copied_artifacts or self.expected_output_closure:
            raise ValueError("failed or blocked result cannot claim successful output closure")
        object.__setattr__(self, "toolchain", toolchain)
        object.__setattr__(self, "environment", environment)
        object.__setattr__(self, "artifacts", MappingProxyType(copied_artifacts))
        object.__setattr__(self, "diagnostics", diagnostics)
        object.__setattr__(self, "truth", _truth(self.truth))
        object.__setattr__(self, "result_digest", _identity(self.schema, self._identity_fields()))

    def _identity_fields(self) -> dict[str, Any]:
        return {
            "schema": self.schema,
            "project_id": self.project_id,
            "revision_id": self.revision_id,
            "attempt_id": self.attempt_id,
            "generation": self.generation,
            "fence": self.fence,
            "lease_id": self.lease_id,
            "request_digest": self.request_digest,
            "status": self.status,
            "worker_id": self.worker_id,
            "worker_pin": self.worker_pin,
            "toolchain_digest": self.toolchain_digest,
            "isolation_class": self.isolation_class,
            "authenticated": self.authenticated,
            "result_signature_ref": self.result_signature_ref,
            "toolchain": _primitive(self.toolchain),
            "environment": _primitive(self.environment),
            "artifacts": {
                role: artifact.to_primitive() for role, artifact in sorted(self.artifacts.items())
            },
            "diagnostics": list(self.diagnostics),
            "expected_output_closure": self.expected_output_closure,
            "truth": _primitive(self.truth),
        }

    def to_manifest(self) -> dict[str, Any]:
        manifest = self._identity_fields()
        manifest["result_digest"] = self.result_digest
        return manifest

    @property
    def canonical_bytes(self) -> bytes:
        return canonical_json_bytes(self.to_manifest())

    @classmethod
    def from_manifest(cls, value: Mapping[str, Any]) -> "PrecisionWorkerResult":
        required = {
            "schema",
            "project_id",
            "revision_id",
            "attempt_id",
            "generation",
            "fence",
            "lease_id",
            "request_digest",
            "status",
            "worker_id",
            "worker_pin",
            "toolchain_digest",
            "isolation_class",
            "authenticated",
            "result_signature_ref",
            "toolchain",
            "environment",
            "artifacts",
            "diagnostics",
            "expected_output_closure",
            "truth",
            "result_digest",
        }
        if set(value) != required:
            raise ValueError("precision worker result fields do not match schema v1")
        if value["schema"] != cls.schema:
            raise ValueError("unsupported precision worker result schema")
        claimed = value["result_digest"]
        _digest("result_digest", claimed)
        arguments = {name: value[name] for name in required - {"schema", "result_digest", "artifacts"}}
        if not isinstance(value["artifacts"], Mapping):
            raise TypeError("artifacts must be a mapping")
        arguments["artifacts"] = {
            role: WorkerArtifact.from_primitive(artifact)
            for role, artifact in value["artifacts"].items()
        }
        result = cls(**arguments)
        if result.result_digest != claimed:
            raise ValueError("result_digest does not match canonical result content")
        return result
