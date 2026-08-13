"""Deterministic seeded schedules producing readiness evidence only.

This bounded model exercises declared fault/interleaving controls.  Its receipts
are observations about this model at one exact candidate; they cannot advance
review, approval, export, release, or machine state and do not complete G2.
"""
from __future__ import annotations

import hashlib
import json
import random
import re
from dataclasses import dataclass, fields
from types import MappingProxyType
from typing import Any, ClassVar, Literal, Mapping

_RUN_COUNT = 1000
_DIGEST = re.compile(r"^sha256:[0-9a-f]{64}$")
_COMMIT = re.compile(r"^[0-9a-f]{40}$")

CRITICAL_COUNTER_NAMES = (
    "critical_violations",
    "false_successes",
    "false_releases",
    "missing_referenced_artifacts",
    "stale_promotions",
    "duplicate_external_effects",
    "unauthorized_approvals_or_releases",
    "unauthorized_cross_project_reads",
)

_FAULTS = (
    "stage-write-interrupted",
    "cas-promotion-interrupted",
    "lease-expires-before-commit",
    "stale-fence-before-commit",
    "duplicate-delivery",
    "cross-project-read",
    "unauthorized-approval",
    "unauthorized-release",
)
_EVENTS = (
    "persist-attempt",
    "acquire-lease",
    "stage-artifact",
    "promote-cas",
    "commit-closure",
    "deliver-outbox",
    "recover",
)


def _canonical_bytes(value: Any) -> bytes:
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
        allow_nan=False,
    ).encode("utf-8") + b"\n"


def _digest(value: Any) -> str:
    return "sha256:" + hashlib.sha256(_canonical_bytes(value)).hexdigest()


def _require_digest(name: str, value: str) -> None:
    if not isinstance(value, str) or _DIGEST.fullmatch(value) is None:
        raise ValueError(f"{name} must be sha256:<64 lowercase hex>")


def generate_schedule(seed: int) -> tuple[str, ...]:
    """Generate one stable, replayable injected-fault schedule."""
    if type(seed) is not int or not 0 <= seed < _RUN_COUNT:
        raise ValueError("seed must be an integer from 0 through 999")
    randomizer = random.Random(seed)
    middle = list(_EVENTS[1:-1])
    randomizer.shuffle(middle)
    return (
        _EVENTS[0],
        *middle,
        f"inject:{_FAULTS[seed % len(_FAULTS)]}",
        _EVENTS[-1],
        f"seed:{seed}",
    )


@dataclass(frozen=True, slots=True)
class ScheduleOutcome:
    seed: int
    fault: str
    schedule: tuple[str, ...]
    schedule_digest: str
    status: Literal["pass", "fail"]
    counters: Mapping[str, int]
    diagnostics: tuple[str, ...]

    def __post_init__(self) -> None:
        schedule = tuple(self.schedule)
        supplied_counters = dict(self.counters)
        if type(self.seed) is not int or not 0 <= self.seed < _RUN_COUNT:
            raise ValueError("outcome seed is outside the declared campaign")
        if self.fault not in _FAULTS or schedule != generate_schedule(self.seed):
            raise ValueError("outcome does not match its deterministic schedule")
        if self.schedule_digest != _digest({"seed": self.seed, "schedule": list(schedule)}):
            raise ValueError("schedule digest does not match schedule")
        if self.status not in ("pass", "fail"):
            raise ValueError("outcome status is invalid")
        if set(supplied_counters) != set(CRITICAL_COUNTER_NAMES) or any(
            type(value) is not int or value < 0 for value in supplied_counters.values()
        ):
            raise ValueError("outcome counters do not match the closed counter set")
        counters = {
            name: supplied_counters[name] for name in CRITICAL_COUNTER_NAMES
        }
        object.__setattr__(self, "schedule", schedule)
        object.__setattr__(self, "counters", MappingProxyType(counters))
        object.__setattr__(self, "diagnostics", tuple(self.diagnostics))

    def to_primitive(self) -> dict[str, Any]:
        return {
            "seed": self.seed,
            "fault": self.fault,
            "schedule": list(self.schedule),
            "schedule_digest": self.schedule_digest,
            "status": self.status,
            "counters": dict(self.counters),
            "diagnostics": list(self.diagnostics),
        }

    @classmethod
    def from_primitive(cls, value: Mapping[str, Any]) -> "ScheduleOutcome":
        expected = {item.name for item in fields(cls)}
        if not isinstance(value, Mapping) or set(value) != expected:
            raise ValueError("schedule outcome fields do not match the closed schema")
        return cls(
            seed=value["seed"], fault=value["fault"], schedule=tuple(value["schedule"]),
            schedule_digest=value["schedule_digest"], status=value["status"],
            counters=value["counters"], diagnostics=tuple(value["diagnostics"]),
        )


