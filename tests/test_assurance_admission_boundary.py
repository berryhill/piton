"""Regression tests for fail-closed human authority and P3/P4 review evidence."""
from __future__ import annotations

import inspect
from dataclasses import replace
from pathlib import Path

import pytest

from piton import FrameworkPacketClosure
from piton.assurance import DEFAULT_P4_ASSURANCE_POLICY, GovernedAlphaEvidence, P4AssuranceEvidence
from piton.portfolio import (
    Authority,
    Disposition,
    EvidenceArtifact,
    ExecutionStatus,
    P3ReviewEvidenceBundle,
    Phase,
    SafetyState,
    issue_phase_exit_receipt,
    receipt_digest,
    verify_successor_admission,
)
from test_framework_packet_closure import _closed

DIGEST = "sha256:" + "1" * 64
REVISION = "rev_" + "2" * 64
HUMAN_UNAVAILABLE = (
    "trusted durable human authorization issuance/verification is not implemented "
    "in this Stage-1 slice"
)


def _artifact(content: object) -> EvidenceArtifact:
    return EvidenceArtifact.from_content(
        artifact_id="regression-evidence",
        repository_path="evidence/regression.json",
        content=content,
    )


def test_every_human_phase_fails_closed_with_explicit_stage_one_reason() -> None:
    for phase in Phase:
        receipt = issue_phase_exit_receipt(
            receipt_id=f"caller-human-{phase.value.lower()}",
            phase=phase,
            status=ExecutionStatus.COMPLETED,
            disposition=Disposition.ADVANCE,
            authority=Authority.HUMAN,
            predecessor_receipt_id=None if phase is Phase.P0 else "predecessor",
            predecessor_receipt_digest=None if phase is Phase.P0 else DIGEST,
            predicates={
                name: True
                for name in (
                    ("exact_cad_verified",) if phase is Phase.P1 else
                    ("local_custody_verified", "immutable_revision_verified")
                    if phase is Phase.P2 else ()
                )
            },
            evidence=(_artifact({"result": "measured"}),),
            safety=SafetyState(),
        )
        assert receipt.successor_authorized is False
        assert HUMAN_UNAVAILABLE in receipt.authorization_reasons


def test_authority_issuance_and_verifier_objects_are_not_public_surfaces() -> None:
    import piton
    import piton.portfolio as portfolio

    assert not hasattr(piton, "HumanAuthorityVerifier")
    assert not hasattr(portfolio, "HumanAuthorityVerifier")
    for function in (issue_phase_exit_receipt, verify_successor_admission):
        parameters = inspect.signature(function).parameters
        assert "authority_verifier" not in parameters
        assert "human_authorization" not in parameters

    with pytest.raises(TypeError, match="unexpected keyword"):
        issue_phase_exit_receipt(
            receipt_id="caller-object-p0",
            phase=Phase.P0,
            status=ExecutionStatus.COMPLETED,
            disposition=Disposition.ADVANCE,
            authority=Authority.HUMAN,
            predecessor_receipt_id=None,
            predecessor_receipt_digest=None,
            predicates={},
            evidence=(_artifact({"result": "measured"}),),
            safety=SafetyState(),
            authority_verifier=object(),  # type: ignore[call-arg]
        )


def _valid_p3_evidence(tmp_path: Path):
    _, closure, packet, packet_root, framework = _closed(tmp_path)
    assert isinstance(framework, FrameworkPacketClosure)
    governed = GovernedAlphaEvidence(
        project_id=closure.project_id,
        revision_id=closure.revision_id,
        build_attempt_id=closure.attempt_id,
        evidence_closure_digest=closure.closure_digest,
        framework_packet_closure_digest=framework.closure_digest,
        review_packet_digest=packet.packet_digest,
        exact_brep_digest=packet.artifacts["exact_brep"]["digest"],
        exact_brep_claim_scope="exact-realization",
        step_digest=packet.artifacts["step"]["digest"],
        step_claim_scope="exact-exchange",
        review_glb_digest=packet.artifacts["review_glb"]["digest"],
        review_glb_claim_scope="review-only",
        review_selection_map_digest=packet.artifacts["review_selection_map"]["digest"],
        review_selection_map_claim_scope="review-only",
    )
    bundle = P3ReviewEvidenceBundle(
        project_id=closure.project_id,
        current_revision_id=closure.revision_id,
        current_attempt_id=closure.attempt_id,
        evidence_closure=closure,
        framework_packet_closure=framework,
        review_packet=packet,
        review_packet_directory=packet_root,
    )
    return _artifact(governed.to_primitive()), bundle


def test_self_consistent_caller_created_p3_bundle_is_evidence_only(tmp_path: Path) -> None:
    artifact, bundle = _valid_p3_evidence(tmp_path)
    p2 = issue_phase_exit_receipt(
        receipt_id="technical-p2",
        phase=Phase.P2,
        status=ExecutionStatus.COMPLETED,
        disposition=Disposition.ADVANCE,
        authority=Authority.AUTONOMOUS,
        predecessor_receipt_id="p1",
        predecessor_receipt_digest=DIGEST,
        predicates={"local_custody_verified": True, "immutable_revision_verified": True},
        evidence=(_artifact({"result": "verified"}),),
        safety=SafetyState(),
    )
    p3 = issue_phase_exit_receipt(
        receipt_id="caller-created-p3",
        phase=Phase.P3,
        status=ExecutionStatus.COMPLETED,
        disposition=Disposition.ADVANCE,
        authority=Authority.HUMAN,
        predecessor_receipt_id=p2.receipt_id,
        predecessor_receipt_digest=receipt_digest(p2),
        predicates={},
        evidence=(artifact,),
        safety=SafetyState(),
        p3_review_evidence=bundle,
    )

    assert p3.successor_authorized is False
    assert p3.authorization_reasons == (HUMAN_UNAVAILABLE,)
    decision = verify_successor_admission(
        p3,
        successor=Phase.P4,
        predecessor=p2,
        p3_review_evidence=bundle,
    )
    assert decision.admitted is False
    assert HUMAN_UNAVAILABLE in decision.reasons

    stale = replace(bundle, project_id="project-other")
    stale_decision = verify_successor_admission(
        p3,
        successor=Phase.P4,
        predecessor=p2,
        p3_review_evidence=stale,
    )
    assert stale_decision.admitted is False
    assert any("cross-project" in reason for reason in stale_decision.reasons)


def test_every_p4_evidence_result_blocks_successor_advancement() -> None:
    for result in ("hold", "rework", "stop", "reject"):
        evidence = P4AssuranceEvidence(
            policy_digest=DEFAULT_P4_ASSURANCE_POLICY.digest,
            evaluated_requirement_ids=tuple(
                item.requirement_id for item in DEFAULT_P4_ASSURANCE_POLICY.requirements
            ),
            result=result,
        )
        receipt = issue_phase_exit_receipt(
            receipt_id=f"p4-{result}",
            phase=Phase.P4,
            status=ExecutionStatus.COMPLETED,
            disposition=Disposition.ADVANCE,
            authority=Authority.HUMAN,
            predecessor_receipt_id="p3",
            predecessor_receipt_digest=DIGEST,
            predicates={},
            evidence=(_artifact(evidence.to_primitive()),),
            safety=SafetyState(),
        )
        assert receipt.successor_authorized is False
        assert HUMAN_UNAVAILABLE in receipt.authorization_reasons
        assert f"P4 evidence result {result}" in " ".join(receipt.authorization_reasons)
