"""Fail-closed partner-alpha scaffolds for the T002 and T006 slices.

These records only the absence of partner/commercial evidence. They cannot
satisfy an external threshold, accept G2/G7, authorize a successor, elevate
review state, release fabrication, or actuate machinery.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final


@dataclass(frozen=True, slots=True)
class PartnerAlphaScaffoldT002:
    """Immutable shape for the synthetic T002 zero-claim receipt."""

    disposition: str = "unavailable"
    synthetic: bool = True
    threshold_passed: bool = False
    review_state: str = "needs_human_review"
    fabrication_release: bool = False
    machine_actuation: bool = False
    g2_accepted: bool = False
    g7_accepted: bool = False
    paid_partner_count: int = 0
    completed_real_job_count: int = 0
    recognized_revenue_usd: int = 0


DEFAULT_PARTNER_SCAFFOLD_T002: Final = PartnerAlphaScaffoldT002()

_T002_LOCKED_FIELDS: Final = (
    ("disposition", str, "unavailable"),
    ("synthetic", bool, True),
    ("threshold_passed", bool, False),
    ("review_state", str, "needs_human_review"),
    ("fabrication_release", bool, False),
    ("machine_actuation", bool, False),
    ("g2_accepted", bool, False),
    ("g7_accepted", bool, False),
    ("paid_partner_count", int, 0),
    ("completed_real_job_count", int, 0),
    ("recognized_revenue_usd", int, 0),
)


def validate_partner_scaffold_t002(receipt: object) -> bool:
    """Return true only for the exact, type-strict T002 zero-claim state."""
    if type(receipt) is not PartnerAlphaScaffoldT002:
        return False
    return all(
        type(getattr(receipt, name)) is expected_type
        and getattr(receipt, name) == expected_value
        for name, expected_type, expected_value in _T002_LOCKED_FIELDS
    )


@dataclass(frozen=True, slots=True)
class PartnerAlphaReceipt:
    """An inert T006 commercial-gate observation, never admission authority."""

    synthetic: bool = True
    available: bool = False
    threshold_passed: bool = False
    paid_partner_count: int = 0
    completed_real_job_count: int = 0
    recognized_revenue_usd: int = 0
    g2_accepted: bool = False
    g7_accepted: bool = False
    review_state: str = "needs_human_review"
    fabrication_release: bool = False
    machine_actuation: bool = False


def validate_partner_alpha_receipt(receipt: PartnerAlphaReceipt) -> None:
    """Fail closed unless *receipt* is the exact T006 zero-claim scaffold."""
    if not isinstance(receipt, PartnerAlphaReceipt):
        raise ValueError("receipt must be a PartnerAlphaReceipt")

    expected_literals = (
        ("synthetic", receipt.synthetic, True),
        ("available", receipt.available, False),
        ("threshold_passed", receipt.threshold_passed, False),
        ("g2_accepted", receipt.g2_accepted, False),
        ("g7_accepted", receipt.g7_accepted, False),
        ("fabrication_release", receipt.fabrication_release, False),
        ("machine_actuation", receipt.machine_actuation, False),
    )
    for name, actual, expected in expected_literals:
        if actual is not expected:
            raise ValueError(f"{name} must remain {str(expected).lower()}")

    if receipt.review_state != "needs_human_review":
        raise ValueError("review_state must remain needs_human_review")

    for name in ("paid_partner_count", "completed_real_job_count", "recognized_revenue_usd"):
        value = getattr(receipt, name)
        if type(value) is not int or value != 0:
            raise ValueError(f"{name} must remain literal integer zero")


def default_partner_alpha_receipt() -> PartnerAlphaReceipt:
    """Return the validated unavailable receipt; no external facts are inferred."""
    receipt = PartnerAlphaReceipt()
    validate_partner_alpha_receipt(receipt)
    return receipt