def _exercise_schedule(seed: int) -> ScheduleOutcome:
    """Exercise one declared fault against a minimal publication authority model."""
    schedule = generate_schedule(seed)
    fault = _FAULTS[seed % len(_FAULTS)]
    counters = {name: 0 for name in CRITICAL_COUNTER_NAMES}

    # The candidate starts unpublished and all lifecycle authority starts false.
    closure_committed = False
    referenced_blob_present = False
    outbox_deliveries = 0
    approval = False
    release = False
    cross_project_read = False
    stale = fault in {"lease-expires-before-commit", "stale-fence-before-commit"}

    if fault not in {"stage-write-interrupted", "cas-promotion-interrupted"}:
        referenced_blob_present = True
    if not stale and referenced_blob_present:
        closure_committed = True
    if fault == "duplicate-delivery" and closure_committed:
        # Two delivery attempts share one idempotency key and yield one effect.
        outbox_deliveries = 1
    elif closure_committed:
        outbox_deliveries = 1
    if fault == "cross-project-read":
        cross_project_read = False  # exact project scoping rejects the read
    if fault == "unauthorized-approval":
        approval = False
    if fault == "unauthorized-release":
        release = False

    counters["missing_referenced_artifacts"] = int(
        closure_committed and not referenced_blob_present
    )
    counters["stale_promotions"] = int(stale and closure_committed)
    counters["duplicate_external_effects"] = max(0, outbox_deliveries - 1)
    counters["unauthorized_approvals_or_releases"] = int(approval or release)
    counters["unauthorized_cross_project_reads"] = int(cross_project_read)
    counters["false_releases"] = int(release)
    counters["false_successes"] = int(
        closure_committed and any(counters[name] for name in CRITICAL_COUNTER_NAMES[2:])
    )
    counters["critical_violations"] = int(any(counters.values()))
    status: Literal["pass", "fail"] = "pass" if not any(counters.values()) else "fail"
    diagnostics = () if status == "pass" else (f"seed {seed} observed a critical counter",)
    return ScheduleOutcome(
        seed=seed,
        fault=fault,
        schedule=schedule,
        schedule_digest=_digest({"seed": seed, "schedule": list(schedule)}),
        status=status,
        counters=counters,
        diagnostics=diagnostics,
    )


@dataclass(frozen=True, slots=True)
class ReadinessCampaign:
    candidate_commit: str
    policy_digest: str
    method_digest: str
    comparator_digest: str
    implementation_digest: str
    environment_digest: str
    toolchain_digest: str
    seeds: tuple[int, ...]
    seed_set_digest: str
    outcomes: tuple[ScheduleOutcome, ...]
    counters: Mapping[str, int]
    claim_scope: Literal["readiness-evidence-only"] = "readiness-evidence-only"
    review_state: Literal["needs_human_review"] = "needs_human_review"
    fabrication_release: Literal[False] = False
    machine_actuation: Literal[False] = False
    stage1_gate_complete: Literal[False] = False
    threshold_passed: Literal[False] = False

    schema: ClassVar[str] = "piton.seeded-readiness-campaign.v1"

    def __post_init__(self) -> None:
        if not isinstance(self.candidate_commit, str) or _COMMIT.fullmatch(self.candidate_commit) is None:
            raise ValueError("candidate_commit must be an exact 40-hex commit")
        for name in (
            "policy_digest", "method_digest", "comparator_digest",
            "implementation_digest", "environment_digest", "toolchain_digest",
            "seed_set_digest",
        ):
            _require_digest(name, getattr(self, name))
        object.__setattr__(self, "seeds", tuple(self.seeds))
        object.__setattr__(self, "outcomes", tuple(self.outcomes))
        supplied_counters = dict(self.counters)
        if set(supplied_counters) != set(CRITICAL_COUNTER_NAMES) or any(
            type(value) is not int or value < 0
            for value in supplied_counters.values()
        ):
            raise ValueError("campaign counters do not match the closed counter set")
        object.__setattr__(
            self,
            "counters",
            MappingProxyType(
                {
                    name: supplied_counters[name]
                    for name in CRITICAL_COUNTER_NAMES
                }
            ),
        )

    @property
    def run_count(self) -> int:
        return len(self.outcomes)

    def to_primitive(self) -> dict[str, Any]:
        return {
            "schema": self.schema,
            "candidate_commit": self.candidate_commit,
            "policy_digest": self.policy_digest,
            "method_digest": self.method_digest,
            "comparator_digest": self.comparator_digest,
            "implementation_digest": self.implementation_digest,
            "environment_digest": self.environment_digest,
            "toolchain_digest": self.toolchain_digest,
            "run_count": self.run_count,
            "seeds": list(self.seeds),
            "seed_set_digest": self.seed_set_digest,
            "outcomes": [item.to_primitive() for item in self.outcomes],
            "counters": dict(self.counters),
            "claim_scope": self.claim_scope,
            "review_state": self.review_state,
            "fabrication_release": self.fabrication_release,
            "machine_actuation": self.machine_actuation,
            "stage1_gate_complete": self.stage1_gate_complete,
            "threshold_passed": self.threshold_passed,
        }

    @property
    def canonical_bytes(self) -> bytes:
        return _canonical_bytes(self.to_primitive())

    @property
    def digest(self) -> str:
        return _digest(self.to_primitive())

    @classmethod
    def from_primitive(cls, value: Mapping[str, Any]) -> "ReadinessCampaign":
        expected = set(cls.__dataclass_fields__) - {"schema"}
        expected.add("schema")
        expected.add("run_count")
        if not isinstance(value, Mapping) or set(value) != expected:
            raise ValueError("readiness campaign fields do not match the closed schema")
        if value["schema"] != cls.schema:
            raise ValueError("unsupported readiness campaign schema")
        payload = {name: value[name] for name in cls.__dataclass_fields__ if name != "schema"}
        payload["seeds"] = tuple(value["seeds"])
        payload["outcomes"] = tuple(ScheduleOutcome.from_primitive(item) for item in value["outcomes"])
        campaign = cls(**payload)
        if value["run_count"] != campaign.run_count:
            raise ValueError("run_count does not match recorded outcomes")
        return campaign


