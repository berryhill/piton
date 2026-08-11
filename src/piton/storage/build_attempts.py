"""Durable admission for exact-revision build attempts.

The coordinator commits an immutable attempt and its initial mutable execution
state in one daemon-owned transaction. Only after that transaction returns may
the optional dispatch seam observe the request.
"""

from __future__ import annotations

import re
import sqlite3
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Callable

from .db import Database

_DIGEST = re.compile(r"^sha256:[0-9a-f]{64}$")
_ISOLATION_CLASSES = frozenset({"wasm", "container", "microvm", "trusted-local"})
_ADMISSION_CAPABILITY_PROOF = object()


class AdmissionAuthorityError(PermissionError):
    """Admission was attempted without daemon-issued authority."""


class AdmissionCapability:
    """Opaque authority issued only by the trusted daemon composition root."""

    __slots__ = ("_proof",)

    def __new__(cls, proof: object = None) -> "AdmissionCapability":
        if proof is not _ADMISSION_CAPABILITY_PROOF:
            raise AdmissionAuthorityError("admission capability is server-issued only")
        instance = super().__new__(cls)
        instance._proof = proof
        return instance


def _issue_server_admission_capability() -> AdmissionCapability:
    """Issue trusted admission authority; never derive it from request content."""
    return AdmissionCapability(_ADMISSION_CAPABILITY_PROOF)


def _require_admission_capability(capability: object) -> None:
    if (
        type(capability) is not AdmissionCapability
        or getattr(capability, "_proof", None) is not _ADMISSION_CAPABILITY_PROOF
    ):
        raise AdmissionAuthorityError("server-issued admission capability is required")


class BuildAttemptConflictError(RuntimeError):
    """An immutable attempt identity is already in durable custody."""


def _required(name: str, value: str) -> None:
    if not isinstance(value, str) or not value:
        raise ValueError(f"{name} must be a non-empty string")


def _digest(name: str, value: str) -> None:
    if not isinstance(value, str) or _DIGEST.fullmatch(value) is None:
        raise ValueError(f"{name} must be a sha256:<64 lowercase hex> digest")


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="microseconds").replace("+00:00", "Z")


def _uuid_attempt_id() -> str:
    return str(uuid.uuid4())


@dataclass(frozen=True, slots=True)
class BuildAdmission:
    """Untrusted request claims; attempt identity and authority are server-owned."""

    project_id: str
    revision_id: str
    input_manifest_digest: str
    recipe_digest: str
    toolchain_digest: str
    capability_manifest_digest: str
    resource_limits_digest: str
    expected_outputs_digest: str
    request_signature_digest: str
    worker_id: str
    isolation_class: str

    def __post_init__(self) -> None:
        for name in ("project_id", "revision_id", "worker_id"):
            _required(name, getattr(self, name))
        for name in (
            "input_manifest_digest",
            "recipe_digest",
            "toolchain_digest",
            "capability_manifest_digest",
            "resource_limits_digest",
            "expected_outputs_digest",
            "request_signature_digest",
        ):
            _digest(name, getattr(self, name))
        if self.isolation_class not in _ISOLATION_CLASSES:
            raise ValueError("isolation_class must be a declared Piton isolation class")


@dataclass(frozen=True, slots=True)
class DurableBuildAttempt:
    attempt_id: str
    project_id: str
    revision_id: str
    input_manifest_digest: str
    recipe_digest: str
    toolchain_digest: str
    capability_manifest_digest: str
    resource_limits_digest: str
    expected_outputs_digest: str
    request_signature_digest: str
    worker_id: str
    isolation_class: str
    admission_state: str
    admitted_at: str


@dataclass(frozen=True, slots=True)
class CoordinatorState:
    attempt_id: str
    state: str
    generation: int
    fence: int
    lease_id: str | None
    lease_expires_at: str | None
    updated_at: str


DispatchSeam = Callable[[DurableBuildAttempt], None]
AttemptIdFactory = Callable[[], str]


