"""Predeclared deterministic checks and daemon-owned evidence closure custody.

Evidence records are immutable execution facts. They cannot mutate authored
revisions, channels, review dispositions, approvals, exports, release state, or
machinery.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import stat
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from types import MappingProxyType
from typing import Any, BinaryIO, Callable, Iterator, Mapping, Sequence

from .storage.build_attempts import CoordinatorState, DurableBuildAttempt
from .storage.blobs import ArtifactRef, BlobStore
from .storage.db import Database
from .worker_contracts import PrecisionWorkerResult, canonical_json_bytes

_DIGEST = re.compile(r"^sha256:[0-9a-f]{64}$")
_REVISION = re.compile(r"^rev_[0-9a-f]{64}$")
_TRUTH = {
    "review_state": "needs_human_review",
    "fabrication_release": False,
    "machine_actuation": False,
}


class EvidenceClosureError(RuntimeError):
    """Evidence cannot close exactly under current daemon custody."""


def canonical_digest(value: Mapping[str, Any]) -> str:
    return "sha256:" + hashlib.sha256(canonical_json_bytes(value)).hexdigest()


def _digest(name: str, value: str) -> None:
    if not isinstance(value, str) or _DIGEST.fullmatch(value) is None:
        raise ValueError(f"{name} must be a sha256:<64 lowercase hex> digest")


def _identifier(name: str, value: str) -> None:
    if not isinstance(value, str) or not value or len(value) > 256:
        raise ValueError(f"{name} must be a bounded non-empty string")


def _revision(value: str) -> None:
    if not isinstance(value, str) or _REVISION.fullmatch(value) is None:
        raise ValueError("revision_id must be a rev_<64 lowercase hex> identity")


def _string_tuple(
    name: str, value: Sequence[str], *, required: bool = False
) -> tuple[str, ...]:
    copied = tuple(value)
    if required and not copied:
        raise ValueError(f"{name} must not be empty")
    if len(copied) > 16 or any(
        not isinstance(item, str) or not item or len(item) > 256 for item in copied
    ):
        raise ValueError(f"{name} must contain bounded non-empty strings")
    return copied


def _digest_map(name: str, value: Mapping[str, str]) -> Mapping[str, str]:
    copied = dict(value)
    if not copied:
        if name == "evidence_inputs":
            raise ValueError(
                "evidence_inputs must close exactly the declared evidence roles"
            )
        raise ValueError(f"{name} must not be empty")
    for role, digest in copied.items():
        _identifier(f"{name} role", role)
        _digest(f"{name} digest", digest)
    return MappingProxyType(dict(sorted(copied.items())))


def _procedure_digest(namespace: str, procedure: Mapping[str, Any]) -> str:
    return canonical_digest({"namespace": namespace, "procedure": procedure})


@dataclass(frozen=True, slots=True)
class CheckDefinition:
    check_id: str
    checker_digest: str
    comparator_digest: str
    method: str
    units: str
    tolerance: str | None
    evidence_roles: tuple[str, ...]
    invalidation_conditions: tuple[str, ...]
    claim_scope: str

    def __post_init__(self) -> None:
        for name in ("check_id", "method", "units", "claim_scope"):
            _identifier(name, getattr(self, name))
        _digest("checker_digest", self.checker_digest)
        _digest("comparator_digest", self.comparator_digest)
        if self.tolerance is not None:
            _identifier("tolerance", self.tolerance)
        roles = _string_tuple("evidence_roles", self.evidence_roles, required=True)
        invalidation = _string_tuple(
            "invalidation_conditions", self.invalidation_conditions, required=True
        )
        if len(set(roles)) != len(roles):
            raise ValueError("evidence_roles must be unique")
        object.__setattr__(self, "evidence_roles", roles)
        object.__setattr__(self, "invalidation_conditions", invalidation)

    def to_primitive(self) -> dict[str, Any]:
        return {
            "check_id": self.check_id,
            "checker_digest": self.checker_digest,
            "comparator_digest": self.comparator_digest,
            "method": self.method,
            "units": self.units,
            "tolerance": self.tolerance,
            "evidence_roles": list(self.evidence_roles),
            "invalidation_conditions": list(self.invalidation_conditions),
            "claim_scope": self.claim_scope,
        }

    @classmethod
    def from_primitive(cls, value: Mapping[str, Any]) -> "CheckDefinition":
        return cls(
            check_id=value["check_id"],
            checker_digest=value["checker_digest"],
            comparator_digest=value["comparator_digest"],
            method=value["method"],
            units=value["units"],
            tolerance=value["tolerance"],
            evidence_roles=tuple(value["evidence_roles"]),
            invalidation_conditions=tuple(value["invalidation_conditions"]),
            claim_scope=value["claim_scope"],
        )


_INVALIDATE = (
    "revision, attempt, worker result, artifact digest, checker, comparator, or policy changes",
    "pinned toolchain or declared execution environment changes",
)
PREDECLARED_CHECKS = (
    CheckDefinition(
        check_id="exact-artifact-closure",
        checker_digest=_procedure_digest(
            "piton.checker.exact-artifact-closure.v1",
            {
                "roles": ["exact_brep", "step", "inspection_receipt"],
                "operation": "digest closure",
            },
        ),
        comparator_digest=_procedure_digest(
            "piton.comparator.exact-artifact-closure.v1",
            {"expected": "all roles digest-bound"},
        ),
        method="canonical digest and exact-receipt binding comparison",
        units="mm",
        tolerance=None,
        evidence_roles=("exact_brep", "step", "inspection_receipt"),
        invalidation_conditions=_INVALIDATE,
        claim_scope="exact-derived-realization-consistency; STEP not receiver-qualified",
    ),
    CheckDefinition(
        check_id="one-valid-solid",
        checker_digest=_procedure_digest(
            "piton.checker.one-valid-solid.v1",
            {
                "receipt_field": "inspection.valid",
                "count_field": "topology_counts.solids",
            },
        ),
        comparator_digest=_procedure_digest(
            "piton.comparator.one-valid-solid.v1", {"valid": True, "solids": 1}
        ),
        method="pinned OCCT inspection receipt field comparison",
        units="count",
        tolerance="0",
        evidence_roles=("exact_brep", "inspection_receipt"),
        invalidation_conditions=_INVALIDATE,
        claim_scope="exact topology observation; no fitness-for-purpose claim",
    ),
    CheckDefinition(
        check_id="review-artifact-binding",
        checker_digest=_procedure_digest(
            "piton.checker.review-artifact-binding.v1",
            {
                "roles": [
                    "review_glb",
                    "review_selection_map",
                    "review_glb_receipt",
                    "review_selection_map_receipt",
                ]
            },
        ),
        comparator_digest=_procedure_digest(
            "piton.comparator.review-artifact-binding.v1",
            {
                "identity_scope": "artifact-local; no durable topology identity; no nearest fallback"
            },
        ),
        method="review derivative receipt and artifact-local selection binding comparison",
        units="mm",
        tolerance=None,
        evidence_roles=(
            "review_glb",
            "review_selection_map",
            "review_glb_receipt",
            "review_selection_map_receipt",
        ),
        invalidation_conditions=_INVALIDATE,
        claim_scope="review-only; artifact-local selection identity",
    ),
)


@dataclass(frozen=True, slots=True)
class EvidenceCheckDeclaration:
    project_id: str
    revision_id: str
    attempt_id: str
    expected_outputs_digest: str
    checks: tuple[CheckDefinition, ...] = field(
        default_factory=lambda: PREDECLARED_CHECKS
    )
    truth: Mapping[str, Any] = field(default_factory=lambda: dict(_TRUTH))
    declaration_digest: str = field(init=False)

    def __post_init__(self) -> None:
        for name in ("project_id", "attempt_id"):
            _identifier(name, getattr(self, name))
        _revision(self.revision_id)
        _digest("expected_outputs_digest", self.expected_outputs_digest)
        checks = tuple(self.checks)
        if not 3 <= len(checks) <= 5 or len({item.check_id for item in checks}) != len(
            checks
        ):
            raise ValueError("declaration requires three to five unique checks")
        if checks != PREDECLARED_CHECKS:
            raise ValueError("caller-supplied check substitutions are forbidden")
        if dict(self.truth) != _TRUTH:
            raise ValueError("evidence declaration violates the root truth boundary")
        object.__setattr__(self, "checks", checks)
        object.__setattr__(self, "truth", MappingProxyType(dict(_TRUTH)))
        object.__setattr__(
            self, "declaration_digest", canonical_digest(self.to_primitive())
        )

    @classmethod
    def for_attempt(
        cls,
        *,
        project_id: str,
        revision_id: str,
        attempt_id: str,
        expected_outputs_digest: str,
    ) -> "EvidenceCheckDeclaration":
        return cls(project_id, revision_id, attempt_id, expected_outputs_digest)

    def to_primitive(self) -> dict[str, Any]:
        return {
            "schema": "piton.evidence-check-declaration.v1",
            "project_id": self.project_id,
            "revision_id": self.revision_id,
            "attempt_id": self.attempt_id,
            "expected_outputs_digest": self.expected_outputs_digest,
            "checks": [item.to_primitive() for item in self.checks],
            "truth": dict(self.truth),
        }

    @property
    def canonical_bytes(self) -> bytes:
        payload = self.to_primitive()
        payload["declaration_digest"] = self.declaration_digest
        return canonical_json_bytes(payload)


@dataclass(frozen=True, slots=True)
class CheckReceipt:
    check_id: str
    declaration_digest: str
    revision_id: str
    attempt_id: str
    worker_result_digest: str
    toolchain_digest: str
    environment_digest: str
    checker_digest: str
    comparator_digest: str
    checker_command: str
    checker_version: str
    method: str
    units: str
    tolerance: str | None
    evidence_inputs: Mapping[str, str]
    status: str
    measured: Mapping[str, str]
    warnings: tuple[str, ...]
    uncertainty: str
    invalidation_conditions: tuple[str, ...]
    claim_scope: str
    truth: Mapping[str, Any] = field(default_factory=lambda: dict(_TRUTH))
    receipt_digest: str = field(init=False)

    def __post_init__(self) -> None:
        for name in (
            "check_id",
            "attempt_id",
            "checker_command",
            "checker_version",
            "method",
            "units",
            "uncertainty",
            "claim_scope",
        ):
            _identifier(name, getattr(self, name))
        _revision(self.revision_id)
        for name in (
            "declaration_digest",
            "worker_result_digest",
            "toolchain_digest",
            "environment_digest",
            "checker_digest",
            "comparator_digest",
        ):
            _digest(name, getattr(self, name))
        if self.tolerance is not None:
            _identifier("tolerance", self.tolerance)
        if self.status not in {"pass", "fail", "blocked"}:
            raise ValueError("status must be pass, fail, or blocked")
        inputs = _digest_map("evidence_inputs", self.evidence_inputs)
        measured = dict(self.measured)
        if not measured or any(
            not isinstance(key, str)
            or not key
            or not isinstance(value, str)
            or not value
            for key, value in measured.items()
        ):
            raise ValueError("measured must contain deterministic string facts")
        warnings = _string_tuple("warnings", self.warnings)
        invalidation = _string_tuple(
            "invalidation_conditions", self.invalidation_conditions, required=True
        )
        definition = next(
            (item for item in PREDECLARED_CHECKS if item.check_id == self.check_id),
            None,
        )
        if definition is None or set(inputs) != set(definition.evidence_roles):
            raise ValueError(
                "evidence_inputs must close exactly the declared evidence roles"
            )
        if dict(self.truth) != _TRUTH:
            raise ValueError("check receipt violates the root truth boundary")
        object.__setattr__(self, "evidence_inputs", inputs)
        object.__setattr__(
            self, "measured", MappingProxyType(dict(sorted(measured.items())))
        )
        object.__setattr__(self, "warnings", warnings)
        object.__setattr__(self, "invalidation_conditions", invalidation)
        object.__setattr__(self, "truth", MappingProxyType(dict(_TRUTH)))
        object.__setattr__(
            self, "receipt_digest", canonical_digest(self.to_primitive())
        )

    def to_primitive(self) -> dict[str, Any]:
        return {
            "schema": "piton.check-receipt.v1",
            "check_id": self.check_id,
            "declaration_digest": self.declaration_digest,
            "revision_id": self.revision_id,
            "attempt_id": self.attempt_id,
            "worker_result_digest": self.worker_result_digest,
            "toolchain_digest": self.toolchain_digest,
            "environment_digest": self.environment_digest,
            "checker_digest": self.checker_digest,
            "comparator_digest": self.comparator_digest,
            "checker_command": self.checker_command,
            "checker_version": self.checker_version,
            "method": self.method,
            "units": self.units,
            "tolerance": self.tolerance,
            "evidence_inputs": dict(self.evidence_inputs),
            "status": self.status,
            "measured": dict(self.measured),
            "warnings": list(self.warnings),
            "uncertainty": self.uncertainty,
            "invalidation_conditions": list(self.invalidation_conditions),
            "claim_scope": self.claim_scope,
            "truth": dict(self.truth),
        }

    @property
    def canonical_bytes(self) -> bytes:
        payload = self.to_primitive()
        payload["receipt_digest"] = self.receipt_digest
        return canonical_json_bytes(payload)

    @classmethod
    def from_manifest(cls, value: Mapping[str, Any]) -> "CheckReceipt":
        receipt = cls(
            check_id=value["check_id"],
            declaration_digest=value["declaration_digest"],
            revision_id=value["revision_id"],
            attempt_id=value["attempt_id"],
            worker_result_digest=value["worker_result_digest"],
            toolchain_digest=value["toolchain_digest"],
            environment_digest=value["environment_digest"],
            checker_digest=value["checker_digest"],
            comparator_digest=value["comparator_digest"],
            checker_command=value["checker_command"],
            checker_version=value["checker_version"],
            method=value["method"],
            units=value["units"],
            tolerance=value["tolerance"],
            evidence_inputs=value["evidence_inputs"],
            status=value["status"],
            measured=value["measured"],
            warnings=tuple(value["warnings"]),
            uncertainty=value["uncertainty"],
            invalidation_conditions=tuple(value["invalidation_conditions"]),
            claim_scope=value["claim_scope"],
            truth=value["truth"],
        )
        if value.get("receipt_digest") != receipt.receipt_digest:
            raise ValueError("check receipt digest does not match canonical content")
        return receipt


@dataclass(frozen=True, slots=True)
class EvidenceClosure:
    project_id: str
    revision_id: str
    attempt_id: str
    declaration_digest: str
    worker_result_digest: str
    generation: int
    fence: int
    lease_id: str
    receipts: tuple[CheckReceipt, ...]
    artifacts: Mapping[str, Mapping[str, Any]]
    environment: Mapping[str, Any]
    truth: Mapping[str, Any] = field(default_factory=lambda: dict(_TRUTH))
    closure_digest: str = field(init=False)

    def __post_init__(self) -> None:
        _identifier("project_id", self.project_id)
        _revision(self.revision_id)
        for name in ("attempt_id", "lease_id"):
            _identifier(name, getattr(self, name))
        for name in ("declaration_digest", "worker_result_digest"):
            _digest(name, getattr(self, name))
        if type(self.generation) is not int or self.generation < 0:
            raise ValueError("generation must be non-negative")
        if type(self.fence) is not int or self.fence < 0:
            raise ValueError("fence must be non-negative")
        receipts = tuple(self.receipts)
        expected = tuple(item.check_id for item in PREDECLARED_CHECKS)
        if tuple(item.check_id for item in receipts) != expected:
            raise EvidenceClosureError(
                "receipt set does not close exactly the declaration"
            )
        if any(item.status != "pass" for item in receipts):
            raise EvidenceClosureError(
                "failed or blocked required checks cannot close evidence"
            )
        artifacts = {
            role: MappingProxyType(dict(value))
            for role, value in sorted(self.artifacts.items())
        }
        if dict(self.truth) != _TRUTH:
            raise ValueError("evidence closure violates the root truth boundary")
        object.__setattr__(self, "receipts", receipts)
        object.__setattr__(self, "artifacts", MappingProxyType(artifacts))
        object.__setattr__(
            self, "environment", MappingProxyType(dict(self.environment))
        )
        object.__setattr__(self, "truth", MappingProxyType(dict(_TRUTH)))
        object.__setattr__(
            self, "closure_digest", canonical_digest(self.to_primitive())
        )

    @property
    def review_state(self) -> str:
        return str(self.truth["review_state"])

    @property
    def fabrication_release(self) -> bool:
        return bool(self.truth["fabrication_release"])

    @property
    def machine_actuation(self) -> bool:
        return bool(self.truth["machine_actuation"])

    def to_primitive(self) -> dict[str, Any]:
        return {
            "schema": "piton.evidence-closure.v1",
            "project_id": self.project_id,
            "revision_id": self.revision_id,
            "attempt_id": self.attempt_id,
            "declaration_digest": self.declaration_digest,
            "worker_result_digest": self.worker_result_digest,
            "generation": self.generation,
            "fence": self.fence,
            "lease_id": self.lease_id,
            "receipt_digests": [item.receipt_digest for item in self.receipts],
            "artifacts": {role: dict(value) for role, value in self.artifacts.items()},
            "environment": dict(self.environment),
            "truth": dict(self.truth),
        }

    @property
    def canonical_bytes(self) -> bytes:
        payload = self.to_primitive()
        payload["closure_digest"] = self.closure_digest
        return canonical_json_bytes(payload)


class EvidenceRepository:
    """Append-only evidence records behind one daemon-owned Database boundary."""

    def __init__(
        self,
        database: Database,
        *,
        blobs: BlobStore | None = None,
        trusted_clock: Callable[[], datetime] | None = None,
    ) -> None:
        if not isinstance(database, Database):
            raise TypeError("database must be a Database")
        if blobs is not None and not isinstance(blobs, BlobStore):
            raise TypeError("blobs must be a BlobStore")
        if trusted_clock is not None and not callable(trusted_clock):
            raise TypeError("trusted_clock must be callable")
        self._database = database
        self._blobs = blobs
        self._trusted_clock = trusted_clock or (lambda: datetime.now(UTC))

    @staticmethod
    def _lease_expiry(value: str) -> datetime:
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError as error:
            raise EvidenceClosureError(
                "current coordinator lease expiry is not an ISO-8601 timestamp"
            ) from error
        if parsed.tzinfo is None or parsed.utcoffset() is None:
            raise EvidenceClosureError("current coordinator lease expiry has no timezone")
        return parsed.astimezone(UTC)

    @contextmanager
    def _open_worker_artifact(
        self, project_id: str, attempt_id: str, relative_path: str
    ) -> Iterator[BinaryIO]:
        """Open one worker artifact without following any output-scope symlink."""
        if self._blobs is None:
            raise EvidenceClosureError("artifact publication requires BlobStore custody")
        parts = Path(relative_path).parts
        if not parts or any(part in {"", ".", ".."} for part in parts):
            raise EvidenceClosureError("worker artifact path is not a safe relative path")
        components = (".piton", "build-attempts", project_id, attempt_id, *parts[:-1])
        directory_fd = os.open(
            self._blobs.project_root,
            os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
        )
        artifact_fd = -1
        try:
            for component in components:
                child_fd = os.open(
                    component,
                    os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
                    dir_fd=directory_fd,
                )
                os.close(directory_fd)
                directory_fd = child_fd
            artifact_fd = os.open(
                parts[-1],
                os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC,
                dir_fd=directory_fd,
            )
            if not stat.S_ISREG(os.fstat(artifact_fd).st_mode):
                raise EvidenceClosureError("worker artifact is not a regular file")
            stream = os.fdopen(artifact_fd, "rb", closefd=True)
            artifact_fd = -1
            with stream:
                yield stream
        finally:
            if artifact_fd >= 0:
                os.close(artifact_fd)
            os.close(directory_fd)

    def recover_incomplete_publications(self) -> tuple[str, ...]:
        """Fail closed and quarantine output scopes left in committing state."""
        if self._blobs is None:
            return ()
        with self._database.immediate() as connection:
            rows = connection.execute(
                "SELECT publication.attempt_id,publication.project_id "
                "FROM artifact_publications AS publication "
                "JOIN build_coordinator_state AS state USING(attempt_id) "
                "WHERE publication.state='committing' OR state.state='committing' "
                "ORDER BY publication.attempt_id"
            ).fetchall()
            recovered: list[str] = []
            now = datetime.now(UTC).isoformat(timespec="microseconds").replace("+00:00", "Z")
            for row in rows:
                output = self._blobs.control_root / "build-attempts" / row["project_id"] / row["attempt_id"]
                if output.exists() or output.is_symlink():
                    self._blobs.quarantine(output, reason_code="startup-incomplete-publication")
                connection.execute(
                    "UPDATE artifact_publications SET state='quarantined',updated_at=? "
                    "WHERE attempt_id=? AND state='committing'", (now, row["attempt_id"]),
                )
                connection.execute(
                    "UPDATE build_coordinator_state SET state='failed',lease_id=NULL,"
                    "lease_expires_at=NULL,updated_at=? WHERE attempt_id=? AND state='committing'",
                    (now, row["attempt_id"]),
                )
                recovered.append(row["attempt_id"])
        return tuple(recovered)

    def begin_publication(
        self, attempt: DurableBuildAttempt, state: CoordinatorState, result: PrecisionWorkerResult
    ) -> None:
        """Durably mark exact current custody as committing before CAS publication."""
        with self._database.immediate() as connection:
            now = self._trusted_clock().astimezone(UTC).isoformat(timespec="microseconds").replace("+00:00", "Z")
            current = connection.execute(
                "SELECT state,generation,fence,lease_id,lease_expires_at "
                "FROM build_coordinator_state WHERE attempt_id=?",
                (attempt.attempt_id,),
            ).fetchone()
            if current is None or tuple(current) != (
                "running", state.generation, state.fence, state.lease_id, state.lease_expires_at
            ):
                raise EvidenceClosureError("current daemon custody changed before publication")
            if current["lease_expires_at"] is None or self._lease_expiry(
                current["lease_expires_at"]
            ) <= self._trusted_clock().astimezone(UTC):
                raise EvidenceClosureError("current coordinator lease expired before publication")
            connection.execute(
                "INSERT INTO artifact_publications(attempt_id,project_id,revision_id,worker_result_digest,"
                "generation,fence,lease_id,closure_digest,state,created_at,updated_at) "
                "VALUES(?,?,?,?,?,?,?,NULL,'committing',?,?)",
                (attempt.attempt_id, attempt.project_id, attempt.revision_id, result.result_digest,
                 state.generation, state.fence, state.lease_id, now, now),
            )
            connection.execute(
                "UPDATE build_coordinator_state SET state='committing',updated_at=? WHERE attempt_id=?",
                (now, attempt.attempt_id),
            )

    def declare(self, attempt: DurableBuildAttempt) -> EvidenceCheckDeclaration:
        declaration = EvidenceCheckDeclaration.for_attempt(
            project_id=attempt.project_id,
            revision_id=attempt.revision_id,
            attempt_id=attempt.attempt_id,
            expected_outputs_digest=attempt.expected_outputs_digest,
        )
        with self._database.immediate() as connection:
            row = connection.execute(
                "SELECT declaration_digest, canonical_json FROM evidence_check_declarations "
                "WHERE attempt_id=?",
                (attempt.attempt_id,),
            ).fetchone()
            if row is None:
                connection.execute(
                    "INSERT INTO evidence_check_declarations(attempt_id,project_id,revision_id,"
                    "declaration_digest,canonical_json,review_state,fabrication_release,machine_actuation) "
                    "VALUES(?,?,?,?,?,'needs_human_review',0,0)",
                    (
                        attempt.attempt_id,
                        attempt.project_id,
                        attempt.revision_id,
                        declaration.declaration_digest,
                        declaration.canonical_bytes,
                    ),
                )
            elif (
                row["declaration_digest"] != declaration.declaration_digest
                or bytes(row["canonical_json"]) != declaration.canonical_bytes
            ):
                raise EvidenceClosureError(
                    "attempt check declaration is immutable and mismatched"
                )
        return declaration

    def get_declaration(
        self, project_id: str, attempt_id: str
    ) -> EvidenceCheckDeclaration:
        with self._database.read() as connection:
            row = connection.execute(
                "SELECT canonical_json FROM evidence_check_declarations "
                "WHERE project_id=? AND attempt_id=?",
                (project_id, attempt_id),
            ).fetchone()
        if row is None:
            raise LookupError("evidence check declaration was not found")
        value = json.loads(bytes(row["canonical_json"]))
        declaration = EvidenceCheckDeclaration(
            project_id=value["project_id"],
            revision_id=value["revision_id"],
            attempt_id=value["attempt_id"],
            expected_outputs_digest=value["expected_outputs_digest"],
            checks=tuple(
                CheckDefinition.from_primitive(item) for item in value["checks"]
            ),
            truth=value["truth"],
        )
        if value.get("declaration_digest") != declaration.declaration_digest:
            raise EvidenceClosureError("declaration readback digest mismatch")
        return declaration

    @staticmethod
    def execute_checks(
        declaration: EvidenceCheckDeclaration,
        result: PrecisionWorkerResult,
        inspection_receipt: Mapping[str, Any],
    ) -> tuple[CheckReceipt, ...]:
        artifact_digests = {
            role: artifact.digest for role, artifact in result.artifacts.items()
        }
        environment_digest = canonical_digest(
            {
                "toolchain": dict(result.toolchain),
                "environment": dict(result.environment),
                "worker_id": result.worker_id,
                "worker_pin": result.worker_pin,
                "isolation_class": result.isolation_class,
                "authenticated": result.authenticated,
            }
        )
        inspection = inspection_receipt["inspection"]
        measured = (
            {"closed_roles": ",".join(PREDECLARED_CHECKS[0].evidence_roles)},
            {
                "valid": str(inspection["valid"]).lower(),
                "solid_count": str(inspection["topology_counts"]["solids"]),
            },
            {
                "identity_scope": "artifact-local; no durable topology identity; no nearest fallback",
                "closed_roles": ",".join(PREDECLARED_CHECKS[2].evidence_roles),
            },
        )
        statuses = (
            "pass",
            "pass"
            if inspection.get("valid") is True
            and inspection.get("topology_counts", {}).get("solids") == 1
            else "fail",
            "pass",
        )
        return tuple(
            CheckReceipt(
                check_id=definition.check_id,
                declaration_digest=declaration.declaration_digest,
                revision_id=declaration.revision_id,
                attempt_id=declaration.attempt_id,
                worker_result_digest=result.result_digest,
                toolchain_digest=result.toolchain_digest,
                environment_digest=environment_digest,
                checker_digest=definition.checker_digest,
                comparator_digest=definition.comparator_digest,
                checker_command="piton.evidence:EvidenceRepository.execute_checks",
                checker_version="piton.check-receipt.v1",
                method=definition.method,
                units=definition.units,
                tolerance=definition.tolerance,
                evidence_inputs={
                    role: artifact_digests[role] for role in definition.evidence_roles
                },
                status=statuses[index],
                measured=measured[index],
                warnings=(),
                uncertainty="none",
                invalidation_conditions=definition.invalidation_conditions,
                claim_scope=definition.claim_scope,
            )
            for index, definition in enumerate(declaration.checks)
        )

    def publish(
        self,
        *,
        attempt: DurableBuildAttempt,
        state: CoordinatorState,
        declaration: EvidenceCheckDeclaration,
        result: PrecisionWorkerResult,
        receipts: tuple[CheckReceipt, ...],
    ) -> EvidenceClosure:
        artifacts = {
            role: {
                "digest": artifact.digest,
                "byte_length": artifact.byte_length,
                "media_type": artifact.media_type,
                "claim_scope": artifact.claim_scope,
                "units": artifact.units,
                "relative_path": artifact.relative_path,
            }
            for role, artifact in result.artifacts.items()
        }
        environment_digest = canonical_digest(
            {
                "toolchain": dict(result.toolchain),
                "environment": dict(result.environment),
                "worker_id": result.worker_id,
                "worker_pin": result.worker_pin,
                "isolation_class": result.isolation_class,
                "authenticated": result.authenticated,
            }
        )
        for receipt, definition in zip(receipts, declaration.checks, strict=True):
            if (
                receipt.check_id != definition.check_id
                or receipt.declaration_digest != declaration.declaration_digest
                or receipt.revision_id != attempt.revision_id
                or receipt.attempt_id != attempt.attempt_id
                or receipt.worker_result_digest != result.result_digest
                or receipt.toolchain_digest != result.toolchain_digest
                or receipt.environment_digest != environment_digest
                or receipt.checker_digest != definition.checker_digest
                or receipt.comparator_digest != definition.comparator_digest
                or receipt.method != definition.method
                or receipt.units != definition.units
                or receipt.tolerance != definition.tolerance
                or receipt.invalidation_conditions != definition.invalidation_conditions
                or receipt.claim_scope != definition.claim_scope
            ):
                raise EvidenceClosureError("check receipt does not match its immutable declaration")
        closure = EvidenceClosure(
            project_id=attempt.project_id,
            revision_id=attempt.revision_id,
            attempt_id=attempt.attempt_id,
            declaration_digest=declaration.declaration_digest,
            worker_result_digest=result.result_digest,
            generation=state.generation,
            fence=state.fence,
            lease_id=state.lease_id or "",
            receipts=receipts,
            artifacts=artifacts,
            environment={
                "toolchain_digest": result.toolchain_digest,
                "toolchain": dict(result.toolchain),
                "worker_id": result.worker_id,
                "worker_pin": result.worker_pin,
                "isolation_class": result.isolation_class,
                "authenticated": result.authenticated,
                **dict(result.environment),
            },
        )
        if any(item.status != "pass" for item in receipts):
            raise EvidenceClosureError(
                "required check failed; no EvidenceClosure published"
            )
        if self._blobs is None:
            raise EvidenceClosureError("artifact publication requires BlobStore custody")
        promoted: dict[str, ArtifactRef] = {}
        for role, artifact in result.artifacts.items():
            with self._open_worker_artifact(
                attempt.project_id, attempt.attempt_id, artifact.relative_path
            ) as content:
                staged = self._blobs.stage_stream(
                    "evidence-" + attempt.attempt_id,
                    role,
                    iter(lambda: content.read(1024 * 1024), b""),
                    media_type=artifact.media_type,
                    max_bytes=artifact.byte_length,
                )
            self._blobs.validate_staged(
                staged,
                expected_digest=artifact.digest,
                expected_size=artifact.byte_length,
            )
            promoted[role] = self._blobs.promote_no_clobber(staged)
        with self._database.immediate() as connection:
            transaction_now = self._trusted_clock()
            if (
                not isinstance(transaction_now, datetime)
                or transaction_now.tzinfo is None
                or transaction_now.utcoffset() is None
            ):
                raise EvidenceClosureError(
                    "trusted transaction clock must return a timezone-aware datetime"
                )
            transaction_now = transaction_now.astimezone(UTC)
            now = transaction_now.isoformat(timespec="microseconds").replace("+00:00", "Z")
            existing = connection.execute(
                "SELECT closure_digest, canonical_json, worker_result_digest FROM evidence_closures "
                "WHERE attempt_id=?",
                (attempt.attempt_id,),
            ).fetchone()
            if existing is not None:
                if (
                    existing["closure_digest"] != closure.closure_digest
                    or existing["worker_result_digest"] != result.result_digest
                    or bytes(existing["canonical_json"]) != closure.canonical_bytes
                ):
                    raise EvidenceClosureError(
                        "immutable closure identity already has different facts"
                    )
                return closure
            current = connection.execute(
                "SELECT attempt.project_id,attempt.revision_id,state.state,state.generation,state.fence,"
                "state.lease_id,state.lease_expires_at FROM build_attempts AS attempt "
                "JOIN build_coordinator_state AS state "
                "ON state.attempt_id=attempt.attempt_id WHERE attempt.attempt_id=?",
                (attempt.attempt_id,),
            ).fetchone()
            expected = (
                attempt.project_id,
                attempt.revision_id,
                "committing",
                state.generation,
                state.fence,
                state.lease_id,
                state.lease_expires_at,
            )
            if current is None or tuple(current) != expected:
                raise EvidenceClosureError(
                    "current daemon custody changed before closure transaction"
                )
            if current["lease_expires_at"] is None or self._lease_expiry(
                current["lease_expires_at"]
            ) <= transaction_now:
                raise EvidenceClosureError(
                    "current coordinator lease expired before closure transaction"
                )
            connection.execute(
                "INSERT INTO evidence_closures(closure_digest,project_id,revision_id,attempt_id,"
                "declaration_digest,worker_result_digest,generation,fence,lease_id,canonical_json,"
                "review_state,fabrication_release,machine_actuation,created_at) "
                "VALUES(?,?,?,?,?,?,?,?,?,?,'needs_human_review',0,0,?)",
                (
                    closure.closure_digest,
                    attempt.project_id,
                    attempt.revision_id,
                    attempt.attempt_id,
                    declaration.declaration_digest,
                    result.result_digest,
                    state.generation,
                    state.fence,
                    state.lease_id,
                    closure.canonical_bytes,
                    now,
                ),
            )
            for role, artifact in result.artifacts.items():
                storage_relpath = promoted[role].storage_relpath
                existing_artifact = connection.execute(
                    "SELECT media_type,byte_length,storage_relpath FROM artifacts WHERE digest=?",
                    (artifact.digest,),
                ).fetchone()
                if existing_artifact is None:
                    connection.execute(
                        "INSERT INTO artifacts(digest,media_type,byte_length,storage_relpath,created_at,verified_at) "
                        "VALUES(?,?,?,?,?,?)",
                        (
                            artifact.digest,
                            artifact.media_type,
                            artifact.byte_length,
                            storage_relpath,
                            now,
                            now,
                        ),
                    )
                elif tuple(existing_artifact) != (
                    artifact.media_type,
                    artifact.byte_length,
                    storage_relpath,
                ):
                    raise EvidenceClosureError(
                        "artifact metadata conflicts with immutable custody"
                    )
                connection.execute(
                    "INSERT INTO evidence_closure_artifacts(closure_digest,role,artifact_digest,"
                    "claim_scope,units,relative_path) VALUES(?,?,?,?,?,?)",
                    (
                        closure.closure_digest,
                        role,
                        artifact.digest,
                        artifact.claim_scope,
                        artifact.units,
                        artifact.relative_path,
                    ),
                )
            for ordinal, receipt in enumerate(receipts):
                connection.execute(
                    "INSERT INTO evidence_check_receipts(receipt_digest,declaration_digest,check_id,"
                    "project_id,revision_id,attempt_id,worker_result_digest,status,canonical_json,"
                    "review_state,fabrication_release,machine_actuation) "
                    "VALUES(?,?,?,?,?,?,?,?,?,'needs_human_review',0,0)",
                    (
                        receipt.receipt_digest,
                        declaration.declaration_digest,
                        receipt.check_id,
                        attempt.project_id,
                        attempt.revision_id,
                        attempt.attempt_id,
                        result.result_digest,
                        receipt.status,
                        receipt.canonical_bytes,
                    ),
                )
                connection.execute(
                    "INSERT INTO evidence_closure_receipts(closure_digest,ordinal,receipt_digest) "
                    "VALUES(?,?,?)",
                    (closure.closure_digest, ordinal, receipt.receipt_digest),
                )
            connection.execute(
                "UPDATE build_coordinator_state SET state='succeeded',lease_id=NULL,"
                "lease_expires_at=NULL,updated_at=? WHERE attempt_id=?",
                (now, attempt.attempt_id),
            )
            connection.execute(
                "UPDATE artifact_publications SET state='committed',closure_digest=?,updated_at=? "
                "WHERE attempt_id=? AND state='committing'",
                (closure.closure_digest, now, attempt.attempt_id),
            )
            payload = canonical_json_bytes({
                "schema": "piton.evidence-closure-committed.v1",
                "project_id": attempt.project_id,
                "revision_id": attempt.revision_id,
                "attempt_id": attempt.attempt_id,
                "closure_digest": closure.closure_digest,
            })
            payload_staged = self._blobs.stage_stream(
                "outbox-" + attempt.attempt_id,
                "closure",
                (payload,),
                media_type="application/json",
                max_bytes=len(payload),
            )
            payload_artifact = self._blobs.promote_no_clobber(payload_staged)
            existing_payload = connection.execute(
                "SELECT media_type,byte_length,storage_relpath FROM artifacts WHERE digest=?",
                (payload_artifact.digest,),
            ).fetchone()
            payload_claims = (
                payload_artifact.media_type,
                payload_artifact.byte_length,
                payload_artifact.storage_relpath,
            )
            if existing_payload is None:
                connection.execute(
                    "INSERT INTO artifacts(digest,media_type,byte_length,storage_relpath,created_at,verified_at) "
                    "VALUES(?,?,?,?,?,?)",
                    (payload_artifact.digest, *payload_claims, now, now),
                )
            elif tuple(existing_payload) != payload_claims:
                raise EvidenceClosureError("outbox payload conflicts with immutable custody")
            connection.execute(
                "INSERT INTO outbox(event_id,topic,aggregate_id,payload_digest,payload_json,created_at) "
                "VALUES(?,?,?,?,?,?)",
                ("closure-" + closure.closure_digest[7:39], "evidence.closure.committed",
                 attempt.attempt_id, payload_artifact.digest, payload, now),
            )
        return closure

    def get_closure(self, project_id: str, closure_digest: str) -> EvidenceClosure:
        _digest("closure_digest", closure_digest)
        with self._database.read() as connection:
            row = connection.execute(
                "SELECT closure.canonical_json AS closure_json,closure.project_id,closure.revision_id,"
                "closure.attempt_id,closure.declaration_digest,closure.worker_result_digest,"
                "closure.generation AS closure_generation,closure.fence AS closure_fence,"
                "closure.lease_id,closure.review_state,"
                "closure.fabrication_release,closure.machine_actuation,state.state,"
                "state.generation AS state_generation,state.fence AS state_fence,"
                "declaration.canonical_json AS declaration_json "
                "FROM evidence_closures AS closure "
                "JOIN build_coordinator_state AS state ON state.attempt_id=closure.attempt_id "
                "JOIN evidence_check_declarations AS declaration "
                "ON declaration.declaration_digest=closure.declaration_digest "
                "WHERE closure.project_id=? AND closure.closure_digest=?",
                (project_id, closure_digest),
            ).fetchone()
            if row is None:
                raise LookupError("evidence closure was not found")
            value = json.loads(bytes(row["closure_json"]))
            receipt_rows = connection.execute(
                "SELECT receipt.canonical_json FROM evidence_closure_receipts AS link "
                "JOIN evidence_check_receipts AS receipt ON receipt.receipt_digest=link.receipt_digest "
                "WHERE link.closure_digest=? ORDER BY link.ordinal",
                (closure_digest,),
            ).fetchall()
            artifact_rows = connection.execute(
                "SELECT link.role,artifact.digest,artifact.byte_length,artifact.media_type,"
                "link.claim_scope,link.units,link.relative_path "
                "FROM evidence_closure_artifacts AS link JOIN artifacts AS artifact "
                "ON artifact.digest=link.artifact_digest "
                "WHERE link.closure_digest=? ORDER BY link.role",
                (closure_digest,),
            ).fetchall()
        declaration_value = json.loads(bytes(row["declaration_json"]))
        if (
            row["state"] != "succeeded"
            or row["state_generation"] != row["closure_generation"]
            or row["state_fence"] != row["closure_fence"]
            or row["review_state"] != "needs_human_review"
            or row["fabrication_release"] != 0
            or row["machine_actuation"] != 0
            or declaration_value.get("declaration_digest") != row["declaration_digest"]
        ):
            raise EvidenceClosureError(
                "closure no longer matches successful daemon custody"
            )
        receipts = tuple(
            CheckReceipt.from_manifest(json.loads(bytes(item[0])))
            for item in receipt_rows
        )
        durable_artifacts = {
            item["role"]: {
                "digest": item["digest"],
                "byte_length": item["byte_length"],
                "media_type": item["media_type"],
                "claim_scope": item["claim_scope"],
                "units": item["units"],
                "relative_path": item["relative_path"],
            }
            for item in artifact_rows
        }
        closure = EvidenceClosure(
            project_id=value["project_id"],
            revision_id=value["revision_id"],
            attempt_id=value["attempt_id"],
            declaration_digest=value["declaration_digest"],
            worker_result_digest=value["worker_result_digest"],
            generation=value["generation"],
            fence=value["fence"],
            lease_id=value["lease_id"],
            receipts=receipts,
            artifacts=durable_artifacts,
            environment=value["environment"],
            truth=value["truth"],
        )
        if (
            value.get("closure_digest") != closure.closure_digest
            or value["artifacts"]
            != {role: dict(item) for role, item in closure.artifacts.items()}
            or value["receipt_digests"] != [item.receipt_digest for item in receipts]
        ):
            raise EvidenceClosureError("closure readback digest mismatch")
        return closure