def verify_readiness_campaign(campaign: ReadinessCampaign) -> tuple[str, ...]:
    """Return every fail-closed reason; an empty tuple means model readiness only."""
    reasons: list[str] = []
    expected_seeds = tuple(range(_RUN_COUNT))
    if campaign.seeds != expected_seeds or len(set(campaign.seeds)) != _RUN_COUNT:
        reasons.append("campaign must record exactly 1000 distinct ordered seeds")
    if campaign.seed_set_digest != _digest({"seeds": list(campaign.seeds)}):
        reasons.append("seed-set digest does not match recorded seeds")
    if len(campaign.outcomes) != _RUN_COUNT or tuple(
        item.seed for item in campaign.outcomes
    ) != campaign.seeds:
        reasons.append("campaign must record one outcome for every seed")
    if len({item.schedule_digest for item in campaign.outcomes}) != len(campaign.outcomes):
        reasons.append("campaign schedule identities must be distinct")
    aggregate = {
        name: sum(item.counters[name] for item in campaign.outcomes)
        for name in CRITICAL_COUNTER_NAMES
    }
    if set(campaign.counters) != set(CRITICAL_COUNTER_NAMES) or dict(campaign.counters) != aggregate:
        reasons.append("campaign counters do not close over per-seed outcomes")
    if any(aggregate.values()) or any(item.status != "pass" for item in campaign.outcomes):
        reasons.append("campaign observed one or more critical failures")
    if (
        campaign.claim_scope != "readiness-evidence-only"
        or campaign.review_state != "needs_human_review"
        or campaign.fabrication_release is not False
        or campaign.machine_actuation is not False
        or campaign.stage1_gate_complete is not False
        or campaign.threshold_passed is not False
    ):
        reasons.append("campaign violates readiness-only root truth boundary")
    return tuple(reasons)


