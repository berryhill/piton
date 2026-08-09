from dataclasses import FrozenInstanceError, fields

import pytest

from piton.model import (
    ProposalDisposition,
    ProposalDispositionState,
    ReviewDispositionRecord,
    ReviewDispositionState,
)

REVISION_ID = "rev_" + "0" * 64


def test_proposal_disposition_accepts_only_doctrine_states() -> None:
    expected = {
        "submitted",
        "withdrawn",
        "rejected",
        "changes_requested",
        "accepted_for_build",
        "accepted_for_review",
    }
    assert {state.value for state in ProposalDispositionState} == expected

    for state in expected:
        record = ProposalDisposition(
            disposition_id=f"disp:{state}",
            proposal_id="proposal:1",
            base_revision_id=REVISION_ID,
            state=state,
            reason="bounded lifecycle decision",
        )
        assert record.state is ProposalDispositionState(state)
        assert record.issues_engineering_approval is False
        assert record.issues_fabrication_release is False

    for alias in ("approved", "engineering_approved", "released", "fabrication_release"):
        with pytest.raises(ValueError, match="unknown proposal disposition state"):
            ProposalDisposition("disp:1", "proposal:1", REVISION_ID, alias, "not an issuer")


def test_review_disposition_is_a_non_issuing_decision() -> None:
    assert {state.value for state in ReviewDispositionState} == {
        "changes_requested",
        "rejected",
    }
    for state in ReviewDispositionState:
        record = ReviewDispositionRecord(
            disposition_id=f"review:{state.value}",
            revision_id=REVISION_ID,
            evidence_closure_id="closure:1",
            state=state,
            reason="approval must be a separate ApprovalRecord",
        )
        assert record.issues_engineering_approval is False
        assert record.issues_fabrication_release is False

    with pytest.raises(ValueError, match="unknown review disposition state"):
        ReviewDispositionRecord(
            "review:1", REVISION_ID, "closure:1", "approved", "not an issuer"
        )


def test_dispositions_validate_identity_reason_and_revision_shape() -> None:
    with pytest.raises(ValueError, match="disposition_id"):
        ProposalDisposition("bad id", "proposal:1", REVISION_ID, "submitted", "reason")
    with pytest.raises(ValueError, match="proposal_id"):
        ProposalDisposition("disp:1", "", REVISION_ID, "submitted", "reason")
    with pytest.raises(ValueError, match="canonical revision ID"):
        ProposalDisposition("disp:1", "proposal:1", "rev_bad", "submitted", "reason")
    with pytest.raises(ValueError, match="reason"):
        ProposalDisposition("disp:1", "proposal:1", REVISION_ID, "submitted", "  ")
    with pytest.raises(ValueError, match="evidence_closure_id"):
        ReviewDispositionRecord("review:1", REVISION_ID, "bad id", "rejected", "reason")


def test_dispositions_are_immutable_and_have_no_issuing_fields() -> None:
    proposal = ProposalDisposition(
        "disp:1", "proposal:1", REVISION_ID, "accepted_for_review", "review only"
    )
    review = ReviewDispositionRecord(
        "review:1", REVISION_ID, "closure:1", "rejected", "does not approve"
    )
    with pytest.raises(FrozenInstanceError):
        proposal.reason = "changed"
    with pytest.raises(FrozenInstanceError):
        review.reason = "changed"

    forbidden = {
        "approved",
        "approval_id",
        "signature",
        "fabrication_release",
        "machine_actuation",
    }
    assert forbidden.isdisjoint(field.name for field in fields(proposal))
    assert forbidden.isdisjoint(field.name for field in fields(review))
