"""Acceptance tests for the fail-closed T002 external-evidence receipt."""

from __future__ import annotations

from dataclasses import FrozenInstanceError, fields, replace

import pytest

from piton.portfolio import (
    ExternalEvidenceT002Receipt,
    validate_external_evidence_t002,
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
    ("field_name", "unsafe_value"),
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
def test_each_locked_field_independently_denies(field_name: str, unsafe_value: object) -> None:
    receipt = replace(ExternalEvidenceT002Receipt(), **{field_name: unsafe_value})

    assert validate_external_evidence_t002(receipt) is False


def test_canonical_unavailable_synthetic_receipt_is_exact_and_valid() -> None:
    receipt = ExternalEvidenceT002Receipt()

    assert {field.name: getattr(receipt, field.name) for field in fields(receipt)} == LOCKED_DEFAULTS
    assert validate_external_evidence_t002(receipt) is True
    assert not hasattr(receipt, "successor_authorized")


def test_receipt_is_immutable() -> None:
    receipt = ExternalEvidenceT002Receipt()

    with pytest.raises(FrozenInstanceError):
        receipt.threshold_passed = True  # type: ignore[misc]


@pytest.mark.parametrize(
    "malformed",
    (
        object(),
        {**LOCKED_DEFAULTS},
        replace(ExternalEvidenceT002Receipt(), paid_partner_count=False),
        replace(ExternalEvidenceT002Receipt(), recognized_revenue_usd=0.0),
    ),
)
def test_unknown_missing_or_truthy_equivalent_inputs_deny(malformed: object) -> None:
    assert validate_external_evidence_t002(malformed) is False  # type: ignore[arg-type]
