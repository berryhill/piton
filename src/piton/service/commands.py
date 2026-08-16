"""Typed command values for Piton's sole custody application boundary."""

from __future__ import annotations

from dataclasses import dataclass
from types import MappingProxyType
from typing import Mapping

from ..source_tree import SourceTree


def _required(name: str, value: str) -> None:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} must be a non-empty string")


def _parameters(values: Mapping[str, str]) -> Mapping[str, str]:
    copied = dict(values)
    if not all(isinstance(key, str) and key for key in copied):
        raise ValueError("parameter names must be non-empty strings")
    if not all(isinstance(value, str) for value in copied.values()):
        raise ValueError("parameter values must be strings")
    return MappingProxyType(copied)


def _generation(value: int) -> None:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError("expected_generation must be a non-negative integer")


@dataclass(frozen=True, slots=True)
class CreateProject:
    command_id: str
    project_id: str
    display_name: str

    def __post_init__(self) -> None:
        for name in ("command_id", "project_id", "display_name"):
            _required(name, getattr(self, name))


@dataclass(frozen=True, slots=True)
class ImportSourceBase:
    command_id: str
    project_id: str
    source_tree: SourceTree
    parameter_values: Mapping[str, str]

    def __post_init__(self) -> None:
        _required("command_id", self.command_id)
        _required("project_id", self.project_id)
        if not isinstance(self.source_tree, SourceTree):
            raise TypeError("source_tree must be a SourceTree")
        object.__setattr__(self, "parameter_values", _parameters(self.parameter_values))


@dataclass(frozen=True, slots=True)
class BeginDraft:
    command_id: str
    project_id: str
    base_revision_id: str
    expected_generation: int

    def __post_init__(self) -> None:
        for name in ("command_id", "project_id", "base_revision_id"):
            _required(name, getattr(self, name))
        _generation(self.expected_generation)


@dataclass(frozen=True, slots=True)
class UpdateDraft:
    command_id: str
    project_id: str
    draft_id: str
    source_tree: SourceTree

    def __post_init__(self) -> None:
        for name in ("command_id", "project_id", "draft_id"):
            _required(name, getattr(self, name))
        if not isinstance(self.source_tree, SourceTree):
            raise TypeError("source_tree must be a SourceTree")


@dataclass(frozen=True, slots=True)
class CommitDraft:
    command_id: str
    project_id: str
    draft_id: str
    expected_revision_id: str
    expected_generation: int
    parameter_values: Mapping[str, str]

    def __post_init__(self) -> None:
        for name in ("command_id", "project_id", "draft_id", "expected_revision_id"):
            _required(name, getattr(self, name))
        _generation(self.expected_generation)
        object.__setattr__(self, "parameter_values", _parameters(self.parameter_values))


@dataclass(frozen=True, slots=True)
class DiscardDraft:
    command_id: str
    project_id: str
    draft_id: str

    def __post_init__(self) -> None:
        for name in ("command_id", "project_id", "draft_id"):
            _required(name, getattr(self, name))


@dataclass(frozen=True, slots=True)
class RestoreForward:
    command_id: str
    project_id: str
    target_revision_id: str
    expected_revision_id: str
    expected_generation: int

    def __post_init__(self) -> None:
        for name in (
            "command_id",
            "project_id",
            "target_revision_id",
            "expected_revision_id",
        ):
            _required(name, getattr(self, name))
        _generation(self.expected_generation)


@dataclass(frozen=True, slots=True)
class DeleteProject:
    command_id: str
    project_id: str
    reason: str
    expected_state: str

    def __post_init__(self) -> None:
        for name in ("command_id", "project_id", "reason", "expected_state"):
            _required(name, getattr(self, name))


def _revision_id(name: str, value: str) -> None:
    if not isinstance(value, str) or not value:
        raise ValueError(f"{name} must be a non-empty revision id")


def _digest(name: str, value: str) -> None:
    if not isinstance(value, str) or not value:
        raise ValueError(f"{name} must be a non-empty digest")


def _channel(value: str) -> None:
    if value not in ("workspace", "candidate", "review", "last_good"):
        raise ValueError("channel must be a declared Piton channel")


def _disposition_state(name: str, value: str) -> None:
    if value not in (
        "submitted",
        "withdrawn",
        "rejected",
        "changes_requested",
        "accepted_for_build",
        "accepted_for_review",
    ):
        raise ValueError(f"{name} must be a known proposal disposition state")


def _scoped_decision(name: str, value: str) -> None:
    import re

    if not isinstance(value, str) or not re.fullmatch(r"[a-z][a-z0-9_]{0,63}", value):
        raise ValueError(f"{name} must be a lowercase scoped decision identifier")


def _nonempty(name: str, value: str) -> None:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} must be a non-empty string")


def _tuple_of_strings(name: str, value: tuple) -> None:
    if not isinstance(value, tuple) or not value:
        raise ValueError(f"{name} must be a non-empty tuple")
    if not all(isinstance(item, str) and item for item in value):
        raise ValueError(f"{name} elements must be non-empty strings")


@dataclass(frozen=True, slots=True)
class AdmitChangeProposal:
    command_id: str
    project_id: str
    proposal_id: str
    base_revision_id: str
    parameter_id: str
    expected_old_quantity: str
    new_quantity: str
    requirement_ids: tuple = ()

    def __post_init__(self) -> None:
        for name in ("command_id", "project_id", "proposal_id", "parameter_id"):
            _required(name, getattr(self, name))
        _revision_id("base_revision_id", self.base_revision_id)
        for name in ("expected_old_quantity", "new_quantity"):
            _nonempty(name, getattr(self, name))
        _tuple_of_strings("requirement_ids", self.requirement_ids)


