"""Powerless framework contract for admitting one packet to human review.

Intake records identify review work only. They cannot express a disposition,
approval, export, fabrication release, or machine action.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Sequence

from .worker_contracts import canonical_json_bytes

_DIGEST = re.compile(r"^sha256:[0-9a-f]{64}$")
_REVISION = re.compile(r"^rev_[0-9a-f]{64}$")


class HumanReviewIntakeError(RuntimeError):
    """Review intake does not match daemon-custodied evidence and packet identity."""


class FrameworkPacketClosureError(RuntimeError):
    """Framework closure does not match custodied evidence and packet bytes."""


def _identifier(name: str, value: str) -> None:
    if not isinstance(value, str) or not value or len(value) > 256:
        raise ValueError(f"{name} must be a bounded non-empty string")


def _digest(name: str, value: str) -> None:
    if not isinstance(value, str) or _DIGEST.fullmatch(value) is None:
        raise ValueError(f"{name} must be a sha256:<64 lowercase hex> digest")


def _review_text(name: str, value: Sequence[str]) -> tuple[str, ...]:
    if isinstance(value, (str, bytes)):
        raise ValueError(f"{name} must be a sequence of review statements")
    copied = tuple(value)
    if len(copied) > 16 or any(
        not isinstance(item, str) or not item.strip() or len(item) > 512
        for item in copied
    ):
        raise ValueError(f"{name} must contain bounded non-empty review statements")
    return copied


@dataclass(frozen=True, slots=True)
class HumanReviewIntake:
    """Immutable identity binding for framework-only human-review work."""

    intake_id: str
    project_id: str
    revision_id: str
    attempt_id: str
    evidence_closure_digest: str
    review_packet_digest: str
    review_scope: tuple[str, ...] = ()
    questions: tuple[str, ...] = ()
    review_state: str = "needs_human_review"
    fabrication_release: bool = False
    machine_actuation: bool = False

    def __post_init__(self) -> None:
        for name in ("intake_id", "project_id", "attempt_id"):
            _identifier(name, getattr(self, name))
        if not isinstance(self.revision_id, str) or _REVISION.fullmatch(self.revision_id) is None:
            raise ValueError("revision_id must be a rev_<64 lowercase hex> identity")
        _digest("evidence_closure_digest", self.evidence_closure_digest)
        _digest("review_packet_digest", self.review_packet_digest)
        scope = _review_text("review_scope", self.review_scope)
        questions = _review_text("questions", self.questions)
        if not scope and not questions:
            raise ValueError("review_scope or questions must not be empty")
        if (
            self.review_state != "needs_human_review"
            or self.fabrication_release is not False
            or self.machine_actuation is not False
        ):
            raise ValueError("human-review intake violates the root truth boundary")
        object.__setattr__(self, "review_scope", scope)
        object.__setattr__(self, "questions", questions)

    def to_primitive(self) -> dict[str, Any]:
        return {
            "schema": "piton.human-review-intake.v1",
            "intake_id": self.intake_id,
            "project_id": self.project_id,
            "revision_id": self.revision_id,
            "attempt_id": self.attempt_id,
            "evidence_closure_digest": self.evidence_closure_digest,
            "review_packet_digest": self.review_packet_digest,
            "review_scope": list(self.review_scope),
            "questions": list(self.questions),
            "review_state": self.review_state,
            "fabrication_release": self.fabrication_release,
            "machine_actuation": self.machine_actuation,
        }

    @property
    def canonical_bytes(self) -> bytes:
        return canonical_json_bytes(self.to_primitive())


@dataclass(frozen=True, slots=True)
class FrameworkPacketClosure:
    """Powerless confirmation that one exact packet still needs human review."""

    closure_id: str
    project_id: str
    revision_id: str
    attempt_id: str
    evidence_closure_digest: str
    review_packet_digest: str
    worker_result_digest: str
    declaration_digest: str
    generation: int
    fence: int
    lease_id: str
    exact_brep_digest: str
    step_digest: str
    review_glb_digest: str
    review_selection_map_digest: str
    review_state: str = "needs_human_review"
    fabrication_release: bool = False
    machine_actuation: bool = False
    release_state: str = "unreleased"
    channel_transition: bool = False

    def __post_init__(self) -> None:
        for name in ("closure_id", "project_id", "attempt_id", "lease_id"):
            _identifier(name, getattr(self, name))
        if not isinstance(self.revision_id, str) or _REVISION.fullmatch(self.revision_id) is None:
            raise ValueError("revision_id must be a rev_<64 lowercase hex> identity")
        for name in (
            "evidence_closure_digest",
            "review_packet_digest",
            "worker_result_digest",
            "declaration_digest",
            "exact_brep_digest",
            "step_digest",
            "review_glb_digest",
            "review_selection_map_digest",
        ):
            _digest(name, getattr(self, name))
        if type(self.generation) is not int or self.generation < 0:
            raise ValueError("generation must be a non-negative integer")
        if type(self.fence) is not int or self.fence < 0:
            raise ValueError("fence must be a non-negative integer")
        if (
            self.review_state != "needs_human_review"
            or self.fabrication_release is not False
            or self.machine_actuation is not False
            or self.release_state != "unreleased"
            or self.channel_transition is not False
        ):
            raise ValueError("framework-packet closure violates the root truth boundary")

    def to_primitive(self) -> dict[str, Any]:
        return {
            "schema": "piton.framework-packet-closure.v1",
            "closure_id": self.closure_id,
            "project_id": self.project_id,
            "revision_id": self.revision_id,
            "attempt_id": self.attempt_id,
            "evidence_closure_digest": self.evidence_closure_digest,
            "review_packet_digest": self.review_packet_digest,
            "worker_result_digest": self.worker_result_digest,
            "declaration_digest": self.declaration_digest,
            "generation": self.generation,
            "fence": self.fence,
            "lease_id": self.lease_id,
            "exact_brep_digest": self.exact_brep_digest,
            "step_digest": self.step_digest,
            "review_glb_digest": self.review_glb_digest,
            "review_selection_map_digest": self.review_selection_map_digest,
            "review_state": self.review_state,
            "fabrication_release": self.fabrication_release,
            "machine_actuation": self.machine_actuation,
            "release_state": self.release_state,
            "channel_transition": self.channel_transition,
        }

    @property
    def canonical_bytes(self) -> bytes:
        return canonical_json_bytes(self.to_primitive())
