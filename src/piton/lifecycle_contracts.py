"""Immutable, fail-closed lifecycle contracts for durable Piton concepts.

The Piton MVI doctrine (sections 10.5 and 10.6) defines ten durable lifecycle
concepts. Three of them (``ApprovalRecord``, ``FabricationRelease``, and
``ReleasedPackageProjection``) lack a Python contract in the source-native
authority. This module declares them as frozen, fail-closed dataclasses that
pin root truth (``review_state='needs_human_review'``,
``fabrication_release=False``, ``machine_actuation=False``) at construction.

None of these records can be used to mint engineering approval, fabrication
release, or machine actuation under Stage 1. The contract is admitted so that
the closed application-service boundary has a typed target for
``sign_approval``, ``reject_fabrication_release``, and
``record_released_package_projection``; the issuance facts are hard-pinned to
``False`` and any attempt to set them to ``True`` raises ``ValueError``.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .storage.revisions import ChannelPointer


_SCOPED_DECISION_PATTERN = re.compile(r"^[a-z][a-z0-9_]{0,63}$")


def _require_scoped_decision(name: str, value: str) -> None:
    if not isinstance(value, str) or not _SCOPED_DECISION_PATTERN.fullmatch(value):
        raise ValueError(f"{name} must be a lowercase scoped decision identifier")


def _require_timestamp(name: str, value: str) -> None:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} must be a non-empty timestamp string")


def _require_units(value: str) -> None:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("units must be a non-empty string")


@dataclass(frozen=True)
class ApprovalRecord:
    """Immutable Stage 1 framework receipt for an engineering approval.

    ``issues_engineering_approval`` is hard-pinned to ``False`` under Stage 1.
    Construction with ``fabrication_release=True`` or ``machine_actuation=True``
    raises ``ValueError``; the receipt admits its identity but never mints
    authority. The service-layer handler ``sign_approval`` admits this bound
    shape and always returns ``outcome='rejected'``.
    """

    receipt_id: str
    revision_id: str
    evidence_closure_id: str
    scoped_decision: str
    scope_reason: str
    declared_at: str
    review_state: str = "needs_human_review"
    fabrication_release: bool = False
    machine_actuation: bool = False

    def __post_init__(self) -> None:
        # Local imports avoid importing the bottom of the package at module
        # load time; the helpers themselves have no side effects.
        from .model import _require_identifier, _require_reason, _require_revision_id

        _require_identifier("receipt_id", self.receipt_id)
        _require_revision_id("revision_id", self.revision_id)
        _require_identifier("evidence_closure_id", self.evidence_closure_id)
        _require_scoped_decision("scoped_decision", self.scoped_decision)
        _require_reason(self.scope_reason)
        _require_timestamp("declared_at", self.declared_at)
        self.assert_safe()

    def assert_safe(self) -> None:
        if self.review_state != "needs_human_review":
            raise ValueError(
                "approval record review_state must remain needs_human_review"
            )
        if self.fabrication_release is not False:
            raise ValueError("approval record cannot issue fabrication release")
        if self.machine_actuation is not False:
            raise ValueError("approval record cannot authorize machine actuation")

    @property
    def issues_engineering_approval(self) -> bool:
        return False

    @property
    def issues_fabrication_release(self) -> bool:
        return False

    @property
    def moves_channel(self) -> bool:
        return False


@dataclass(frozen=True)
class FabricationRelease:
    """Immutable Stage 1 framework receipt for a separate fabrication release.

    The contract is admitted so the closed application-service boundary has a
    typed target for ``reject_fabrication_release``. The issuance facts
    ``fabrication_release`` and ``machine_actuation`` are hard-pinned to
    ``False``; any attempt to set them to ``True`` raises ``ValueError``.
    """

    release_id: str
    approval_receipt_id: str
    revision_id: str
    deliverables_digest: str
    declared_at: str
    review_state: str = "needs_human_review"
    fabrication_release: bool = False
    machine_actuation: bool = False

    def __post_init__(self) -> None:
        from .model import _require_digest, _require_identifier, _require_revision_id

        _require_identifier("release_id", self.release_id)
        _require_identifier("approval_receipt_id", self.approval_receipt_id)
        _require_revision_id("revision_id", self.revision_id)
        _require_digest("deliverables_digest", self.deliverables_digest)
        _require_timestamp("declared_at", self.declared_at)
        self.assert_safe()

    def assert_safe(self) -> None:
        if self.review_state != "needs_human_review":
            raise ValueError(
                "fabrication release review_state must remain needs_human_review"
            )
        if self.fabrication_release is not False:
            raise ValueError("Stage 1 cannot issue fabrication release")
        if self.machine_actuation is not False:
            raise ValueError("Stage 1 cannot authorize machine actuation")

    @property
    def issues_engineering_approval(self) -> bool:
        return False

    @property
    def issues_fabrication_release(self) -> bool:
        return False

    @property
    def moves_channel(self) -> bool:
        return False


@dataclass(frozen=True)
class ReleasedPackageProjection:
    """Immutable Stage 1 framework receipt for a readback-only package projection.

    The contract is admitted so the closed application-service boundary has a
    typed target for ``record_released_package_projection``. This receipt is
    readback-only; it never carries release authority and the issuance facts
    are hard-pinned to ``False``.
    """

    projection_id: str
    release_id: str
    package_digest: str
    units: str
    declared_at: str
    review_state: str = "needs_human_review"
    fabrication_release: bool = False
    machine_actuation: bool = False

    def __post_init__(self) -> None:
        from .model import _require_digest, _require_identifier

        _require_identifier("projection_id", self.projection_id)
        _require_identifier("release_id", self.release_id)
        _require_digest("package_digest", self.package_digest)
        _require_units(self.units)
        _require_timestamp("declared_at", self.declared_at)
        self.assert_safe()

    def assert_safe(self) -> None:
        if self.review_state != "needs_human_review":
            raise ValueError(
                "released package projection review_state must remain needs_human_review"
            )
        if self.fabrication_release is not False:
            raise ValueError(
                "released package projection cannot issue fabrication release"
            )
        if self.machine_actuation is not False:
            raise ValueError(
                "released package projection cannot authorize machine actuation"
            )

    @property
    def issues_engineering_approval(self) -> bool:
        return False

    @property
    def issues_fabrication_release(self) -> bool:
        return False

    @property
    def moves_channel(self) -> bool:
        return False


@dataclass(frozen=True)
class HardenedChannelPointer:
    """Daemon-custodied channel pointer augmented with root-truth pins.

    The plain ``ChannelPointer`` from ``storage.revisions`` describes the
    pointer identity. This wrapper pins ``review_state='needs_human_review'``,
    ``fabrication_release=False``, and ``machine_actuation=False`` so the
    closed boundary cannot move a channel under any authority flag.
    """

    pointer: "ChannelPointer"
    review_state: str = "needs_human_review"
    fabrication_release: bool = False
    machine_actuation: bool = False

    def __post_init__(self) -> None:
        from .storage.revisions import ChannelPointer

        if not isinstance(self.pointer, ChannelPointer):
            raise TypeError("pointer must be a ChannelPointer")
        self.assert_safe()

    def assert_safe(self) -> None:
        if self.review_state != "needs_human_review":
            raise ValueError(
                "channel pointer review_state must remain needs_human_review"
            )
        if self.fabrication_release is not False:
            raise ValueError("channel pointer cannot carry fabrication release")
        if self.machine_actuation is not False:
            raise ValueError("channel pointer cannot authorize machine actuation")

    @property
    def issues_engineering_approval(self) -> bool:
        return False

    @property
    def issues_fabrication_release(self) -> bool:
        return False

    @property
    def moves_channel(self) -> bool:
        return True
