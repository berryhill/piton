"""Synthetic, non-evidentiary Partner Alpha T001 fixture.

This repository-native scaffold proves only the zero-claim contract. It records
no outreach, consent, commitment, payment, observed work, validated demand,
engineering approval, export, release, or machine activity, and it cannot
authorize a successor portfolio phase.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True, slots=True)
class PartnerScaffoldT001Receipt:
    """Closed defaults for an unavailable, review-only synthetic fixture."""

    disposition: Literal["unavailable"] = "unavailable"
    synthetic: Literal[True] = True
    threshold_passed: Literal[False] = False
    review_state: Literal["needs_human_review"] = "needs_human_review"
    fabrication_release: Literal[False] = False
    machine_actuation: Literal[False] = False
    g2_accepted: Literal[False] = False
    g7_accepted: Literal[False] = False
    paid_partner_count: Literal[0] = 0
    completed_real_job_count: Literal[0] = 0
    recognized_revenue_usd: Literal[0] = 0


def validate_partner_scaffold_t001(receipt: PartnerScaffoldT001Receipt) -> bool:
    """Return true only for the exact zero-claim T001 fixture state."""

    return (
        receipt.disposition == "unavailable"
        and receipt.synthetic is True
        and receipt.threshold_passed is False
        and receipt.review_state == "needs_human_review"
        and receipt.fabrication_release is False
        and receipt.machine_actuation is False
        and receipt.g2_accepted is False
        and receipt.g7_accepted is False
        and type(receipt.paid_partner_count) is int
        and receipt.paid_partner_count == 0
        and type(receipt.completed_real_job_count) is int
        and receipt.completed_real_job_count == 0
        and type(receipt.recognized_revenue_usd) is int
        and receipt.recognized_revenue_usd == 0
    )
