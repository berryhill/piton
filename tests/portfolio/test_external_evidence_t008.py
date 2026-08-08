"""Acceptance tests for the fail-closed T008 external-evidence disposition."""

from __future__ import annotations

from dataclasses import FrozenInstanceError, fields, replace

import pytest

from piton.portfolio import (
    ExternalEvidenceT008Receipt,
    validate_external_evidence_t008,
)


LOCKED_DEFAULTS = {
    "disposition": "unavailable",
    "synthetic": True,
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
def test_each_locked_field_independently_fails_closed(
    field_name: str, positive_value: object
) -> None:
    receipt = replace(ExternalEvidenceT008Receipt(), **{field_name: positive_value})

    assert validate_external_evidence_t008(receipt) is False


def test_canonical_receipt_is_exactly_zero_claim_and_valid() -> None:
    receipt = ExternalEvidenceT008Receipt()

    assert {field.name: getattr(receipt, field.name) for field in fields(receipt)} == LOCKED_DEFAULTS
    assert validate_external_evidence_t008(receipt) is True
    assert not hasattr(receipt, "successor_authorized")
    assert not hasattr(receipt, "engineering_approved")


@pytest.mark.parametrize(
    "malformed",
    (
        object(),
        {**LOCKED_DEFAULTS},
        replace(ExternalEvidenceT008Receipt(), disposition=True),
        replace(ExternalEvidenceT008Receipt(), review_state=True),
        replace(ExternalEvidenceT008Receipt(), paid_partner_count=False),
        replace(ExternalEvidenceT008Receipt(), completed_real_job_count=0.0),
        replace(ExternalEvidenceT008Receipt(), recognized_revenue_usd=False),
    ),
)
def test_wrong_runtime_shape_or_truthy_equivalents_deny(malformed: object) -> None:
    assert validate_external_evidence_t008(malformed) is False  # type: ignore[arg-type]


def test_receipt_is_frozen_slotted_and_closed() -> None:
    receipt = ExternalEvidenceT008Receipt()

    with pytest.raises(FrozenInstanceError):
        receipt.threshold_passed = True  # type: ignore[misc]
    with pytest.raises((AttributeError, TypeError)):
        receipt.successor_authorized = True  # type: ignore[attr-defined]

    assert not hasattr(receipt, "__dict__")
