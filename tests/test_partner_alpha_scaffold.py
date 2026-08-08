"""T002 partner-alpha scaffold remains an immutable zero-claim receipt."""

from __future__ import annotations

from dataclasses import FrozenInstanceError, fields, replace

import pytest

from piton.partner_alpha import (
    DEFAULT_PARTNER_SCAFFOLD_T002,
    PartnerAlphaScaffoldT002,
    validate_partner_scaffold_t002,
)


LOCKED_VALUES = {
    "disposition": "unavailable",
    "synthetic": True,
    "threshold_passed": False,
    "review_state": "needs_human_review",
    "fabrication_release": False,
    "machine_actuation": False,
    "g2_accepted": False,
    "g7_accepted": False,
    "paid_partner_count": 0,
    "completed_real_job_count": 0,
    "recognized_revenue_usd": 0,
}


def test_default_t002_receipt_is_the_exact_zero_claim_scaffold() -> None:
    receipt = DEFAULT_PARTNER_SCAFFOLD_T002

    assert isinstance(receipt, PartnerAlphaScaffoldT002)
    assert {field.name: getattr(receipt, field.name) for field in fields(receipt)} == LOCKED_VALUES
    assert validate_partner_scaffold_t002(receipt) is True


def test_t002_receipt_is_immutable() -> None:
    with pytest.raises(FrozenInstanceError):
        DEFAULT_PARTNER_SCAFFOLD_T002.paid_partner_count = 1  # type: ignore[misc]


@pytest.mark.parametrize(
    ("field_name", "changed_value"),
    (
        ("disposition", "available"),
        ("synthetic", False),
        ("threshold_passed", True),
        ("review_state", "approved"),
        ("fabrication_release", True),
        ("machine_actuation", True),
        ("g2_accepted", True),
        ("g7_accepted", True),
        ("paid_partner_count", 1),
        ("completed_real_job_count", 1),
        ("recognized_revenue_usd", 1),
    ),
)
def test_validator_rejects_every_changed_locked_field(
    field_name: str, changed_value: object
) -> None:
    changed = replace(DEFAULT_PARTNER_SCAFFOLD_T002, **{field_name: changed_value})

    assert validate_partner_scaffold_t002(changed) is False


def test_validator_rejects_lookalikes_and_type_coercions() -> None:
    assert validate_partner_scaffold_t002(LOCKED_VALUES) is False
    assert validate_partner_scaffold_t002(None) is False
    assert (
        validate_partner_scaffold_t002(
            replace(DEFAULT_PARTNER_SCAFFOLD_T002, paid_partner_count=False)
        )
        is False
    )
