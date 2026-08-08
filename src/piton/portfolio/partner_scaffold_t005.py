"""Synthetic, zero-claim partner-alpha scaffold for P5 task T005.

This receipt proves only the shape and fail-closed behavior of the scaffold.
It is not partner, commercial, review, release, or machine-actuation evidence.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True, slots=True)
class PartnerScaffoldT005Receipt:
    """An immutable receipt whose only valid state makes no external claims."""

    disposition: Literal["unavailable"] = "unavailable"
    synthetic: Literal[True] = True
    threshold_passed: Literal[False] = False
    fabrication_release: Literal[False] = False
    machine_actuation: Literal[False] = False
    review_state: Literal["needs_human_review"] = "needs_human_review"
    g2_accepted: Literal[False] = False
    g7_accepted: Literal[False] = False
    paid_partner_count: Literal[0] = 0
    completed_real_job_count: Literal[0] = 0
    recognized_revenue_usd: Literal[0] = 0


def validate_partner_scaffold_t005(receipt: PartnerScaffoldT005Receipt) -> bool:
    """Return true only for the exact synthetic, zero-claim T005 state."""

    return (
        isinstance(receipt, PartnerScaffoldT005Receipt)
        and receipt.disposition == "unavailable"
        and receipt.synthetic is True
        and receipt.threshold_passed is False
        and receipt.fabrication_release is False
        and receipt.machine_actuation is False
        and receipt.review_state == "needs_human_review"
        and receipt.g2_accepted is False
        and receipt.g7_accepted is False
        and type(receipt.paid_partner_count) is int
        and receipt.paid_partner_count == 0
        and type(receipt.completed_real_job_count) is int
        and receipt.completed_real_job_count == 0
        and type(receipt.recognized_revenue_usd) is int
        and receipt.recognized_revenue_usd == 0
    )