class BuildAttemptCoordinator:
    """Daemon-owned admission boundary; it does not grant authored-state authority."""

    def __init__(
        self,
        database: Database,
        *,
        attempt_id_factory: AttemptIdFactory = _uuid_attempt_id,
    ) -> None:
        if not isinstance(database, Database):
            raise TypeError("database must be a Database")
        if not callable(attempt_id_factory):
            raise TypeError("attempt_id_factory must be callable")
        self._database = database
        self._attempt_id_factory = attempt_id_factory

    def admit(
        self,
        request: BuildAdmission,
        *,
        capability: AdmissionCapability,
        dispatch: DispatchSeam | None = None,
    ) -> DurableBuildAttempt:
        """Persist attempt plus initial state atomically, then optionally dispatch."""
        _require_admission_capability(capability)
        if not isinstance(request, BuildAdmission):
            raise TypeError("request must be a BuildAdmission")
        if dispatch is not None and not callable(dispatch):
            raise TypeError("dispatch must be callable")

        attempt_id = self._attempt_id_factory()
        _required("server-derived attempt_id", attempt_id)
        admitted_at = _now()
        values = (
            attempt_id,
            request.project_id,
            request.revision_id,
            request.input_manifest_digest,
            request.recipe_digest,
            request.toolchain_digest,
            request.capability_manifest_digest,
            request.resource_limits_digest,
            request.expected_outputs_digest,
            request.request_signature_digest,
            request.worker_id,
            request.isolation_class,
            "admitted",
            admitted_at,
        )
        with self._database.immediate() as connection:
            exact_revision = connection.execute(
                "SELECT 1 FROM design_revisions WHERE revision_id=? AND project_id=?",
                (request.revision_id, request.project_id),
            ).fetchone()
            if exact_revision is None:
                raise ValueError("revision does not belong to the exact project")
            try:
                connection.execute(
                    "INSERT INTO build_attempts("
                    "attempt_id, project_id, revision_id, input_manifest_digest, recipe_digest, "
                    "toolchain_digest, capability_manifest_digest, resource_limits_digest, "
                    "expected_outputs_digest, request_signature_digest, worker_id, isolation_class, "
                    "admission_state, admitted_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    values,
                )
                connection.execute(
                    "INSERT INTO build_coordinator_state("
                    "attempt_id, state, generation, fence, lease_id, lease_expires_at, updated_at) "
                    "VALUES(?, 'admitted', 0, 0, NULL, NULL, ?)",
                    (attempt_id, admitted_at),
                )
            except sqlite3.IntegrityError as error:
                if connection.execute(
                    "SELECT 1 FROM build_attempts WHERE attempt_id=?", (attempt_id,)
                ).fetchone() is not None:
                    raise BuildAttemptConflictError(
                        "build attempt identity is already in durable custody; retry needs a new attempt"
                    ) from error
                raise

        record = DurableBuildAttempt(*values)
        if dispatch is not None:
            dispatch(record)
        return record

    def get_attempt(self, project_id: str, attempt_id: str) -> DurableBuildAttempt:
        _required("project_id", project_id)
        _required("attempt_id", attempt_id)
        with self._database.read() as connection:
            row = connection.execute(
                "SELECT attempt_id, project_id, revision_id, input_manifest_digest, recipe_digest, "
                "toolchain_digest, capability_manifest_digest, resource_limits_digest, "
                "expected_outputs_digest, request_signature_digest, worker_id, isolation_class, "
                "admission_state, admitted_at FROM build_attempts "
                "WHERE project_id=? AND attempt_id=?",
                (project_id, attempt_id),
            ).fetchone()
        if row is None:
            raise LookupError("build attempt was not found")
        return DurableBuildAttempt(*tuple(row))

    def get_state(self, project_id: str, attempt_id: str) -> CoordinatorState:
        _required("project_id", project_id)
        _required("attempt_id", attempt_id)
        with self._database.read() as connection:
            row = connection.execute(
                "SELECT state.attempt_id, state.state, state.generation, state.fence, "
                "state.lease_id, state.lease_expires_at, state.updated_at "
                "FROM build_coordinator_state AS state "
                "JOIN build_attempts AS attempt ON attempt.attempt_id=state.attempt_id "
                "WHERE attempt.project_id=? AND state.attempt_id=?",
                (project_id, attempt_id),
            ).fetchone()
        if row is None:
            raise LookupError("build coordinator state was not found")
        return CoordinatorState(*tuple(row))

    def get_execution_bindings(
        self, project_id: str, attempt_id: str
    ) -> tuple[DurableBuildAttempt, CoordinatorState]:
        """Read the immutable attempt and current coordinator lease atomically."""
        _required("project_id", project_id)
        _required("attempt_id", attempt_id)
        with self._database.read() as connection:
            row = connection.execute(
                "SELECT attempt.attempt_id, attempt.project_id, attempt.revision_id, "
                "attempt.input_manifest_digest, attempt.recipe_digest, attempt.toolchain_digest, "
                "attempt.capability_manifest_digest, attempt.resource_limits_digest, "
                "attempt.expected_outputs_digest, attempt.request_signature_digest, "
                "attempt.worker_id, attempt.isolation_class, attempt.admission_state, "
                "attempt.admitted_at, state.attempt_id, state.state, state.generation, "
                "state.fence, state.lease_id, state.lease_expires_at, state.updated_at "
                "FROM build_attempts AS attempt JOIN build_coordinator_state AS state "
                "ON state.attempt_id=attempt.attempt_id "
                "WHERE attempt.project_id=? AND attempt.attempt_id=?",
                (project_id, attempt_id),
            ).fetchone()
        if row is None:
            raise LookupError("build execution bindings were not found")
        values = tuple(row)
        return DurableBuildAttempt(*values[:14]), CoordinatorState(*values[14:])
