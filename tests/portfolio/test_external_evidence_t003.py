from dataclasses import FrozenInstanceError, fields, replace

import pytest

from piton.portfolio import (
    ExternalEvidenceT003Receipt,
    validate_external_evidence_t003,
)


def test_default_receipt_is_synthetic_unavailable_and_valid() -> None:
    receipt = ExternalEvidenceT003Receipt()

    assert validate_external_evidence_t003(receipt) is True
    assert receipt.disposition == "unavailable"
    assert receipt.synthetic is True
    assert receipt.threshold_passed is False
    assert receipt.review_state == "needs_human_review"
    assert receipt.fabrication_release is False
    assert receipt.machine_actuation is False
    assert receipt.g2_accepted is False
    assert receipt.g7_accepted is False
    assert receipt.paid_partner_count == 0
    assert receipt.completed_real_job_count == 0
    assert receipt.recognized_revenue_usd == 0


@pytest.mark.parametrize(
    ("field_name", "invalid_value"),
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
def test_every_non_default_field_value_fails_closed(
    field_name: str, invalid_value: object
) -> None:
    receipt = replace(ExternalEvidenceT003Receipt(), **{field_name: invalid_value})

    assert validate_external_evidence_t003(receipt) is False


@pytest.mark.parametrize(
    "field_name",
    ("paid_partner_count", "completed_real_job_count", "recognized_revenue_usd"),
)
def test_boolean_false_cannot_pass_as_integer_zero(field_name: str) -> None:
    receipt = replace(ExternalEvidenceT003Receipt(), **{field_name: False})

    assert validate_external_evidence_t003(receipt) is False


def test_validator_rejects_wrong_runtime_type_without_raising() -> None:
    assert validate_external_evidence_t003(object()) is False  # type: ignore[arg-type]


def test_receipt_is_frozen_slotted_and_closed() -> None:
    receipt = ExternalEvidenceT003Receipt()

    with pytest.raises(FrozenInstanceError):
        receipt.disposition = "available"  # type: ignore[misc]
    with pytest.raises((AttributeError, TypeError)):
        receipt.unknown_authority = True  # type: ignore[attr-defined]

    assert not hasattr(receipt, "__dict__")
    assert tuple(field.name for field in fields(receipt)) == (
        "disposition",
        "synthetic",
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
