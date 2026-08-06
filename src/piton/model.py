"""Immutable, fail-closed domain contracts for the Piton MVI scaffold."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import StrEnum
from types import MappingProxyType
from typing import Mapping, Tuple

from .revision import DesignRevision

_IDENTIFIER_PATTERN = re.compile(r"^[A-Za-z][A-Za-z0-9_.:-]{0,127}$")
_REVISION_PATTERN = re.compile(r"^rev_[0-9a-f]{64}$")
_DIGEST_PATTERN = re.compile(r"^sha256:[0-9a-f]{64}$")


def _require_identifier(name: str, value: str) -> None:
    if not isinstance(value, str) or not _IDENTIFIER_PATTERN.fullmatch(value):
        raise ValueError(f"{name} must be a shaped, non-empty identifier")


def _require_revision_id(name: str, value: str) -> None:
    if not isinstance(value, str) or not _REVISION_PATTERN.fullmatch(value):
        raise ValueError(f"{name} must be a canonical revision ID")


def _require_digest(name: str, value: str) -> None:
    if not isinstance(value, str) or not _DIGEST_PATTERN.fullmatch(value):
        raise ValueError(f"{name} must be a sha256:<64 lowercase hex> digest")


def _immutable_string_tuple(
    name: str, value: Tuple[str, ...], *, required: bool = False
) -> Tuple[str, ...]:
    copied = tuple(value)
    if required and not copied:
        raise ValueError(f"{name} requires at least one reference")
    if not all(isinstance(item, str) and item for item in copied):
        raise ValueError(f"{name} elements must be non-empty strings")
    return copied


def _immutable_digest_map(name: str, value: Mapping[str, str]) -> Mapping[str, str]:
    copied = dict(value)
    for key, digest in copied.items():
        _require_identifier(f"{name} key", key)
        _require_digest(f"{name}[{key}]", digest)
    return MappingProxyType(copied)


class BuildStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"
    BLOCKED = "blocked"


class ReviewDisposition(StrEnum):
    PENDING = "pending"
    REQUEST_CHANGES = "request_changes"
    ACCEPTED_FOR_MVI_REVIEW = "accepted_for_mvi_review"
    REJECTED = "rejected"


@dataclass(frozen=True)
class TruthBoundary:
    review_state: str = "needs_human_review"
    fabrication_release: bool = False
    machine_actuation: bool = False
    exact_kernel_connected: bool = False
    agent_transport_connected: bool = False

    def __post_init__(self) -> None:
        self.assert_safe()

    def assert_safe(self) -> None:
        if self.review_state != "needs_human_review":
            raise ValueError("Piton MVI review_state must remain needs_human_review")
        if self.fabrication_release is not False:
            raise ValueError("Piton MVI cannot issue fabrication release")
        if self.machine_actuation is not False:
            raise ValueError("Piton MVI cannot actuate machines")


@dataclass(frozen=True)
class ChangeProposal:
    proposal_id: str
    base_revision_id: str
    parameter_id: str
    expected_old_quantity: str
    new_quantity: str
    requirement_ids: Tuple[str, ...] = ()

    def __post_init__(self) -> None:
        _require_identifier("proposal_id", self.proposal_id)
        _require_revision_id("base_revision_id", self.base_revision_id)
        _require_identifier("parameter_id", self.parameter_id)
        for name in ("expected_old_quantity", "new_quantity"):
            value = getattr(self, name)
            if not isinstance(value, str) or not value.strip():
                raise ValueError(f"{name} must be a non-empty quantity string")
        requirements = _immutable_string_tuple("requirement_ids", self.requirement_ids)
        for requirement_id in requirements:
            _require_identifier("requirement_id", requirement_id)
        object.__setattr__(self, "requirement_ids", requirements)


@dataclass(frozen=True)
class BuildAttempt:
    attempt_id: str
    revision_id: str
    recipe_digest: str
    environment_digest: str
    status: BuildStatus = BuildStatus.PENDING
    artifact_digests: Mapping[str, str] = field(default_factory=dict)
    diagnostics: Tuple[str, ...] = ()

    def __post_init__(self) -> None:
        _require_identifier("attempt_id", self.attempt_id)
        _require_revision_id("revision_id", self.revision_id)
        _require_digest("recipe_digest", self.recipe_digest)
        _require_digest("environment_digest", self.environment_digest)
        try:
            status = BuildStatus(self.status)
        except ValueError as exc:
            raise ValueError("unknown build status") from exc
        object.__setattr__(self, "status", status)
        object.__setattr__(
            self,
            "artifact_digests",
            _immutable_digest_map("artifact_digests", self.artifact_digests),
        )
        object.__setattr__(
            self, "diagnostics", _immutable_string_tuple("diagnostics", self.diagnostics)
        )


@dataclass(frozen=True)
class EvidenceClosure:
    closure_id: str
    revision_id: str
    attempt_id: str
    requirement_ids: Tuple[str, ...]
    receipt_digests: Tuple[str, ...]
    policy_digest: str

    def __post_init__(self) -> None:
        _require_identifier("closure_id", self.closure_id)
        _require_revision_id("revision_id", self.revision_id)
        _require_identifier("attempt_id", self.attempt_id)
        requirements = _immutable_string_tuple(
            "requirement_ids", self.requirement_ids, required=True
        )
        for requirement_id in requirements:
            _require_identifier("requirement_id", requirement_id)
        receipts = _immutable_string_tuple(
            "receipt_digests", self.receipt_digests, required=True
        )
        for receipt in receipts:
            _require_digest("receipt_digest", receipt)
        _require_digest("policy_digest", self.policy_digest)
        object.__setattr__(self, "requirement_ids", requirements)
        object.__setattr__(self, "receipt_digests", receipts)


@dataclass(frozen=True)
class DraftExport:
    export_id: str
    revision_id: str
    attempt_id: str
    artifact_digests: Mapping[str, str]
    unreleased: bool = True

    def __post_init__(self) -> None:
        _require_identifier("export_id", self.export_id)
        _require_revision_id("revision_id", self.revision_id)
        _require_identifier("attempt_id", self.attempt_id)
        self.assert_unreleased()
        artifacts = _immutable_digest_map("artifact_digests", self.artifact_digests)
        if not artifacts:
            raise ValueError("draft export requires at least one artifact")
        object.__setattr__(self, "artifact_digests", artifacts)

    def assert_unreleased(self) -> None:
        if self.unreleased is not True:
            raise ValueError("Stage 1 exports must remain visibly unreleased")


def validate_lifecycle(
    revision: DesignRevision,
    attempt: BuildAttempt,
    *,
    evidence: EvidenceClosure | None = None,
    draft_export: DraftExport | None = None,
) -> None:
    """Check safe cross-record consistency without pretending to be a state store."""
    if attempt.revision_id != revision.revision_id:
        raise ValueError("build attempt must target the supplied revision")

    derived_records = tuple(record for record in (evidence, draft_export) if record is not None)
    if derived_records and attempt.status is not BuildStatus.SUCCEEDED:
        raise ValueError("evidence and exports require a successful build attempt")
    for record in derived_records:
        if record.revision_id != revision.revision_id or record.attempt_id != attempt.attempt_id:
            raise ValueError("derived record must match its revision and build attempt")

    if draft_export is not None:
        for name, digest in draft_export.artifact_digests.items():
            if attempt.artifact_digests.get(name) != digest:
                raise ValueError("draft export artifacts must come from the successful build")
