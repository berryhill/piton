"""Fail-closed T002 partner-alpha scaffold.

This module records only the absence of partner/commercial evidence.  It does
not satisfy an external threshold, accept G2/G7, authorize a successor, or
change Piton's review, fabrication-release, or machine-actuation state.
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

_LOCKED_FIELDS: Final = (
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
        for name, expected_type, expected_value in _LOCKED_FIELDS
    )
