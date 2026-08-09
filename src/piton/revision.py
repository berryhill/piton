"""Canonical, immutable design-revision manifests and identities."""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Any, ClassVar, Mapping

SCHEMA_ID = "piton.design-revision.v1"
AUTHORITY_PROFILE = "source-native/v0"
_DIGEST_PATTERN = re.compile(r"^sha256:[0-9a-f]{64}$")
_REVISION_PATTERN = re.compile(r"^rev_[0-9a-f]{64}$")


def canonical_json_bytes(value: Mapping[str, Any]) -> bytes:
    """Return deterministic UTF-8 JSON bytes for revision identity."""
    return json.dumps(
        value,
        ensure_ascii=False,
        allow_nan=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def compute_revision_id(manifest: Mapping[str, Any]) -> str:
    """Compute (and, when present, verify) a canonical manifest's identity."""
    identity_fields = dict(manifest)
    claimed_id = identity_fields.pop("revision_id", None)
    required = {
        "schema",
        "parent_revision_id",
        "authority_profile",
        "source_manifest_digest",
        "entrypoint",
        "dependency_lock_digest",
        "toolchain_lock_digest",
        "parameter_values",
    }
    if set(identity_fields) not in (required, required | {"proposal_id"}):
        raise ValueError("revision manifest fields do not match schema v1")
    if identity_fields["schema"] != SCHEMA_ID:
        raise ValueError("revision manifest has an unsupported schema")
    if identity_fields["authority_profile"] != AUTHORITY_PROFILE:
        raise ValueError("revision manifest has a non-canonical authority profile")
    payload = b"piton.design-revision.v1\0" + canonical_json_bytes(identity_fields)
    computed = "rev_" + hashlib.sha256(payload).hexdigest()
    if claimed_id is not None and claimed_id != computed:
        raise ValueError("revision_id does not match canonical manifest content")
    return computed


def _require_digest(name: str, value: str) -> None:
    if not isinstance(value, str) or not _DIGEST_PATTERN.fullmatch(value):
        raise ValueError(f"{name} must be a sha256:<64 lowercase hex> digest")


@dataclass(frozen=True)
class DesignRevision:
    """The one source-native revision manifest; identity is never caller supplied."""

    parent_revision_id: str | None
    source_manifest_digest: str
    entrypoint: str
    dependency_lock_digest: str
    toolchain_lock_digest: str
    parameter_values: Mapping[str, str]
    proposal_id: str | None = None
    revision_id: str = field(init=False)

    schema: ClassVar[str] = SCHEMA_ID
    authority_profile: ClassVar[str] = AUTHORITY_PROFILE

    def __post_init__(self) -> None:
        if self.parent_revision_id is not None and (
            not isinstance(self.parent_revision_id, str)
            or not _REVISION_PATTERN.fullmatch(self.parent_revision_id)
        ):
            raise ValueError("parent_revision_id must be a derived revision ID or None")
        _require_digest("source_manifest_digest", self.source_manifest_digest)
        _require_digest("dependency_lock_digest", self.dependency_lock_digest)
        _require_digest("toolchain_lock_digest", self.toolchain_lock_digest)
        if not isinstance(self.entrypoint, str) or not self.entrypoint:
            raise ValueError("entrypoint must not be empty")
        if self.proposal_id is not None and (
            not isinstance(self.proposal_id, str) or not self.proposal_id
        ):
            raise ValueError("proposal_id must not be empty when supplied")

        parameters = dict(self.parameter_values)
        if not all(isinstance(key, str) and key for key in parameters):
            raise ValueError("parameter names must be non-empty strings")
        if not all(isinstance(value, str) for value in parameters.values()):
            raise ValueError("parameter values must be strings")
        object.__setattr__(self, "parameter_values", MappingProxyType(parameters))
        object.__setattr__(self, "revision_id", compute_revision_id(self._identity_fields()))

    def _identity_fields(self) -> dict[str, Any]:
        manifest: dict[str, Any] = {
            "schema": self.schema,
            "parent_revision_id": self.parent_revision_id,
            "authority_profile": self.authority_profile,
            "source_manifest_digest": self.source_manifest_digest,
            "entrypoint": self.entrypoint,
            "dependency_lock_digest": self.dependency_lock_digest,
            "toolchain_lock_digest": self.toolchain_lock_digest,
            "parameter_values": dict(self.parameter_values),
        }
        if self.proposal_id is not None:
            manifest["proposal_id"] = self.proposal_id
        return manifest

    def to_manifest(self) -> dict[str, Any]:
        """Return the canonical, identity-bearing v1 JSON manifest."""
        manifest = self._identity_fields()
        manifest["revision_id"] = self.revision_id
        return manifest

    @property
    def canonical_bytes(self) -> bytes:
        """Return the immutable manifest bytes stored in object custody."""
        return canonical_json_bytes(self.to_manifest()) + b"\n"

    @classmethod
    def from_manifest(cls, manifest: Mapping[str, Any]) -> "DesignRevision":
        """Validate identity and canonical constants before constructing a revision."""
        computed_id = compute_revision_id(manifest)
        if manifest.get("revision_id") != computed_id:
            raise ValueError("canonical revision manifest requires its derived revision_id")
        revision = cls(
            parent_revision_id=manifest["parent_revision_id"],
            source_manifest_digest=manifest["source_manifest_digest"],
            entrypoint=manifest["entrypoint"],
            dependency_lock_digest=manifest["dependency_lock_digest"],
            toolchain_lock_digest=manifest["toolchain_lock_digest"],
            parameter_values=manifest["parameter_values"],
            proposal_id=manifest.get("proposal_id"),
        )
        if revision.revision_id != computed_id:
            raise ValueError("revision identity changed during construction")
        return revision
