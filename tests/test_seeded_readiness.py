"""Acceptance tests for readiness-only seeded fault/concurrency evidence."""
from __future__ import annotations

from dataclasses import replace
import json

import pytest

from piton.seeded_readiness import (
    CRITICAL_COUNTER_NAMES,
    ReadinessCampaign,
    generate_schedule,
    run_readiness_campaign,
    verify_readiness_campaign,
)

CANDIDATE = "1" * 40
POLICY = "sha256:" + "2" * 64
METHOD = "sha256:" + "3" * 64
COMPARATOR = "sha256:" + "4" * 64
IMPLEMENTATION = "sha256:" + "5" * 64
ENVIRONMENT = "sha256:" + "6" * 64
TOOLCHAIN = "sha256:" + "7" * 64


def campaign() -> ReadinessCampaign:
    return run_readiness_campaign(
        candidate_commit=CANDIDATE,
        policy_digest=POLICY,
        method_digest=METHOD,
        comparator_digest=COMPARATOR,
        implementation_digest=IMPLEMENTATION,
        environment_digest=ENVIRONMENT,
        toolchain_digest=TOOLCHAIN,
    )


def test_campaign_records_exact_ordered_seed_closure_and_injected_schedules() -> None:
    result = campaign()

    assert result.claim_scope == "readiness-evidence-only"
    assert result.seeds == tuple(range(1000))
    assert len(result.outcomes) == 1000
    assert tuple(item.seed for item in result.outcomes) == result.seeds
    assert len({item.schedule_digest for item in result.outcomes}) == 1000
    assert all(item.fault != "none" for item in result.outcomes)
    assert {item.fault for item in result.outcomes} == {
        "stage-write-interrupted",
        "cas-promotion-interrupted",
        "lease-expires-before-commit",
        "stale-fence-before-commit",
        "duplicate-delivery",
        "cross-project-read",
        "unauthorized-approval",
        "unauthorized-release",
    }
    assert verify_readiness_campaign(result) == ()


def test_campaign_is_canonical_replayable_and_bound_to_exact_inputs() -> None:
    first = campaign()
    second = campaign()

    assert first.canonical_bytes == second.canonical_bytes
    assert first.digest == second.digest
    primitive = json.loads(first.canonical_bytes)
    assert primitive["candidate_commit"] == CANDIDATE
    assert primitive["run_count"] == 1000
    assert primitive["seed_set_digest"] == first.seed_set_digest
    assert ReadinessCampaign.from_primitive(primitive) == first
    for seed in (0, 499, 999):
        assert first.outcomes[seed].schedule == generate_schedule(seed)


def test_campaign_reports_every_zero_counter_and_retains_safe_truth() -> None:
    result = campaign()

    assert tuple(result.counters) == CRITICAL_COUNTER_NAMES
    assert dict(result.counters) == {name: 0 for name in CRITICAL_COUNTER_NAMES}
    assert all(item.status == "pass" for item in result.outcomes)
    assert result.review_state == "needs_human_review"
    assert result.fabrication_release is False
    assert result.machine_actuation is False
    assert result.stage1_gate_complete is False
    assert result.threshold_passed is False


def test_verifier_fails_closed_on_incomplete_duplicate_or_forged_evidence() -> None:
    result = campaign()
    duplicate = replace(result, seeds=(*result.seeds[:-1], result.seeds[-2]))
    incomplete = replace(result, outcomes=result.outcomes[:-1])
    unsafe = replace(result, fabrication_release=True)

    assert any("distinct ordered seeds" in reason for reason in verify_readiness_campaign(duplicate))
    assert any("one outcome" in reason for reason in verify_readiness_campaign(incomplete))
    assert any("root truth" in reason for reason in verify_readiness_campaign(unsafe))
    with pytest.raises(ValueError, match="closed schema"):
        ReadinessCampaign.from_primitive({**json.loads(result.canonical_bytes), "approval": True})
