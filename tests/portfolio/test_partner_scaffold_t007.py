from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path

import pytest

from piton.portfolio import (
    Authority,
    Disposition,
    EvidenceArtifact,
    ExecutionStatus,
    PartnerScaffoldT007Receipt,
    Phase,
    SafetyState,
    issue_phase_exit_receipt,
    serialize_partner_scaffold_t007,
    validate_partner_scaffold_t007,
)


ROOT = Path(__file__).resolve().parents[2]
FIXTURE_PATH = ROOT / "evidence/stage0/08-partner-alpha/partner-scaffold-t007.json"


def test_zero_claim_fixture_has_closed_shape_and_stable_serialization() -> None:
    fixture_bytes = FIXTURE_PATH.read_bytes()
    assert fixture_bytes.decode("utf-8").encode("utf-8") == fixture_bytes

    payload = json.loads(fixture_bytes)
    receipt = PartnerScaffoldT007Receipt.from_dict(payload)

    assert validate_partner_scaffold_t007(receipt)
    assert receipt.to_dict() == payload
    assert serialize_partner_scaffold_t007(receipt).encode("utf-8") == fixture_bytes
    assert set(payload) == set(PartnerScaffoldT007Receipt.FIELD_NAMES)


@pytest.mark.parametrize(
    ("field", "unsafe_value"),
    (
        ("synthetic", False),
        ("claim_scope", "external-evidence"),
        ("external_thresholds_passed", True),
        ("successor_authorized", True),
        ("threshold_passed", True),
        ("fabrication_release", True),
        ("machine_actuation", True),
        ("review_state", "approved"),
        ("disposition", "available"),
        ("g2_accepted", True),
        ("g7_accepted", True),
        ("paid_partner_count", 1),
        ("completed_real_job_count", 1),
        ("recognized_revenue_usd", 1),
    ),
)
def test_zero_claim_validator_rejects_positive_or_unsafe_mutations(
    field: str, unsafe_value: object
) -> None:
    receipt = PartnerScaffoldT007Receipt()
    assert not validate_partner_scaffold_t007(replace(receipt, **{field: unsafe_value}))


def test_closed_shape_rejects_missing_and_unknown_fields() -> None:
    payload = PartnerScaffoldT007Receipt().to_dict()

    missing = dict(payload)
    missing.pop("machine_actuation")
    with pytest.raises(ValueError, match="closed partner scaffold schema"):
        PartnerScaffoldT007Receipt.from_dict(missing)

    unknown = {**payload, "customer_name": "example"}
    with pytest.raises(ValueError, match="closed partner scaffold schema"):
        PartnerScaffoldT007Receipt.from_dict(unknown)


def test_fixture_cannot_be_admitted_as_positive_portfolio_evidence() -> None:
    fixture = PartnerScaffoldT007Receipt()
    artifact = EvidenceArtifact.from_content(
        artifact_id="partner-alpha-t007",
        repository_path="evidence/stage0/08-partner-alpha/partner-scaffold-t007.json",
        content={"nested": [fixture.to_dict()]},
    )
    receipt = issue_phase_exit_receipt(
        receipt_id="partner-alpha-t007-exit",
        phase=Phase.P5,
        status=ExecutionStatus.COMPLETED,
        disposition=Disposition.ADVANCE,
        authority=Authority.HUMAN,
        predecessor_receipt_id="p4-human-receipt",
        predecessor_receipt_digest="sha256:" + "0" * 64,
        predicates={},
        evidence=(artifact,),
        safety=SafetyState(),
    )

    assert not receipt.successor_authorized
    reasons = " ".join(receipt.authorization_reasons).lower()
    assert "scaffold" in reasons
    assert "p5 is terminal" in reasons
