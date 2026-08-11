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
from pathlib import Path
from types import MappingProxyType
from typing import Any, ClassVar, Literal, Mapping, Sequence

from ..assurance import (
    DEFAULT_P4_ASSURANCE_POLICY,
    GovernedAlphaEvidence,
    P4AssuranceEvidence,
    validate_p4_evidence_policy_binding,
)
from ..model import _require_digest, _require_identifier
from ..evidence import EvidenceClosure, canonical_digest
from ..human_review import FrameworkPacketClosure
from ..review_packet import EXPECTED_ROLES, ReviewPacket, validate_review_packet


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
_HUMAN_AUTHORITY_UNAVAILABLE_REASON = (
    "trusted durable human authorization issuance/verification is not implemented "
    "in this Stage-1 slice"
)


@dataclass(frozen=True, slots=True)
class P3ReviewEvidenceBundle:
    """Caller-provided P3 evidence candidate; never daemon custody or authority.

    Validation proves only internal identity, digest, packet, and root-truth
    consistency. Even a fully valid, self-consistent bundle cannot authorize
    advancement.
    """

    project_id: str
    current_revision_id: str
    current_attempt_id: str
    evidence_closure: EvidenceClosure
    framework_packet_closure: FrameworkPacketClosure
    review_packet: ReviewPacket
    review_packet_directory: str | Path

    def __post_init__(self) -> None:
        _require_identifier("custody project_id", self.project_id)
        _require_identifier("custody current_attempt_id", self.current_attempt_id)
        if not isinstance(self.current_revision_id, str) or not re.fullmatch(
            r"rev_[0-9a-f]{64}", self.current_revision_id
        ):
            raise ValueError("custody current_revision_id must be a derived revision identity")
        if not isinstance(self.evidence_closure, EvidenceClosure):
            raise TypeError("custody evidence_closure must be an EvidenceClosure")
        if not isinstance(self.framework_packet_closure, FrameworkPacketClosure):
            raise TypeError("custody framework closure must be a FrameworkPacketClosure")
        if not isinstance(self.review_packet, ReviewPacket):
            raise TypeError("custody review_packet must be a ReviewPacket")


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
class PartnerScaffoldT007Receipt:
    """Closed, synthetic shape for unperformed T007 partner work.

    This repository fixture is deliberately incapable of representing a real
    partner result. Validation proves only that all zero-claim fields retain
    their declared values.
    """

    schema: Literal["piton.partner-alpha-scaffold.t007.v1"] = (
        "piton.partner-alpha-scaffold.t007.v1"
    )
    disposition: Literal["unavailable"] = "unavailable"
    synthetic: Literal[True] = True
    claim_scope: Literal["fixture-only"] = "fixture-only"
    external_thresholds_passed: Literal[False] = False
    successor_authorized: Literal[False] = False
    threshold_passed: Literal[False] = False
    fabrication_release: Literal[False] = False
    machine_actuation: Literal[False] = False
    review_state: Literal["needs_human_review"] = "needs_human_review"
    g2_accepted: Literal[False] = False
    g7_accepted: Literal[False] = False
    paid_partner_count: Literal[0] = 0
    completed_real_job_count: Literal[0] = 0
    recognized_revenue_usd: Literal[0] = 0

    FIELD_NAMES: ClassVar[tuple[str, ...]] = (
        "schema",
        "disposition",
        "synthetic",
        "claim_scope",
        "external_thresholds_passed",
        "successor_authorized",
        "threshold_passed",
        "fabrication_release",
        "machine_actuation",
        "review_state",
        "g2_accepted",
        "g7_accepted",
        "paid_partner_count",
        "completed_real_job_count",
        "recognized_revenue_usd",
    )

    def to_dict(self) -> dict[str, Any]:
        return {name: getattr(self, name) for name in self.FIELD_NAMES}

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> "PartnerScaffoldT007Receipt":
        if not isinstance(value, Mapping) or set(value) != set(cls.FIELD_NAMES):
            raise ValueError("fields do not match the closed partner scaffold schema")
        return cls(**{name: value[name] for name in cls.FIELD_NAMES})


def validate_partner_scaffold_t007(receipt: PartnerScaffoldT007Receipt) -> bool:
    """Return true only for the exact zero-claim T007 fixture state."""

    if type(receipt) is not PartnerScaffoldT007Receipt:
        return False
    expected = PartnerScaffoldT007Receipt().to_dict()
    actual = receipt.to_dict()
    return all(
        type(actual[name]) is type(expected_value) and actual[name] == expected_value
        for name, expected_value in expected.items()
    )


