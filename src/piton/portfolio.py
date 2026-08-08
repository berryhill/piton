"""Deterministic, repository-native admission for the P0--P5 portfolio.

A completed phase execution is only an observation.  It is not successor
phase authority.  This module issues content-bound exit receipts and
re-evaluates them at the successor boundary, where all failures deny.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from enum import StrEnum
from types import MappingProxyType
from typing import Any, Literal, Mapping, Sequence

from .model import _require_digest, _require_identifier


class Phase(StrEnum):
    P0 = "P0"
    P1 = "P1"
    P2 = "P2"
    P3 = "P3"
    P4 = "P4"
    P5 = "P5"


class ExecutionStatus(StrEnum):
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    SKIPPED = "skipped"


class Disposition(StrEnum):
    ADVANCE = "advance"
    HOLD = "hold"
    REWORK = "rework"
    STOP = "stop"
    REJECT = "reject"


class Authority(StrEnum):
    AUTONOMOUS = "autonomous"
    HUMAN = "human"


class EvidenceSource(StrEnum):
    REPOSITORY_NATIVE = "repository_native"
    EXTERNAL = "external"


_PHASES = tuple(Phase)
_JUDGMENT_PHASES = frozenset((Phase.P0, Phase.P3, Phase.P4, Phase.P5))
_FAIL_CLOSED_DISPOSITIONS = frozenset(
    (Disposition.HOLD, Disposition.REWORK, Disposition.STOP, Disposition.REJECT)
)
_TECHNICAL_PREDICATES: Mapping[Phase, tuple[str, ...]] = MappingProxyType(
    {
        Phase.P1: ("exact_cad_verified",),
        Phase.P2: ("local_custody_verified", "immutable_revision_verified"),
    }
)
_PLACEHOLDER_PATTERN = re.compile(r"\b(?:placeholder|scaffold(?:ed|ing)?)\b", re.IGNORECASE)


def _canonical_bytes(value: Any) -> bytes:
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False
    ).encode("utf-8")


def _content_digest(value: Any) -> str:
    return "sha256:" + hashlib.sha256(_canonical_bytes(value)).hexdigest()


def _json_copy(value: Any) -> Any:
    """Copy and prove that evidence is deterministic JSON data."""
    try:
        return json.loads(_canonical_bytes(value))
    except (TypeError, ValueError) as exc:
        raise ValueError("evidence content must be finite deterministic JSON") from exc


def _scaffold_path(value: Any, path: str = "$") -> str | None:
    if isinstance(value, Mapping):
        for key, child in value.items():
            key_text = str(key)
            if key_text.casefold() == "scaffold_note":
                return f"{path}.{key_text} contains scaffold_note"
            found = _scaffold_path(child, f"{path}.{key_text}")
            if found:
                return found
    elif isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        for index, child in enumerate(value):
            found = _scaffold_path(child, f"{path}[{index}]")
            if found:
                return found
    elif isinstance(value, str) and _PLACEHOLDER_PATTERN.search(value):
        return f"{path} contains placeholder/scaffold content"
    return None


def _as_enum(enum_type: type[StrEnum], value: Any, name: str) -> Any:
    try:
        return enum_type(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"unknown {name}") from exc


@dataclass(frozen=True, slots=True)
class SafetyState:
    fabrication_release: bool = False
    machine_actuation: bool = False
    review_state: str = "needs_human_review"

    def assert_safe(self) -> None:
        if (
            self.fabrication_release is not False
            or self.machine_actuation is not False
            or self.review_state != "needs_human_review"
        ):
            raise ValueError(
                "portfolio safety invariant requires fabrication_release=false, "
                "machine_actuation=false, and review_state=needs_human_review"
            )

    def to_dict(self) -> dict[str, Any]:
        return {
            "fabrication_release": self.fabrication_release,
            "machine_actuation": self.machine_actuation,
            "review_state": self.review_state,
        }


@dataclass(frozen=True, slots=True)
class ExternalEvidenceT003Receipt:
    """Synthetic unavailable-evidence fixture with no gate authority."""

    disposition: Literal["unavailable"] = "unavailable"
    synthetic: Literal[True] = True
    threshold_passed: Literal[False] = False
    fabrication_release: Literal[False] = False
    machine_actuation: Literal[False] = False
    review_state: Literal["needs_human_review"] = "needs_human_review"
    g2_accepted: Literal[False] = False
    g7_accepted: Literal[False] = False
    paid_partner_count: Literal[0] = 0
    completed_real_job_count: Literal[0] = 0
    recognized_revenue_usd: Literal[0] = 0


def validate_external_evidence_t003(receipt: ExternalEvidenceT003Receipt) -> bool:
    """Validate the exact non-authorizing T003 fixture contract."""

    return (
        type(receipt) is ExternalEvidenceT003Receipt
        and receipt.disposition == "unavailable"
        and receipt.synthetic is True
        and receipt.threshold_passed is False
        and receipt.fabrication_release is False
        and receipt.machine_actuation is False
        and receipt.review_state == "needs_human_review"
        and receipt.g2_accepted is False
        and receipt.g7_accepted is False
        and type(receipt.paid_partner_count) is int
        and receipt.paid_partner_count == 0
        and type(receipt.completed_real_job_count) is int
        and receipt.completed_real_job_count == 0
        and type(receipt.recognized_revenue_usd) is int
        and receipt.recognized_revenue_usd == 0
    )


@dataclass(frozen=True, slots=True)
class EvidenceArtifact:
    artifact_id: str
    repository_path: str
    digest: str
    content: Any
    source: EvidenceSource = EvidenceSource.REPOSITORY_NATIVE

    def __post_init__(self) -> None:
        _require_identifier("artifact_id", self.artifact_id)
        path = self.repository_path
        if (
            not isinstance(path, str)
            or not path
            or path.startswith(("/", "~"))
            or ".." in path.split("/")
        ):
            raise ValueError("repository_path must be a repository-relative path")
        _require_digest("digest", self.digest)
        object.__setattr__(self, "source", _as_enum(EvidenceSource, self.source, "evidence source"))
        object.__setattr__(self, "content", _json_copy(self.content))

    @classmethod
    def from_content(
        cls,
        *,
        artifact_id: str,
        repository_path: str,
        content: Any,
        source: EvidenceSource = EvidenceSource.REPOSITORY_NATIVE,
    ) -> "EvidenceArtifact":
        copied = _json_copy(content)
        return cls(artifact_id, repository_path, _content_digest(copied), copied, source)

    def validation_reasons(self) -> tuple[str, ...]:
        reasons: list[str] = []
        if self.source is not EvidenceSource.REPOSITORY_NATIVE:
            reasons.append(f"evidence {self.artifact_id} is not repository-native")
        if self.digest != _content_digest(self.content):
            reasons.append(f"evidence {self.artifact_id} digest does not bind its content")
        scaffold = _scaffold_path(self.content)
        if scaffold:
            reasons.append(f"evidence {self.artifact_id} rejected: {scaffold}")
        return tuple(reasons)

    def to_dict(self) -> dict[str, Any]:
        return {
            "artifact_id": self.artifact_id,
            "repository_path": self.repository_path,
            "digest": self.digest,
            "content": self.content,
            "source": self.source.value,
        }


@dataclass(frozen=True, slots=True)
class PhaseExitReceipt:
    receipt_id: str
    phase: Phase
    status: ExecutionStatus
    disposition: Disposition
    authority: Authority
    predecessor_receipt_id: str | None
    predecessor_receipt_digest: str | None
    predicates: Mapping[str, bool]
    evidence: tuple[EvidenceArtifact, ...]
    safety: SafetyState
    execution_complete: bool
    successor_authorized: bool
    authorization_reasons: tuple[str, ...] = field(default_factory=tuple)

    def __post_init__(self) -> None:
        _require_identifier("receipt_id", self.receipt_id)
        object.__setattr__(self, "phase", _as_enum(Phase, self.phase, "phase"))
        object.__setattr__(self, "status", _as_enum(ExecutionStatus, self.status, "execution status"))
        object.__setattr__(self, "disposition", _as_enum(Disposition, self.disposition, "disposition"))
        object.__setattr__(self, "authority", _as_enum(Authority, self.authority, "authority"))
        if (self.predecessor_receipt_id is None) != (self.predecessor_receipt_digest is None):
            raise ValueError("predecessor receipt ID and digest must be supplied together")
        if self.predecessor_receipt_id is not None:
            _require_identifier("predecessor_receipt_id", self.predecessor_receipt_id)
            assert self.predecessor_receipt_digest is not None
            _require_digest("predecessor_receipt_digest", self.predecessor_receipt_digest)
        copied_predicates = dict(self.predicates)
        for name, result in copied_predicates.items():
            _require_identifier("predicate name", name)
            if not isinstance(result, bool):
                raise ValueError("technical predicate results must be booleans")
        object.__setattr__(self, "predicates", MappingProxyType(copied_predicates))
        object.__setattr__(self, "evidence", tuple(self.evidence))
        object.__setattr__(self, "authorization_reasons", tuple(self.authorization_reasons))
        if not isinstance(self.execution_complete, bool) or not isinstance(
            self.successor_authorized, bool
        ):
            raise ValueError("receipt decisions must be booleans")
        self.safety.assert_safe()

    def to_dict(self) -> dict[str, Any]:
        return {
            "receipt_id": self.receipt_id,
            "phase": self.phase.value,
            "status": self.status.value,
            "disposition": self.disposition.value,
            "authority": self.authority.value,
            "predecessor_receipt_id": self.predecessor_receipt_id,
            "predecessor_receipt_digest": self.predecessor_receipt_digest,
            "predicates": dict(self.predicates),
            "evidence": [artifact.to_dict() for artifact in self.evidence],
            "safety": self.safety.to_dict(),
            "execution_complete": self.execution_complete,
            "successor_authorized": self.successor_authorized,
            "authorization_reasons": list(self.authorization_reasons),
        }

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> "PhaseExitReceipt":
        if not isinstance(value, Mapping):
            raise ValueError("receipt must be a mapping")
        expected = {
            "receipt_id", "phase", "status", "disposition", "authority",
            "predecessor_receipt_id", "predecessor_receipt_digest", "predicates",
            "evidence", "safety", "execution_complete", "successor_authorized",
            "authorization_reasons",
        }
        if set(value) != expected:
            raise ValueError("receipt fields do not match the closed receipt schema")
        evidence = tuple(EvidenceArtifact(**item) for item in value["evidence"])
        return cls(
            receipt_id=value["receipt_id"],
            phase=value["phase"],
            status=value["status"],
            disposition=value["disposition"],
            authority=value["authority"],
            predecessor_receipt_id=value["predecessor_receipt_id"],
            predecessor_receipt_digest=value["predecessor_receipt_digest"],
            predicates=value["predicates"],
            evidence=evidence,
            safety=SafetyState(**value["safety"]),
            execution_complete=value["execution_complete"],
            successor_authorized=value["successor_authorized"],
            authorization_reasons=tuple(value["authorization_reasons"]),
        )


@dataclass(frozen=True, slots=True)
class PortfolioAdmissionDecision:
    receipt_id: str
    successor: Phase
    admitted: bool
    reasons: tuple[str, ...]


def _authorization_reasons(
    *,
    phase: Phase,
    status: ExecutionStatus,
    disposition: Disposition,
    authority: Authority,
    predecessor_receipt_id: str | None,
    predecessor_receipt_digest: str | None,
    predicates: Mapping[str, bool],
    evidence: tuple[EvidenceArtifact, ...],
) -> tuple[str, ...]:
    reasons: list[str] = []
    if status is not ExecutionStatus.COMPLETED:
        reasons.append("execution status is not completed")
    if disposition is not Disposition.ADVANCE:
        reasons.append("disposition does not advance")
    if authority is Authority.AUTONOMOUS and phase in _JUDGMENT_PHASES:
        reasons.append(f"{phase.value} advancement requires human authority")
    if authority is Authority.AUTONOMOUS and disposition not in (
        Disposition.ADVANCE,
        *_FAIL_CLOSED_DISPOSITIONS,
    ):
        reasons.append("autonomous disposition is not fail-closed")
    for predicate in _TECHNICAL_PREDICATES.get(phase, ()):
        if predicates.get(predicate) is not True:
            reasons.append(f"required positive technical predicate missing: {predicate}")
    if not evidence:
        reasons.append("at least one repository-native evidence artifact is required")
    for artifact in evidence:
        reasons.extend(artifact.validation_reasons())
    if phase is Phase.P0:
        if predecessor_receipt_id is not None or predecessor_receipt_digest is not None:
            reasons.append("P0 must not claim a predecessor")
    elif predecessor_receipt_id is None or predecessor_receipt_digest is None:
        reasons.append("exact predecessor receipt ID and digest are required")
    if phase is Phase.P5:
        reasons.append("P5 is terminal and cannot authorize a successor phase")
    return tuple(reasons)


def issue_phase_exit_receipt(
    *,
    receipt_id: str,
    phase: Phase,
    status: ExecutionStatus,
    disposition: Disposition,
    authority: Authority,
    predecessor_receipt_id: str | None,
    predecessor_receipt_digest: str | None,
    predicates: Mapping[str, bool],
    evidence: tuple[EvidenceArtifact, ...],
    safety: SafetyState,
) -> PhaseExitReceipt:
    """Issue a typed receipt; negative execution and dispositions remain receipts."""
    phase = _as_enum(Phase, phase, "phase")
    status = _as_enum(ExecutionStatus, status, "execution status")
    disposition = _as_enum(Disposition, disposition, "disposition")
    authority = _as_enum(Authority, authority, "authority")
    safety.assert_safe()
    artifacts = tuple(evidence)
    if disposition is Disposition.ADVANCE and any(
        artifact.source is EvidenceSource.EXTERNAL for artifact in artifacts
    ):
        disposition = Disposition.HOLD
    reasons = _authorization_reasons(
        phase=phase,
        status=status,
        disposition=disposition,
        authority=authority,
        predecessor_receipt_id=predecessor_receipt_id,
        predecessor_receipt_digest=predecessor_receipt_digest,
        predicates=predicates,
        evidence=artifacts,
    )
    return PhaseExitReceipt(
        receipt_id=receipt_id,
        phase=phase,
        status=status,
        disposition=disposition,
        authority=authority,
        predecessor_receipt_id=predecessor_receipt_id,
        predecessor_receipt_digest=predecessor_receipt_digest,
        predicates=predicates,
        evidence=artifacts,
        safety=safety,
        execution_complete=status is ExecutionStatus.COMPLETED,
        successor_authorized=not reasons,
        authorization_reasons=reasons,
    )


def receipt_digest(receipt: PhaseExitReceipt) -> str:
    """Return the canonical digest used by an exact successor binding."""
    return _content_digest(receipt.to_dict())


def _verify_receipt_claims(receipt: PhaseExitReceipt) -> tuple[str, ...]:
    """Recompute decision fields so serialized claims never become authority."""
    computed = _authorization_reasons(
        phase=receipt.phase,
        status=receipt.status,
        disposition=receipt.disposition,
        authority=receipt.authority,
        predecessor_receipt_id=receipt.predecessor_receipt_id,
        predecessor_receipt_digest=receipt.predecessor_receipt_digest,
        predicates=receipt.predicates,
        evidence=receipt.evidence,
    )
    reasons = list(computed)
    if receipt.execution_complete is not (receipt.status is ExecutionStatus.COMPLETED):
        reasons.append("claimed execution_complete does not match execution status")
    if receipt.successor_authorized is not (not computed):
        reasons.append("claimed successor_authorized does not match recomputed authorization")
    if receipt.authorization_reasons != computed:
        reasons.append("claimed authorization reasons do not match recomputed reasons")
    return tuple(reasons)


def verify_successor_admission(
    receipt: PhaseExitReceipt,
    *,
    successor: Phase,
    predecessor: PhaseExitReceipt | None = None,
) -> PortfolioAdmissionDecision:
    """Re-evaluate the exit and exact chain binding; any mismatch denies."""
    successor = _as_enum(Phase, successor, "successor phase")
    reasons = list(_verify_receipt_claims(receipt))
    expected_index = _PHASES.index(receipt.phase) + 1
    if expected_index >= len(_PHASES) or successor is not _PHASES[expected_index]:
        reasons.append("requested phase is not the immediate successor")
    if receipt.phase is not Phase.P0:
        if predecessor is None:
            reasons.append("bound predecessor receipt was not supplied")
        else:
            expected_predecessor = _PHASES[_PHASES.index(receipt.phase) - 1]
            if predecessor.phase is not expected_predecessor:
                reasons.append("predecessor phase is not exact")
            if receipt.predecessor_receipt_id != predecessor.receipt_id:
                reasons.append("predecessor receipt ID does not match")
            if receipt.predecessor_receipt_digest != receipt_digest(predecessor):
                reasons.append("predecessor receipt digest does not match")
            if _verify_receipt_claims(predecessor) or not predecessor.successor_authorized:
                reasons.append("predecessor did not authorize this phase")
    return PortfolioAdmissionDecision(receipt.receipt_id, successor, not reasons, tuple(reasons))
