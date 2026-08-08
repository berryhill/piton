"""Zero-claim partner-alpha receipt for the T006 foundation scaffold.

This receipt records only that real partner-alpha evidence is unavailable.  It
cannot represent commercial threshold passage, portfolio-gate acceptance,
engineering review, fabrication release, or machine actuation.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class PartnerAlphaReceipt:
    """An inert commercial-gate observation, never admission authority."""

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