@dataclass(frozen=True, slots=True)
class ReadinessPacketClosure:
    """Powerless closure of one exact verified campaign; G2 remains unaccepted."""

    candidate_commit: str
    readiness_campaign_digest: str
    run_count: int
    counters: Mapping[str, int]
    claim_scope: Literal["readiness-evidence-only"] = "readiness-evidence-only"
    review_state: Literal["needs_human_review"] = "needs_human_review"
    g2_accepted: Literal[False] = False
    fabrication_release: Literal[False] = False
    machine_actuation: Literal[False] = False

    schema: ClassVar[str] = "piton.readiness-packet-closure.v1"

    def __post_init__(self) -> None:
        if not isinstance(self.candidate_commit, str) or _COMMIT.fullmatch(self.candidate_commit) is None:
            raise ValueError("candidate_commit must be an exact 40-hex commit")
        _require_digest("readiness_campaign_digest", self.readiness_campaign_digest)
        if type(self.run_count) is not int or self.run_count != _RUN_COUNT:
            raise ValueError("readiness packet must close exactly 1000 runs")
        supplied_counters = dict(self.counters)
        if set(supplied_counters) != set(CRITICAL_COUNTER_NAMES) or any(
            type(value) is not int or value != 0 for value in supplied_counters.values()
        ):
            raise ValueError("readiness packet counters must be the closed zero counter set")
        object.__setattr__(
            self,
            "counters",
            MappingProxyType({name: supplied_counters[name] for name in CRITICAL_COUNTER_NAMES}),
        )
        if (
            self.claim_scope != "readiness-evidence-only"
            or self.review_state != "needs_human_review"
            or self.g2_accepted is not False
            or self.fabrication_release is not False
            or self.machine_actuation is not False
        ):
            raise ValueError("readiness packet violates the root truth boundary")

    def to_primitive(self) -> dict[str, Any]:
        return {
            "schema": self.schema,
            "candidate_commit": self.candidate_commit,
            "readiness_campaign_digest": self.readiness_campaign_digest,
            "run_count": self.run_count,
            "counters": dict(self.counters),
            "claim_scope": self.claim_scope,
            "review_state": self.review_state,
            "g2_accepted": self.g2_accepted,
            "fabrication_release": self.fabrication_release,
            "machine_actuation": self.machine_actuation,
        }

    @property
    def canonical_bytes(self) -> bytes:
        return _canonical_bytes(self.to_primitive())

    @property
    def digest(self) -> str:
        return _digest(self.to_primitive())

    @classmethod
    def from_primitive(cls, value: Mapping[str, Any]) -> "ReadinessPacketClosure":
        expected = set(cls.__dataclass_fields__) - {"schema"}
        expected.add("schema")
        if not isinstance(value, Mapping) or set(value) != expected:
            raise ValueError("readiness packet fields do not match the closed schema")
        if value["schema"] != cls.schema:
            raise ValueError("unsupported readiness packet schema")
        return cls(**{name: value[name] for name in cls.__dataclass_fields__ if name != "schema"})


def close_readiness_packet(
    *,
    candidate_commit: str,
    readiness_campaign_digest: str,
    campaign: ReadinessCampaign,
) -> ReadinessPacketClosure:
    """Close explicitly supplied readiness evidence without accepting or advancing G2."""
    if not isinstance(campaign, ReadinessCampaign):
        raise TypeError("campaign must be a ReadinessCampaign")
    if candidate_commit != campaign.candidate_commit:
        raise ValueError("readiness packet candidate is not the exact candidate campaign binding")
    if readiness_campaign_digest != campaign.digest:
        raise ValueError("readiness packet campaign is not the exact digest binding")
    reasons = verify_readiness_campaign(campaign)
    if reasons:
        raise ValueError("readiness campaign failed verification: " + "; ".join(reasons))
    return ReadinessPacketClosure(
        candidate_commit=candidate_commit,
        readiness_campaign_digest=readiness_campaign_digest,
        run_count=campaign.run_count,
        counters=campaign.counters,
    )


def run_readiness_campaign(
    *,
    candidate_commit: str,
    policy_digest: str,
    method_digest: str,
    comparator_digest: str,
    implementation_digest: str,
    environment_digest: str,
    toolchain_digest: str,
) -> ReadinessCampaign:
    """Run exactly 1,000 schedules once each; never retry or mint advancement."""
    seeds = tuple(range(_RUN_COUNT))
    outcomes = tuple(_exercise_schedule(seed) for seed in seeds)
    aggregate = {
        name: sum(item.counters[name] for item in outcomes)
        for name in CRITICAL_COUNTER_NAMES
    }
    campaign = ReadinessCampaign(
        candidate_commit=candidate_commit,
        policy_digest=policy_digest,
        method_digest=method_digest,
        comparator_digest=comparator_digest,
        implementation_digest=implementation_digest,
        environment_digest=environment_digest,
        toolchain_digest=toolchain_digest,
        seeds=seeds,
        seed_set_digest=_digest({"seeds": list(seeds)}),
        outcomes=outcomes,
        counters=aggregate,
    )
    reasons = verify_readiness_campaign(campaign)
    if reasons:
        raise RuntimeError("readiness campaign failed closed: " + "; ".join(reasons))
    return campaign