@dataclass(frozen=True, slots=True)
class RecordProposalDisposition:
    command_id: str
    project_id: str
    disposition_id: str
    proposal_id: str
    base_revision_id: str
    state: str
    reason: str

    def __post_init__(self) -> None:
        for name in (
            "command_id",
            "project_id",
            "disposition_id",
            "proposal_id",
            "reason",
        ):
            _required(name, getattr(self, name))
        _revision_id("base_revision_id", self.base_revision_id)
        _disposition_state("state", self.state)


@dataclass(frozen=True, slots=True)
class AdmitBuildAttempt:
    command_id: str
    project_id: str
    attempt_id: str
    revision_id: str
    recipe_digest: str
    environment_digest: str
    toolchain_digest: str
    capability_manifest_digest: str
    resource_limits_digest: str
    expected_outputs_digest: str
    request_signature_digest: str
    input_manifest_digest: str
    worker_id: str
    isolation_class: str

    def __post_init__(self) -> None:
        for name in ("command_id", "project_id", "attempt_id", "worker_id"):
            _required(name, getattr(self, name))
        _revision_id("revision_id", self.revision_id)
        for name in (
            "recipe_digest",
            "environment_digest",
            "toolchain_digest",
            "capability_manifest_digest",
            "resource_limits_digest",
            "expected_outputs_digest",
            "request_signature_digest",
            "input_manifest_digest",
        ):
            _digest(name, getattr(self, name))
        if self.isolation_class not in ("wasm", "container", "microvm", "trusted-local"):
            raise ValueError("isolation_class must be a declared Piton isolation class")


@dataclass(frozen=True, slots=True)
class RecordEvidenceClosure:
    command_id: str
    project_id: str
    closure_id: str
    revision_id: str
    attempt_id: str
    requirement_ids: tuple
    receipt_digests: tuple
    policy_digest: str

    def __post_init__(self) -> None:
        for name in (
            "command_id",
            "project_id",
            "closure_id",
            "attempt_id",
            "policy_digest",
        ):
            _required(name, getattr(self, name))
        _revision_id("revision_id", self.revision_id)
        _tuple_of_strings("requirement_ids", self.requirement_ids)
        _tuple_of_strings("receipt_digests", self.receipt_digests)
        for item in self.receipt_digests:
            if not item.startswith("sha256:"):
                raise ValueError("receipt_digests must be sha256 digests")


@dataclass(frozen=True, slots=True)
class MoveChannel:
    command_id: str
    project_id: str
    channel: str
    target_revision_id: str | None
    expected_revision_id: str | None
    expected_generation: int

    def __post_init__(self) -> None:
        for name in ("command_id", "project_id"):
            _required(name, getattr(self, name))
        _channel(self.channel)
        if self.target_revision_id is not None:
            _revision_id("target_revision_id", self.target_revision_id)
        if self.expected_revision_id is not None:
            _revision_id("expected_revision_id", self.expected_revision_id)
        _generation(self.expected_generation)


@dataclass(frozen=True, slots=True)
class SignApproval:
    command_id: str
    project_id: str
    receipt_id: str
    revision_id: str
    evidence_closure_id: str
    scoped_decision: str
    scope_reason: str
    declared_at: str

    def __post_init__(self) -> None:
        for name in (
            "command_id",
            "project_id",
            "receipt_id",
            "evidence_closure_id",
            "scope_reason",
            "declared_at",
        ):
            _required(name, getattr(self, name))
        _revision_id("revision_id", self.revision_id)
        _scoped_decision("scoped_decision", self.scoped_decision)


@dataclass(frozen=True, slots=True)
class CreateDraftExport:
    command_id: str
    project_id: str
    receipt_id: str
    export_id: str
    revision_id: str
    attempt_id: str
    authority_profile: str
    exact_body_digest: str
    step_digest: str
    units: str
    warnings: tuple
    environment_lock_digest: str
    validation_report_digest: str

    def __post_init__(self) -> None:
        for name in (
            "command_id",
            "project_id",
            "receipt_id",
            "export_id",
            "attempt_id",
            "authority_profile",
            "units",
            "environment_lock_digest",
            "validation_report_digest",
        ):
            _required(name, getattr(self, name))
        _revision_id("revision_id", self.revision_id)
        for name in ("exact_body_digest", "step_digest"):
            _digest(name, getattr(self, name))
        if not isinstance(self.warnings, tuple):
            raise ValueError("warnings must be a tuple of strings")
        if not all(isinstance(item, str) and item for item in self.warnings):
            raise ValueError("warnings elements must be non-empty strings")


@dataclass(frozen=True, slots=True)
class RejectFabricationRelease:
    command_id: str
    project_id: str
    release_id: str
    approval_receipt_id: str
    revision_id: str
    deliverables_digest: str
    declared_at: str

    def __post_init__(self) -> None:
        for name in (
            "command_id",
            "project_id",
            "release_id",
            "approval_receipt_id",
            "deliverables_digest",
            "declared_at",
        ):
            _required(name, getattr(self, name))
        _revision_id("revision_id", self.revision_id)


@dataclass(frozen=True, slots=True)
class RecordReleasedPackageProjection:
    command_id: str
    project_id: str
    projection_id: str
    release_id: str
    package_digest: str
    units: str
    declared_at: str

    def __post_init__(self) -> None:
        for name in (
            "command_id",
            "project_id",
            "projection_id",
            "release_id",
            "package_digest",
            "units",
            "declared_at",
        ):
            _required(name, getattr(self, name))
