"""Closed P3 governed-alpha evidence and predeclared P4 assurance policy."""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, fields
from types import MappingProxyType
from typing import Any, ClassVar, Literal, Mapping

from .model import _require_digest, _require_identifier


def _canonical_bytes(value: Any) -> bytes:
    try:
        return json.dumps(
            value,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
            allow_nan=False,
        ).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise ValueError("value must be finite deterministic JSON") from exc


def _digest(value: Any) -> str:
    return "sha256:" + hashlib.sha256(_canonical_bytes(value)).hexdigest()


def _freeze_json(value: Any) -> Any:
    if isinstance(value, dict):
        return MappingProxyType({key: _freeze_json(child) for key, child in value.items()})
    if isinstance(value, list):
        return tuple(_freeze_json(child) for child in value)
    return value


def _thaw_json(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {key: _thaw_json(child) for key, child in value.items()}
    if isinstance(value, tuple):
        return [_thaw_json(child) for child in value]
    return value


def _closed_mapping(value: Mapping[str, Any], fields: tuple[str, ...], name: str) -> None:
    if not isinstance(value, Mapping) or set(value) != set(fields):
        raise ValueError(f"{name} fields do not match the closed schema")


@dataclass(frozen=True, slots=True)
class GovernedAlphaEvidence:
    """Identity-complete P3 evidence with distinct exact and review scopes."""

    project_id: str
    revision_id: str
    build_attempt_id: str
    evidence_closure_digest: str
    framework_packet_closure_digest: str
    review_packet_digest: str
    exact_brep_digest: str
    exact_brep_claim_scope: Literal["exact-realization"]
    step_digest: str
    step_claim_scope: Literal["exact-exchange"]
    review_glb_digest: str
    review_glb_claim_scope: Literal["review-only"]
    review_selection_map_digest: str
    review_selection_map_claim_scope: Literal["review-only"]
    review_state: Literal["needs_human_review"] = "needs_human_review"
    fabrication_release: Literal[False] = False
    machine_actuation: Literal[False] = False
    release_state: Literal["unreleased"] = "unreleased"
    channel_transition: Literal[False] = False

    schema: ClassVar[str] = "piton.governed-alpha-evidence.v1"
    FIELD_NAMES: ClassVar[tuple[str, ...]] = (
        "schema", "project_id", "revision_id", "build_attempt_id",
        "evidence_closure_digest", "framework_packet_closure_digest",
        "review_packet_digest", "exact_brep_digest", "exact_brep_claim_scope",
        "step_digest", "step_claim_scope", "review_glb_digest",
        "review_glb_claim_scope", "review_selection_map_digest",
        "review_selection_map_claim_scope", "review_state",
        "fabrication_release", "machine_actuation", "release_state",
        "channel_transition",
    )

    def __post_init__(self) -> None:
        _require_identifier("project_id", self.project_id)
        _require_identifier("build_attempt_id", self.build_attempt_id)
        if not isinstance(self.revision_id, str) or not re.fullmatch(r"rev_[0-9a-f]{64}", self.revision_id):
            raise ValueError("revision_id must be a derived revision identity")
        for name in (
            "evidence_closure_digest", "framework_packet_closure_digest",
            "review_packet_digest", "exact_brep_digest", "step_digest",
            "review_glb_digest", "review_selection_map_digest",
        ):
            _require_digest(name, getattr(self, name))
        expected = {
            "exact_brep_claim_scope": "exact-realization",
            "step_claim_scope": "exact-exchange",
            "review_glb_claim_scope": "review-only",
            "review_selection_map_claim_scope": "review-only",
            "review_state": "needs_human_review",
            "fabrication_release": False,
            "machine_actuation": False,
            "release_state": "unreleased",
            "channel_transition": False,
        }
        if any(type(getattr(self, name)) is not type(value) or getattr(self, name) != value for name, value in expected.items()):
            raise ValueError("governed-alpha evidence violates claim scope or root truth boundary")

    def to_primitive(self) -> dict[str, Any]:
        return {name: self.schema if name == "schema" else getattr(self, name) for name in self.FIELD_NAMES}

    @property
    def canonical_bytes(self) -> bytes:
        return _canonical_bytes(self.to_primitive()) + b"\n"

    @property
    def digest(self) -> str:
        return _digest(self.to_primitive())

    @classmethod
    def from_primitive(cls, value: Mapping[str, Any]) -> "GovernedAlphaEvidence":
        _closed_mapping(value, cls.FIELD_NAMES, "governed-alpha evidence")
        if value["schema"] != cls.schema:
            raise ValueError("unsupported governed-alpha evidence schema")
        return cls(**{name: value[name] for name in cls.FIELD_NAMES if name != "schema"})


AssuranceCategory = Literal["accessibility", "reliability", "platform"]


@dataclass(frozen=True, slots=True)
class AssuranceRequirement:
    requirement_id: str
    category: AssuranceCategory
    method_digest: str
    comparator_digest: str
    threshold: Mapping[str, Any]
    environment_ids: tuple[str, ...]
    invalidation_conditions: tuple[str, ...]

    FIELD_NAMES: ClassVar[tuple[str, ...]] = (
        "requirement_id", "category", "method_digest", "comparator_digest",
        "threshold", "environment_ids", "invalidation_conditions",
    )

    def __post_init__(self) -> None:
        _require_identifier("requirement_id", self.requirement_id)
        if self.category not in ("accessibility", "reliability", "platform"):
            raise ValueError("unknown assurance requirement category")
        _require_digest("method_digest", self.method_digest)
        _require_digest("comparator_digest", self.comparator_digest)
        threshold = json.loads(_canonical_bytes(dict(self.threshold)))
        if not threshold:
            raise ValueError("assurance threshold must be predeclared")
        object.__setattr__(self, "threshold", _freeze_json(threshold))
        environments = tuple(self.environment_ids)
        invalidations = tuple(self.invalidation_conditions)
        if not environments or len(set(environments)) != len(environments):
            raise ValueError("environment identifiers must be nonempty and unique")
        if not invalidations or any(not isinstance(item, str) or not item for item in invalidations):
            raise ValueError("invalidation conditions must be predeclared")
        for identifier in environments:
            _require_identifier("environment_id", identifier)
        object.__setattr__(self, "environment_ids", environments)
        object.__setattr__(self, "invalidation_conditions", invalidations)

    def to_primitive(self) -> dict[str, Any]:
        return {
            "requirement_id": self.requirement_id,
            "category": self.category,
            "method_digest": self.method_digest,
            "comparator_digest": self.comparator_digest,
            "threshold": _thaw_json(self.threshold),
            "environment_ids": list(self.environment_ids),
            "invalidation_conditions": list(self.invalidation_conditions),
        }

    @classmethod
    def from_primitive(cls, value: Mapping[str, Any]) -> "AssuranceRequirement":
        _closed_mapping(value, cls.FIELD_NAMES, "assurance requirement")
        return cls(
            requirement_id=value["requirement_id"],
            category=value["category"],
            method_digest=value["method_digest"],
            comparator_digest=value["comparator_digest"],
            threshold=value["threshold"],
            environment_ids=tuple(value["environment_ids"]),
            invalidation_conditions=tuple(value["invalidation_conditions"]),
        )


@dataclass(frozen=True, slots=True)
class P4AssurancePolicy:
    """Immutable policy frozen before P4 evidence evaluation."""

    policy_id: str
    requirements: tuple[AssuranceRequirement, ...]
    supported_environment_ids: tuple[str, ...]
    e2e_required: int = 25
    fault_runs_minimum: int = 1000
    critical_violations_maximum: int = 0
    false_successes_maximum: int = 0
    false_releases_maximum: int = 0
    missing_referenced_blobs_maximum: int = 0
    stale_promotions_maximum: int = 0
    duplicate_effects_maximum: int = 0
    unauthorized_cross_project_maximum: int = 0
    a11y_serious_or_critical_maximum: int = 0
    offline_golden_path: Literal[True] = True
    backup_restore_verified: Literal[True] = True
    review_state: Literal["needs_human_review"] = "needs_human_review"
    fabrication_release: Literal[False] = False
    machine_actuation: Literal[False] = False

    schema: ClassVar[str] = "piton.p4-assurance-policy.v1"

    def __post_init__(self) -> None:
        _require_identifier("policy_id", self.policy_id)
        requirements = tuple(self.requirements)
        identifiers = tuple(item.requirement_id for item in requirements)
        if not requirements or len(set(identifiers)) != len(identifiers):
            raise ValueError("assurance requirements must be nonempty with no duplicate identifiers")
        if {item.category for item in requirements} != {"accessibility", "reliability", "platform"}:
            raise ValueError("policy requires accessibility, reliability, and platform requirements")
        environments = tuple(self.supported_environment_ids)
        if not environments or len(set(environments)) != len(environments):
            raise ValueError("supported environment identifiers must be nonempty and unique")
        for item in environments:
            _require_identifier("supported environment ID", item)
        missing = {environment for requirement in requirements for environment in requirement.environment_ids} - set(environments)
        if missing:
            raise ValueError("requirement references an unsupported environment")
        if type(self.e2e_required) is not int or self.e2e_required != 25:
            raise ValueError("P4 policy must reserve exactly 25 E2E scenarios")
        if type(self.fault_runs_minimum) is not int or self.fault_runs_minimum < 1000:
            raise ValueError("P4 policy requires at least 1000 fault runs")
        maxima = (
            self.critical_violations_maximum, self.false_successes_maximum,
            self.false_releases_maximum, self.missing_referenced_blobs_maximum,
            self.stale_promotions_maximum, self.duplicate_effects_maximum,
            self.unauthorized_cross_project_maximum,
            self.a11y_serious_or_critical_maximum,
        )
        if any(type(value) is not int or value != 0 for value in maxima):
            raise ValueError("P4 policy maximum failure thresholds must be zero")
        truths = (
            self.offline_golden_path is True,
            self.backup_restore_verified is True,
            self.review_state == "needs_human_review",
            self.fabrication_release is False,
            self.machine_actuation is False,
        )
        if not all(truths):
            raise ValueError("P4 assurance policy violates its frozen truth boundary")
        object.__setattr__(self, "requirements", requirements)
        object.__setattr__(self, "supported_environment_ids", environments)

    def to_primitive(self) -> dict[str, Any]:
        return {
            "schema": self.schema,
            "policy_id": self.policy_id,
            "requirements": [item.to_primitive() for item in self.requirements],
            "supported_environment_ids": list(self.supported_environment_ids),
            "e2e_required": self.e2e_required,
            "fault_runs_minimum": self.fault_runs_minimum,
            "critical_violations_maximum": self.critical_violations_maximum,
            "false_successes_maximum": self.false_successes_maximum,
            "false_releases_maximum": self.false_releases_maximum,
            "missing_referenced_blobs_maximum": self.missing_referenced_blobs_maximum,
            "stale_promotions_maximum": self.stale_promotions_maximum,
            "duplicate_effects_maximum": self.duplicate_effects_maximum,
            "unauthorized_cross_project_maximum": self.unauthorized_cross_project_maximum,
            "a11y_serious_or_critical_maximum": self.a11y_serious_or_critical_maximum,
            "offline_golden_path": self.offline_golden_path,
            "backup_restore_verified": self.backup_restore_verified,
            "review_state": self.review_state,
            "fabrication_release": self.fabrication_release,
            "machine_actuation": self.machine_actuation,
        }

    @property
    def canonical_bytes(self) -> bytes:
        return _canonical_bytes(self.to_primitive()) + b"\n"

    @property
    def digest(self) -> str:
        return _digest(self.to_primitive())

    @classmethod
    def from_primitive(cls, value: Mapping[str, Any]) -> "P4AssurancePolicy":
        field_names = tuple(item.name for item in fields(cls))
        _closed_mapping(value, ("schema", *field_names), "P4 assurance policy")
        if value["schema"] != cls.schema:
            raise ValueError("unsupported P4 assurance policy schema")
        payload = {name: value[name] for name in field_names}
        payload["requirements"] = tuple(AssuranceRequirement.from_primitive(item) for item in value["requirements"])
        payload["supported_environment_ids"] = tuple(value["supported_environment_ids"])
        return cls(**payload)


@dataclass(frozen=True, slots=True)
class P4AssuranceEvidence:
    policy_digest: str
    evaluated_requirement_ids: tuple[str, ...]
    result: Literal["hold", "rework", "stop", "reject"]
    review_state: Literal["needs_human_review"] = "needs_human_review"
    fabrication_release: Literal[False] = False
    machine_actuation: Literal[False] = False

    schema: ClassVar[str] = "piton.p4-assurance-evidence.v1"

    def __post_init__(self) -> None:
        _require_digest("policy_digest", self.policy_digest)
        identifiers = tuple(self.evaluated_requirement_ids)
        if not identifiers or len(set(identifiers)) != len(identifiers):
            raise ValueError("evaluated requirement identifiers must be nonempty and unique")
        for identifier in identifiers:
            _require_identifier("evaluated requirement ID", identifier)
        if self.result not in ("hold", "rework", "stop", "reject"):
            raise ValueError("P4 evidence cannot self-declare advancement")
        if self.review_state != "needs_human_review" or self.fabrication_release is not False or self.machine_actuation is not False:
            raise ValueError("P4 assurance evidence violates the root truth boundary")
        object.__setattr__(self, "evaluated_requirement_ids", identifiers)

    def to_primitive(self) -> dict[str, Any]:
        return {
            "schema": self.schema,
            "policy_digest": self.policy_digest,
            "evaluated_requirement_ids": list(self.evaluated_requirement_ids),
            "result": self.result,
            "review_state": self.review_state,
            "fabrication_release": self.fabrication_release,
            "machine_actuation": self.machine_actuation,
        }

    @classmethod
    def from_primitive(cls, value: Mapping[str, Any]) -> "P4AssuranceEvidence":
        field_names = tuple(item.name for item in fields(cls))
        _closed_mapping(value, ("schema", *field_names), "P4 assurance evidence")
        if value["schema"] != cls.schema:
            raise ValueError("unsupported P4 assurance evidence schema")
        payload = {name: value[name] for name in field_names}
        payload["evaluated_requirement_ids"] = tuple(value["evaluated_requirement_ids"])
        return cls(**payload)


def validate_p4_evidence_policy_binding(
    policy: P4AssurancePolicy, evidence: P4AssuranceEvidence
) -> tuple[str, ...]:
    """Fail closed unless evidence names one exact, predeclared policy contract."""
    reasons: list[str] = []
    if evidence.policy_digest != policy.digest:
        reasons.append("P4 evidence policy digest does not match the frozen policy")
    expected = tuple(item.requirement_id for item in policy.requirements)
    if evidence.evaluated_requirement_ids != expected:
        reasons.append("P4 evidence does not preserve the exact predeclared requirements")
    return tuple(reasons)


def _requirement(
    requirement_id: str,
    category: AssuranceCategory,
    method: str,
    comparator: str,
    threshold: Mapping[str, Any],
    environment_ids: tuple[str, ...],
    invalidation_conditions: tuple[str, ...],
) -> AssuranceRequirement:
    return AssuranceRequirement(
        requirement_id=requirement_id,
        category=category,
        method_digest=_digest({"method": method}),
        comparator_digest=_digest({"comparator": comparator}),
        threshold=threshold,
        environment_ids=environment_ids,
        invalidation_conditions=invalidation_conditions,
    )


def default_p4_assurance_policy() -> P4AssurancePolicy:
    """Return the source-native v1 policy frozen before assurance execution."""
    accessibility_environments = (
        "firefox-130-windows-11-nvda-2024-4",
        "safari-17-macos-14-voiceover",
        "chrome-130-android-14-talkback",
    )
    local_environment = "trusted-local-offline"
    requirements = (
        _requirement(
            "wcag-2-2-aa-named-matrix",
            "accessibility",
            "Run declared WCAG 2.2 AA procedures with each named browser, OS, and assistive technology combination.",
            "Reject any serious or critical finding; retain per-environment evidence.",
            {"serious_or_critical_maximum": 0},
            accessibility_environments,
            ("browser, OS, assistive technology, viewer asset, or procedure changes",),
        ),
        _requirement(
            "fault-and-concurrency-readiness",
            "reliability",
            "Execute deterministic fault and concurrency readiness runs against the exact candidate and environment.",
            "Require at least 1000 runs and zero critical violations, false successes, false releases, missing blobs, stale promotions, duplicate effects, or unauthorized cross-project reads.",
            {"runs_minimum": 1000, "all_failure_maxima": 0},
            (local_environment,),
            ("candidate, environment, fault schedule, checker, or comparator changes",),
        ),
        _requirement(
            "offline-golden-path",
            "reliability",
            "Exercise the complete declared golden path with network access unavailable.",
            "Require all declared steps to complete without a network request or missing vendored byte.",
            {"completed": True, "network_requests_maximum": 0},
            (local_environment,),
            ("viewer assets, dependency locks, cache, mirror, or golden-path steps change",),
        ),
        _requirement(
            "backup-restore-readback",
            "reliability",
            "Restore immutable objects and CAS references into a clean local instance and read back every referenced digest.",
            "Require exact digest equality and zero missing referenced objects; SQLite page replication is forbidden.",
            {"digest_mismatches_maximum": 0, "missing_objects_maximum": 0},
            (local_environment,),
            ("storage schema, backup procedure, restore procedure, or object set changes",),
        ),
        _requirement(
            "supported-platform-matrix",
            "platform",
            "Load and interact with the exact review packet on each declared browser, OS, GPU, and assistive-technology row.",
            "Permit claims only for rows carrying complete row-scoped evidence; no nearest-platform substitution.",
            {"unsupported_or_missing_rows_maximum": 0},
            (*accessibility_environments, local_environment),
            ("browser, OS, GPU, assistive technology, driver, or viewer version changes",),
        ),
        _requirement(
            "performance-budgets",
            "platform",
            "Measure model size, startup, memory, CPU, battery, interaction latency, output size, and graceful failure per supported row.",
            "Compare every metric to its predeclared row-scoped budget and reject absent measurements.",
            {"missing_measurements_maximum": 0, "budget_exceedances_maximum": 0},
            (*accessibility_environments, local_environment),
            ("model, viewer, platform row, measurement method, or budget changes",),
        ),
        _requirement(
            "vendored-csp-license-privacy",
            "platform",
            "Read back vendored dependency bytes, hashes, notices, CSP, disconnected behavior, and privacy evidence.",
            "Require zero hash drift, network-capable CSP directives, missing notices, or undeclared data flows.",
            {"violations_maximum": 0},
            (*accessibility_environments, local_environment),
            ("dependency bytes, notices, CSP, review assets, or data-flow declarations change",),
        ),
    )
    return P4AssurancePolicy(
        policy_id="p4-assurance-alpha-v1",
        requirements=requirements,
        supported_environment_ids=(*accessibility_environments, local_environment),
    )


DEFAULT_P4_ASSURANCE_POLICY = default_p4_assurance_policy()