def serialize_partner_scaffold_t007(receipt: PartnerScaffoldT007Receipt) -> str:
    """Serialize a valid fixture as deterministic UTF-8-compatible JSON text."""

    if not validate_partner_scaffold_t007(receipt):
        raise ValueError("cannot serialize an invalid partner scaffold")
    return json.dumps(
        receipt.to_dict(), sort_keys=True, indent=2, ensure_ascii=False, allow_nan=False
    ) + "\n"


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
class ExternalEvidenceT008Receipt:
    """Immutable unavailable-evidence disposition with no authority."""

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


def validate_external_evidence_t008(receipt: ExternalEvidenceT008Receipt) -> bool:
    """Accept only the exact zero-claim T008 disposition."""

    return (
        type(receipt) is ExternalEvidenceT008Receipt
        and type(receipt.disposition) is str
        and receipt.disposition == "unavailable"
        and receipt.synthetic is True
        and receipt.threshold_passed is False
        and receipt.fabrication_release is False
        and receipt.machine_actuation is False
        and type(receipt.review_state) is str
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
class ExternalEvidenceT002Receipt:
    """Synthetic schema fixture recording that T002 evidence is unavailable."""

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


def validate_external_evidence_t002(receipt: ExternalEvidenceT002Receipt) -> bool:
    """Accept only the exact, closed, fail-closed T002 fixture."""

    return (
        type(receipt) is ExternalEvidenceT002Receipt
        and type(receipt.disposition) is str
        and receipt.disposition == "unavailable"
        and receipt.synthetic is True
        and receipt.threshold_passed is False
        and receipt.fabrication_release is False
        and receipt.machine_actuation is False
        and type(receipt.review_state) is str
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


def _p3_review_evidence_reasons(
    governed: GovernedAlphaEvidence, bundle: P3ReviewEvidenceBundle | None
) -> tuple[str, ...]:
    if bundle is None:
        return ("P3 review evidence bundle was not supplied",)
    reasons: list[str] = []
    custody = bundle
    closure = custody.evidence_closure
    framework = custody.framework_packet_closure
    packet_assertion = custody.review_packet
    try:
        packet = validate_review_packet(custody.review_packet_directory)
    except (OSError, TypeError, ValueError, RuntimeError) as exc:
        return (f"P3 review packet evidence readback failed: {exc}",)
    if packet.to_primitive() != packet_assertion.to_primitive():
        reasons.append("P3 review packet assertion does not match packet readback")
    if canonical_digest(closure.to_primitive()) != closure.closure_digest:
        reasons.append("P3 EvidenceClosure digest does not match recomputed content")
    for check in closure.receipts:
        if canonical_digest(check.to_primitive()) != check.receipt_digest:
            reasons.append("P3 EvidenceClosure contains a stale or mutated check receipt")
    identities = (
        ("project", governed.project_id, custody.project_id, closure.project_id, framework.project_id, packet.project_id),
        ("revision", governed.revision_id, custody.current_revision_id, closure.revision_id, framework.revision_id, packet.revision_id),
        ("attempt", governed.build_attempt_id, custody.current_attempt_id, closure.attempt_id, framework.attempt_id, packet.build_attempt_id),
    )
    for label, *values in identities:
        if len(set(values)) != 1:
            reasons.append(f"P3 {label} identity is cross-project, stale, or unbound")
    digest_bindings = (
        ("EvidenceClosure", governed.evidence_closure_digest, closure.closure_digest, framework.evidence_closure_digest, packet.evidence_closure_digest),
        ("FrameworkPacketClosure", governed.framework_packet_closure_digest, framework.closure_digest),
        ("review packet", governed.review_packet_digest, framework.review_packet_digest, packet.packet_digest),
    )
    for label, *values in digest_bindings:
        if len(set(values)) != 1:
            reasons.append(f"P3 {label} digest is stale, mutated, or unbound")
    framework_bindings = (
        framework.worker_result_digest == closure.worker_result_digest == packet.worker_result_digest,
        framework.declaration_digest == closure.declaration_digest == packet.declaration_digest,
        framework.generation == closure.generation == packet.generation,
        framework.fence == closure.fence == packet.fence,
        framework.lease_id == closure.lease_id == packet.lease_id,
    )
    if not all(framework_bindings):
        reasons.append("P3 framework packet evidence identity is stale or unbound")
    if set(closure.artifacts) != EXPECTED_ROLES or set(packet.artifacts) != EXPECTED_ROLES:
        reasons.append("P3 derivative/artifact role closure is unknown or incomplete")
    else:
        governed_artifacts = {
            "exact_brep": (governed.exact_brep_digest, governed.exact_brep_claim_scope, "exact_occt_brep_derived_realization"),
            "step": (governed.step_digest, governed.step_claim_scope, "derived_exchange_representation"),
            "review_glb": (governed.review_glb_digest, governed.review_glb_claim_scope, "review-only"),
            "review_selection_map": (
                governed.review_selection_map_digest,
                governed.review_selection_map_claim_scope,
                "artifact-local-review-selection-only",
            ),
        }
        framework_digests = {
            "exact_brep": framework.exact_brep_digest,
            "step": framework.step_digest,
            "review_glb": framework.review_glb_digest,
            "review_selection_map": framework.review_selection_map_digest,
        }
        for role, (digest, governed_scope, actual_scope) in governed_artifacts.items():
            closure_record = closure.artifacts.get(role, {})
            packet_record = packet.artifacts.get(role, {})
            expected_governed_scope = {
                "exact_brep": "exact-realization",
                "step": "exact-exchange",
                "review_glb": "review-only",
                "review_selection_map": "review-only",
            }[role]
            if (
                governed_scope != expected_governed_scope
                or digest != framework_digests[role]
                or digest != closure_record.get("digest")
                or digest != packet_record.get("digest")
                or closure_record.get("claim_scope") != actual_scope
                or packet_record.get("claim_scope") != actual_scope
            ):
                reasons.append(f"P3 {role} derivative/artifact evidence is stale or unbound")
    expected_truth = {
        "review_state": "needs_human_review",
        "fabrication_release": False,
        "machine_actuation": False,
    }
    if dict(closure.truth) != expected_truth or dict(packet.truth) != {
        **expected_truth, "release_state": "unreleased", "channel_transition": False
    }:
        reasons.append("P3 review evidence violates the root truth boundary")
    return tuple(reasons)


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
    p3_review_evidence: P3ReviewEvidenceBundle | None,
) -> tuple[str, ...]:
    reasons: list[str] = []
    if status is not ExecutionStatus.COMPLETED:
        reasons.append("execution status is not completed")
    if disposition is not Disposition.ADVANCE:
        reasons.append("disposition does not advance")
    if authority is Authority.HUMAN:
        reasons.append(_HUMAN_AUTHORITY_UNAVAILABLE_REASON)
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
    if phase is Phase.P3:
        if len(evidence) != 1:
            reasons.append("P3 requires exactly one governed-alpha evidence artifact")
        else:
            try:
                governed = GovernedAlphaEvidence.from_primitive(evidence[0].content)
            except (KeyError, TypeError, ValueError) as exc:
                reasons.append(f"P3 governed-alpha evidence is invalid: {exc}")
            else:
                reasons.extend(_p3_review_evidence_reasons(governed, p3_review_evidence))
    if phase is Phase.P4:
        if len(evidence) != 1:
            reasons.append("P4 requires exactly one policy-bound assurance evidence artifact")
        else:
            try:
                assurance_evidence = P4AssuranceEvidence.from_primitive(evidence[0].content)
            except (KeyError, TypeError, ValueError) as exc:
                reasons.append(f"P4 policy-bound assurance evidence is invalid: {exc}")
            else:
                reasons.extend(
                    validate_p4_evidence_policy_binding(
                        DEFAULT_P4_ASSURANCE_POLICY,
                        assurance_evidence,
                    )
                )
                reasons.append(
                    f"P4 evidence result {assurance_evidence.result} cannot authorize successor advancement"
                )
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
    p3_review_evidence: P3ReviewEvidenceBundle | None = None,
) -> PhaseExitReceipt:
    """Issue a typed receipt; negative execution and dispositions remain receipts."""
    phase = _as_enum(Phase, phase, "phase")
    status = _as_enum(ExecutionStatus, status, "execution status")
    disposition = _as_enum(Disposition, disposition, "disposition")
    authority = _as_enum(Authority, authority, "authority")
    safety.assert_safe()
    artifacts = tuple(evidence)
    if disposition is Disposition.ADVANCE and any(
        artifact.source is not EvidenceSource.REPOSITORY_NATIVE for artifact in artifacts
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
        p3_review_evidence=p3_review_evidence,
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


def _verify_receipt_claims(
    receipt: PhaseExitReceipt,
    *,
    p3_review_evidence: P3ReviewEvidenceBundle | None = None,
) -> tuple[str, ...]:
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
        p3_review_evidence=p3_review_evidence,
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
    p3_review_evidence: P3ReviewEvidenceBundle | None = None,
) -> PortfolioAdmissionDecision:
    """Re-evaluate evidence and exact chain binding; human authority is unavailable."""
    successor = _as_enum(Phase, successor, "successor phase")
    reasons = list(
        _verify_receipt_claims(
            receipt,
            p3_review_evidence=p3_review_evidence if receipt.phase is Phase.P3 else None,
        )
    )
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
            if (
                _verify_receipt_claims(
                    predecessor,
                    p3_review_evidence=p3_review_evidence if predecessor.phase is Phase.P3 else None,
                )
                or not predecessor.successor_authorized
            ):
                reasons.append("predecessor did not authorize this phase")
    return PortfolioAdmissionDecision(receipt.receipt_id, successor, not reasons, tuple(reasons))
