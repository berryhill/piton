"""Fail-closed admission for Piton's bounded Stage 1 engineering effects.

Authenticated principal context, grants, policies, and the current revision are
server-owned inputs. The request is only an untrusted description of one exact
read or proposal effect; it cannot carry review, approval, release, or machine
actuation authority.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from types import MappingProxyType
from typing import Any, Mapping, Tuple

from .model import _immutable_string_tuple, _require_digest, _require_identifier, _require_revision_id


class Effect(StrEnum):
    """The complete set of effects admissible by the Stage 1 autonomy gate."""

    READ = "read"
    PROPOSE = "propose"


_CAPABILITY_EFFECT = MappingProxyType(
    {
        "part.inspect": Effect.READ,
        "parameter.propose": Effect.PROPOSE,
    }
)
_REQUEST_FIELDS = frozenset(
    {
        "request_id",
        "project_id",
        "resource_id",
        "effect",
        "capability",
        "base_revision_id",
        "policy_digest",
        "budget_units",
    }
)


def _effect(value: Effect | str) -> Effect:
    try:
        return Effect(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("unsupported engineering effect") from exc


def _positive_budget(name: str, value: int) -> None:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise ValueError(f"{name} must be a positive integer")


def _aware_datetime(name: str, value: datetime) -> None:
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{name} must be a timezone-aware datetime")


def _effects(name: str, values: Tuple[Effect, ...]) -> Tuple[Effect, ...]:
    copied = tuple(_effect(value) for value in values)
    if not copied:
        raise ValueError(f"{name} requires at least one effect")
    if len(set(copied)) != len(copied):
        raise ValueError(f"{name} must not contain duplicates")
    return copied


def _capabilities(name: str, values: Tuple[str, ...]) -> Tuple[str, ...]:
    copied = _immutable_string_tuple(name, values, required=True)
    for capability in copied:
        _require_identifier("capability", capability)
        if capability not in _CAPABILITY_EFFECT:
            raise ValueError("unsupported Stage 1 capability")
    if len(set(copied)) != len(copied):
        raise ValueError(f"{name} must not contain duplicates")
    return copied


@dataclass(frozen=True, slots=True)
class PrincipalContext:
    """Identity supplied by trusted authentication middleware, never request JSON."""

    principal_id: str

    def __post_init__(self) -> None:
        _require_identifier("principal_id", self.principal_id)


@dataclass(frozen=True, slots=True)
class AdmissionPolicy:
    """Server-owned policy snapshot used for one deterministic decision."""

    policy_digest: str
    allowed_effects: Tuple[Effect, ...]
    allowed_capabilities: Tuple[str, ...]
    max_budget_units: int

    def __post_init__(self) -> None:
        _require_digest("policy_digest", self.policy_digest)
        object.__setattr__(self, "allowed_effects", _effects("allowed_effects", self.allowed_effects))
        object.__setattr__(
            self,
            "allowed_capabilities",
            _capabilities("allowed_capabilities", self.allowed_capabilities),
        )
        _positive_budget("max_budget_units", self.max_budget_units)


@dataclass(frozen=True, slots=True)
class AutonomyGrant:
    """Short-lived, principal-bound authority stored outside request content."""

    grant_id: str
    principal_id: str
    project_id: str
    resource_ids: Tuple[str, ...]
    allowed_effects: Tuple[Effect, ...]
    allowed_capabilities: Tuple[str, ...]
    policy_digest: str
    base_revision_id: str
    expires_at: datetime
    budget_units: int

    def __post_init__(self) -> None:
        for name in ("grant_id", "principal_id", "project_id"):
            _require_identifier(name, getattr(self, name))
        resources = _immutable_string_tuple("resource_ids", self.resource_ids, required=True)
        for resource_id in resources:
            _require_identifier("resource_id", resource_id)
        if len(set(resources)) != len(resources):
            raise ValueError("resource_ids must not contain duplicates")
        object.__setattr__(self, "resource_ids", resources)
        object.__setattr__(self, "allowed_effects", _effects("allowed_effects", self.allowed_effects))
        object.__setattr__(
            self,
            "allowed_capabilities",
            _capabilities("allowed_capabilities", self.allowed_capabilities),
        )
        _require_digest("policy_digest", self.policy_digest)
        _require_revision_id("base_revision_id", self.base_revision_id)
        _aware_datetime("expires_at", self.expires_at)
        _positive_budget("budget_units", self.budget_units)


@dataclass(frozen=True, slots=True)
class EngineeringRequest:
    """Untrusted request for one bounded effect against one immutable base."""

    request_id: str
    project_id: str
    resource_id: str
    effect: Effect
    capability: str
    base_revision_id: str
    policy_digest: str
    budget_units: int

    def __post_init__(self) -> None:
        for name in ("request_id", "project_id", "resource_id", "capability"):
            _require_identifier(name, getattr(self, name))
        object.__setattr__(self, "effect", _effect(self.effect))
        if self.capability not in _CAPABILITY_EFFECT:
            raise ValueError("unsupported Stage 1 capability")
        _require_revision_id("base_revision_id", self.base_revision_id)
        _require_digest("policy_digest", self.policy_digest)
        _positive_budget("budget_units", self.budget_units)

    @classmethod
    def from_untrusted(cls, content: Mapping[str, Any]) -> "EngineeringRequest":
        """Parse only the closed request schema; authority-shaped extras fail closed."""
        if not isinstance(content, Mapping):
            raise ValueError("request content must be a mapping")
        fields = set(content)
        if fields != _REQUEST_FIELDS:
            extras = sorted(str(field) for field in fields - _REQUEST_FIELDS)
            missing = sorted(_REQUEST_FIELDS - fields)
            detail = ", ".join((*extras, *(f"missing:{name}" for name in missing)))
            raise ValueError(f"unsupported request fields: {detail}")
        return cls(**{name: content[name] for name in _REQUEST_FIELDS})

    def canonical_digest(self) -> str:
        """Bind the idempotency identity to deterministic request content."""
        content = {
            "base_revision_id": self.base_revision_id,
            "budget_units": self.budget_units,
            "capability": self.capability,
            "effect": self.effect.value,
            "policy_digest": self.policy_digest,
            "project_id": self.project_id,
            "request_id": self.request_id,
            "resource_id": self.resource_id,
        }
        canonical = json.dumps(
            content,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
            allow_nan=False,
        ).encode("utf-8")
        return "sha256:" + hashlib.sha256(canonical).hexdigest()


@dataclass(frozen=True, slots=True)
class AdmissionDecision:
    """An admission receipt only; never review, approval, export, or release state."""

    request_id: str
    admitted: bool
    reasons: Tuple[str, ...]
    grant_id: str
    principal_id: str
    policy_digest: str
    request_digest: str


def admit_engineering_request(
    *,
    request: EngineeringRequest,
    principal: PrincipalContext,
    grant: AutonomyGrant,
    policy: AdmissionPolicy,
    current_revision_id: str,
    now: datetime,
    stored_decision: AdmissionDecision | None = None,
) -> AdmissionDecision:
    """Admit server-owned READ/PROPOSE engineering context only.

    ``stored_decision`` is an optional server-owned idempotency receipt. An
    exact canonical replay returns that receipt; reuse of the request identity
    with different content or trusted context fails closed. This function does
    not persist receipts or consume cumulative budget.
    """
    _require_revision_id("current_revision_id", current_revision_id)
    _aware_datetime("now", now)
    request_digest = request.canonical_digest()

    if stored_decision is not None:
        if not isinstance(stored_decision, AdmissionDecision):
            raise ValueError("stored_decision must be an AdmissionDecision")
        if stored_decision.request_id != request.request_id:
            raise ValueError("stored decision must match request identity")
        context_matches = (
            stored_decision.principal_id == principal.principal_id
            and stored_decision.grant_id == grant.grant_id
            and stored_decision.policy_digest == policy.policy_digest
        )
        if stored_decision.request_digest == request_digest and context_matches:
            return stored_decision
        reason = (
            "request ID was reused with different content"
            if stored_decision.request_digest != request_digest
            else "stored decision does not match server-owned admission context"
        )
        return AdmissionDecision(
            request_id=request.request_id,
            admitted=False,
            reasons=(reason,),
            grant_id=grant.grant_id,
            principal_id=principal.principal_id,
            policy_digest=policy.policy_digest,
            request_digest=request_digest,
        )

    reasons: list[str] = []

    if principal.principal_id != grant.principal_id:
        reasons.append("authenticated principal does not hold grant")
    if request.project_id != grant.project_id:
        reasons.append("project scope does not match grant")
    if request.resource_id not in grant.resource_ids:
        reasons.append("resource scope does not match grant")

    expected_effect = _CAPABILITY_EFFECT[request.capability]
    if (
        request.effect is not expected_effect
        or request.effect not in grant.allowed_effects
        or request.effect not in policy.allowed_effects
        or request.capability not in grant.allowed_capabilities
        or request.capability not in policy.allowed_capabilities
    ):
        reasons.append("effect capability pair is not allowed")

    if request.policy_digest != grant.policy_digest or request.policy_digest != policy.policy_digest:
        reasons.append("policy digest does not match server-owned grant and policy")
    if now >= grant.expires_at:
        reasons.append("grant is expired")
    if request.budget_units > grant.budget_units:
        reasons.append("request exceeds grant budget")
    if request.budget_units > policy.max_budget_units:
        reasons.append("request exceeds policy budget")
    if request.base_revision_id != grant.base_revision_id:
        reasons.append("request revision does not match grant base revision")
    if request.base_revision_id != current_revision_id:
        reasons.append("request revision is not the exact current revision")

    return AdmissionDecision(
        request_id=request.request_id,
        admitted=not reasons,
        reasons=tuple(reasons),
        grant_id=grant.grant_id,
        principal_id=principal.principal_id,
        policy_digest=policy.policy_digest,
        request_digest=request_digest,
    )
