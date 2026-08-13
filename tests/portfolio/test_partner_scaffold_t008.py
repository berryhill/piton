from __future__ import annotations

import json
from dataclasses import FrozenInstanceError, replace
from pathlib import Path

import pytest

from piton.portfolio import (
    PartnerScaffoldT008Receipt,
    serialize_partner_scaffold_t008,
    validate_partner_scaffold_t008,
)


ROOT = Path(__file__).resolve().parents[2]
FIXTURE_PATH = ROOT / "evidence/stage0/08-partner-alpha/partner-scaffold-t008.json"

LOCKED_DEFAULTS = {
    "schema": "piton.partner-alpha-scaffold.t008.v1",
    "disposition": "unavailable",
    "synthetic": True,
    "claim_scope": "fixture-only",
    "external_thresholds_passed": False,
    "successor_authorized": False,
    "threshold_passed": False,
    "fabrication_release": False,
    "machine_actuation": False,
    "review_state": "needs_human_review",
    "g2_accepted": False,
    "g7_accepted": False,
    "paid_partner_count": 0,
    "completed_real_job_count": 0,
    "recognized_revenue_usd": 0,
}


@pytest.mark.parametrize(
    ("field_name", "positive_value"),
    (
        ("disposition", "available"),
        ("synthetic", False),
        ("claim_scope", "external-evidence"),
        ("external_thresholds_passed", True),
        ("successor_authorized", True),
        ("threshold_passed", True),
        ("fabrication_release", True),
        ("machine_actuation", True),
        ("review_state", "approved"),
        ("g2_accepted", True),
        ("g7_accepted", True),
        ("paid_partner_count", 1),
        ("completed_real_job_count", 1),
        ("recognized_revenue_usd", 1),
    ),
)
def test_each_authority_positive_mutation_fails_closed(
    field_name: str, positive_value: object
) -> None:
    receipt = replace(PartnerScaffoldT008Receipt(), **{field_name: positive_value})

    assert validate_partner_scaffold_t008(receipt) is False


def test_canonical_fixture_is_exactly_zero_claim_and_deterministic() -> None:
    fixture_bytes = FIXTURE_PATH.read_bytes()
    payload = json.loads(fixture_bytes)
    receipt = PartnerScaffoldT008Receipt.from_dict(payload)

    assert receipt.to_dict() == LOCKED_DEFAULTS
    assert validate_partner_scaffold_t008(receipt) is True
    assert serialize_partner_scaffold_t008(receipt).encode("utf-8") == fixture_bytes


@pytest.mark.parametrize(
    ("field_name", "wrong_value"),
    (
        ("disposition", True),
        ("synthetic", 1),
        ("claim_scope", True),
        ("external_thresholds_passed", 0),
        ("successor_authorized", 0),
        ("threshold_passed", 0),
        ("fabrication_release", 0),
        ("machine_actuation", 0),
        ("review_state", True),
        ("g2_accepted", 0),
        ("g7_accepted", 0),
        ("paid_partner_count", False),
        ("completed_real_job_count", 0.0),
        ("recognized_revenue_usd", False),
    ),
)
def test_runtime_truthy_equivalents_and_wrong_types_fail_closed(
    field_name: str, wrong_value: object
) -> None:
    receipt = replace(PartnerScaffoldT008Receipt(), **{field_name: wrong_value})

    assert validate_partner_scaffold_t008(receipt) is False


def test_wrong_receipt_type_and_subclass_fail_closed() -> None:
    class ReceiptSubclass(PartnerScaffoldT008Receipt):
        pass

    assert validate_partner_scaffold_t008(object()) is False
    assert validate_partner_scaffold_t008(ReceiptSubclass()) is False


def test_closed_parser_rejects_missing_and_unknown_fields() -> None:
    missing = dict(LOCKED_DEFAULTS)
    missing.pop("machine_actuation")
    with pytest.raises(ValueError, match="closed partner scaffold schema"):
        PartnerScaffoldT008Receipt.from_dict(missing)

    unknown = {**LOCKED_DEFAULTS, "customer_name": "example"}
    with pytest.raises(ValueError, match="closed partner scaffold schema"):
        PartnerScaffoldT008Receipt.from_dict(unknown)


def test_receipt_is_frozen_and_slotted() -> None:
    receipt = PartnerScaffoldT008Receipt()

    with pytest.raises(FrozenInstanceError):
        receipt.threshold_passed = True  # type: ignore[misc]
    with pytest.raises((AttributeError, TypeError)):
        receipt.customer_name = "example"  # type: ignore[attr-defined]
    assert not hasattr(receipt, "__dict__")
