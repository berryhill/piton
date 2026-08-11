"""Acceptance contract for P3 governed evidence and frozen P4 policy."""
from __future__ import annotations

from dataclasses import FrozenInstanceError, replace
import json
from importlib.resources import files

import pytest
from jsonschema import Draft202012Validator, ValidationError

import piton.assurance as assurance_module
from piton.assurance import (
    AssuranceRequirement,
    DEFAULT_P4_ASSURANCE_POLICY,
    GovernedAlphaEvidence,
    P4AssuranceEvidence,
    P4AssurancePolicy,
    P4AssuranceReceipt,
    emit_unavailable_p4_receipts,
    validate_p4_evidence_policy_binding,
)
from piton.portfolio import (
    Authority,
    Disposition,
    EvidenceArtifact,
    ExecutionStatus,
    Phase,
    SafetyState,
    issue_phase_exit_receipt,
    receipt_digest,
    verify_successor_admission,
)

DIGEST = "sha256:" + "1" * 64
OTHER_DIGEST = "sha256:" + "2" * 64
REVISION_ID = "rev_" + "3" * 64


def governed_alpha() -> GovernedAlphaEvidence:
    return GovernedAlphaEvidence(
        project_id="project-one",
        revision_id=REVISION_ID,
        build_attempt_id="attempt-one",
        evidence_closure_digest=DIGEST,
        framework_packet_closure_digest=DIGEST,
        review_packet_digest=DIGEST,
        exact_brep_digest=DIGEST,
        exact_brep_claim_scope="exact-realization",
        step_digest=DIGEST,
        step_claim_scope="exact-exchange",
        review_glb_digest=DIGEST,
        review_glb_claim_scope="review-only",
        review_selection_map_digest=DIGEST,
        review_selection_map_claim_scope="review-only",
        review_state="needs_human_review",
        fabrication_release=False,
        machine_actuation=False,
        release_state="unreleased",
        channel_transition=False,
    )


def requirement(identifier: str = "wcag-named-matrix") -> AssuranceRequirement:
    return AssuranceRequirement(
        requirement_id=identifier,
        category="accessibility",
        method_digest=DIGEST,
        comparator_digest=DIGEST,
        threshold={"serious_or_critical_maximum": 0},
        environment_ids=("firefox-windows-nvda",),
        invalidation_conditions=("browser, OS, or assistive-technology version changes",),
    )


def policy() -> P4AssurancePolicy:
    return P4AssurancePolicy(
        policy_id="p4-assurance-alpha-v1",
        requirements=(
            requirement(),
            replace(requirement("fault-concurrency"), category="reliability"),
            replace(requirement("supported-platform"), category="platform"),
        ),
        supported_environment_ids=("firefox-windows-nvda", "trusted-local-offline"),
    )


def p2_receipt():
    predecessor = issue_phase_exit_receipt(
        receipt_id="p1",
        phase=Phase.P1,
        status=ExecutionStatus.COMPLETED,
        disposition=Disposition.ADVANCE,
        authority=Authority.AUTONOMOUS,
        predecessor_receipt_id="p0",
        predecessor_receipt_digest=DIGEST,
        predicates={"exact_cad_verified": True},
        evidence=(EvidenceArtifact.from_content(artifact_id="p1", repository_path="evidence/p1.json", content={"result": "verified"}),),
        safety=SafetyState(),
    )
    # Exact predecessor claim is enough for issue-time P2 authorization; successor
    # verification separately requires the actual predecessor receipt.
    return issue_phase_exit_receipt(
        receipt_id="p2",
        phase=Phase.P2,
        status=ExecutionStatus.COMPLETED,
        disposition=Disposition.ADVANCE,
        authority=Authority.AUTONOMOUS,
        predecessor_receipt_id=predecessor.receipt_id,
        predecessor_receipt_digest=receipt_digest(predecessor),
        predicates={"local_custody_verified": True, "immutable_revision_verified": True},
        evidence=(EvidenceArtifact.from_content(artifact_id="p2", repository_path="evidence/p2.json", content={"result": "verified"}),),
        safety=SafetyState(),
    )


def test_p3_requires_closed_governed_alpha_evidence_and_exact_p2() -> None:
    p2 = p2_receipt()
    artifact = EvidenceArtifact.from_content(
        artifact_id="governed-alpha",
        repository_path="evidence/alpha/p3-governed-alpha.json",
        content=governed_alpha().to_primitive(),
    )
    p3 = issue_phase_exit_receipt(
        receipt_id="p3",
        phase=Phase.P3,
        status=ExecutionStatus.COMPLETED,
        disposition=Disposition.ADVANCE,
        authority=Authority.HUMAN,
        predecessor_receipt_id=p2.receipt_id,
        predecessor_receipt_digest=receipt_digest(p2),
        predicates={},
        evidence=(artifact,),
        safety=SafetyState(),
    )
    assert p3.successor_authorized is False
    assert "trusted durable human authorization" in " ".join(p3.authorization_reasons)
    assert verify_successor_admission(
        p3, successor=Phase.P4, predecessor=p2
    ).admitted is False

    generic = replace(artifact, content={"result": "measured"})
    denied = replace(p3, evidence=(generic,), successor_authorized=True, authorization_reasons=())
    decision = verify_successor_admission(denied, successor=Phase.P4, predecessor=p2)
    assert decision.admitted is False
    assert "governed-alpha" in " ".join(decision.reasons)


@pytest.mark.parametrize(
    ("field", "value"),
    (
        ("exact_brep_claim_scope", "review-only"),
        ("step_claim_scope", "review-only"),
        ("review_glb_claim_scope", "exact-realization"),
        ("review_selection_map_claim_scope", "exact-realization"),
        ("review_state", "accepted"),
        ("fabrication_release", True),
        ("machine_actuation", True),
        ("release_state", "released"),
        ("channel_transition", True),
    ),
)
def test_governed_alpha_rejects_scope_and_consequence_forgery(field: str, value: object) -> None:
    with pytest.raises(ValueError):
        replace(governed_alpha(), **{field: value})


def test_policy_is_closed_canonical_immutable_and_digest_sensitive() -> None:
    frozen = policy()
    assert json.loads(frozen.canonical_bytes) == frozen.to_primitive()
    assert frozen.digest.startswith("sha256:")
    assert frozen.digest != replace(frozen, fault_runs_minimum=1001).digest
    with pytest.raises(FrozenInstanceError):
        frozen.policy_id = "changed"  # type: ignore[misc]
    with pytest.raises(ValueError, match="duplicate"):
        replace(frozen, requirements=(requirement(), requirement()))
    with pytest.raises(ValueError, match="finite deterministic JSON"):
        replace(frozen, requirements=(replace(requirement(), threshold={"maximum": float("nan")}),))

    schema = json.loads(files("piton").joinpath("schemas", "p4-assurance-policy-v1.schema.json").read_text())
    validator = Draft202012Validator(schema)
    validator.validate(frozen.to_primitive())
    assert P4AssurancePolicy.from_primitive(frozen.to_primitive()) == frozen
    with pytest.raises(ValidationError):
        validator.validate({**frozen.to_primitive(), "approval": True})


def test_source_native_default_policy_freezes_all_assurance_dimensions() -> None:
    frozen = DEFAULT_P4_ASSURANCE_POLICY
    assert {item.category for item in frozen.requirements} == {
        "accessibility", "reliability", "platform"
    }
    assert {item.requirement_id for item in frozen.requirements} == {
        "wcag-2-2-aa-named-matrix",
        "fault-and-concurrency-readiness",
        "offline-golden-path",
        "backup-restore-readback",
        "supported-platform-matrix",
        "performance-budgets",
        "vendored-csp-license-privacy",
    }
    assert P4AssurancePolicy.from_primitive(frozen.to_primitive()).digest == frozen.digest


def test_unavailable_receipts_close_default_policy_in_order() -> None:
    receipts = emit_unavailable_p4_receipts()

    assert tuple(receipt.requirement_id for receipt in receipts) == tuple(
        requirement.requirement_id
        for requirement in DEFAULT_P4_ASSURANCE_POLICY.requirements
    )
    assert len(receipts) == len(DEFAULT_P4_ASSURANCE_POLICY.requirements)


def test_unavailable_receipt_emitter_rejects_caller_minted_policy_authority(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    caller_policy = policy()

    with pytest.raises(TypeError):
        emit_unavailable_p4_receipts(caller_policy)

    monkeypatch.setattr(assurance_module, "DEFAULT_P4_ASSURANCE_POLICY", caller_policy)
    receipts = emit_unavailable_p4_receipts()
    source_policy = assurance_module.default_p4_assurance_policy()

    assert all(
        receipt.policy_digest == source_policy.digest
        for receipt in receipts
    )
    assert tuple(receipt.requirement_id for receipt in receipts) == tuple(
        requirement.requirement_id for requirement in source_policy.requirements
    )


def test_unavailable_receipts_bind_every_requirement_field() -> None:
    receipts = emit_unavailable_p4_receipts()

    for receipt, requirement in zip(
        receipts, DEFAULT_P4_ASSURANCE_POLICY.requirements, strict=True
    ):
        assert receipt.policy_digest == DEFAULT_P4_ASSURANCE_POLICY.digest
        assert receipt.requirement_id == requirement.requirement_id
        assert receipt.method_digest == requirement.method_digest
        assert receipt.comparator_digest == requirement.comparator_digest
        assert receipt.threshold == requirement.threshold
        assert receipt.environment_ids == requirement.environment_ids
        assert receipt.invalidation_conditions == requirement.invalidation_conditions
        assert receipt.availability == "unavailable"
        assert receipt.threshold_passed is False
        assert receipt.evidence_refs == ()


def test_unavailable_receipt_is_closed_canonical_and_rejects_forgery() -> None:
    receipt = emit_unavailable_p4_receipts()[0]
    primitive = receipt.to_primitive()

    assert json.loads(receipt.canonical_bytes) == primitive
    assert P4AssuranceReceipt.from_primitive(primitive) == receipt
    assert P4AssuranceReceipt.from_primitive(primitive).digest == receipt.digest
    with pytest.raises(ValueError, match="closed schema"):
        P4AssuranceReceipt.from_primitive({**primitive, "approval": True})
    with pytest.raises(ValueError, match="fail closed"):
        replace(receipt, threshold_passed=True)
    with pytest.raises(ValueError, match="fail closed"):
        replace(receipt, evidence_refs=(DIGEST,))
    with pytest.raises(ValueError, match="fail closed"):
        replace(receipt, availability="available")


def test_unavailable_receipt_matches_packaged_public_schema() -> None:
    schema = json.loads(
        files("piton")
        .joinpath("schemas", "p4-assurance-receipt-v1.schema.json")
        .read_text(encoding="utf-8")
    )
    validator = Draft202012Validator(schema)
    primitive = emit_unavailable_p4_receipts()[0].to_primitive()

    validator.validate(primitive)
    for field, unsafe_value in (
        ("availability", "available"),
        ("threshold_passed", True),
        ("evidence_refs", [DIGEST]),
    ):
        with pytest.raises(ValidationError):
            validator.validate({**primitive, field: unsafe_value})
    with pytest.raises(ValidationError):
        validator.validate({**primitive, "approval": True})


def test_p4_evidence_binds_exact_predeclared_policy_digest() -> None:
    frozen = policy()
    evidence = P4AssuranceEvidence(
        policy_digest=frozen.digest,
        evaluated_requirement_ids=tuple(item.requirement_id for item in frozen.requirements),
        result="hold",
    )
    assert validate_p4_evidence_policy_binding(frozen, evidence) == ()
    assert "policy digest" in " ".join(
        validate_p4_evidence_policy_binding(frozen, replace(evidence, policy_digest=OTHER_DIGEST))
    )
    assert "predeclared requirements" in " ".join(
        validate_p4_evidence_policy_binding(frozen, replace(evidence, evaluated_requirement_ids=("wcag-named-matrix",)))
    )
    assert evidence.review_state == "needs_human_review"
    assert evidence.fabrication_release is False
    assert evidence.machine_actuation is False


def test_autonomous_p4_cannot_advance_even_with_policy_bound_evidence() -> None:
    frozen = policy()
    result = P4AssuranceEvidence(
        policy_digest=frozen.digest,
        evaluated_requirement_ids=tuple(item.requirement_id for item in frozen.requirements),
        result="hold",
    )
    p4 = issue_phase_exit_receipt(
        receipt_id="p4",
        phase=Phase.P4,
        status=ExecutionStatus.COMPLETED,
        disposition=Disposition.ADVANCE,
        authority=Authority.AUTONOMOUS,
        predecessor_receipt_id="p3",
        predecessor_receipt_digest=DIGEST,
        predicates={},
        evidence=(EvidenceArtifact.from_content(artifact_id="p4", repository_path="evidence/alpha/p4.json", content=result.to_primitive()),),
        safety=SafetyState(),
    )
    assert p4.successor_authorized is False
    assert "human authority" in " ".join(p4.authorization_reasons)


def test_p4_admission_rejects_caller_chosen_policy_authority() -> None:
    caller_policy = policy()
    caller_evidence = P4AssuranceEvidence(
        policy_digest=caller_policy.digest,
        evaluated_requirement_ids=tuple(
            item.requirement_id for item in caller_policy.requirements
        ),
        result="hold",
    )

    p4 = issue_phase_exit_receipt(
        receipt_id="p4-caller-policy",
        phase=Phase.P4,
        status=ExecutionStatus.COMPLETED,
        disposition=Disposition.ADVANCE,
        authority=Authority.HUMAN,
        predecessor_receipt_id="p3",
        predecessor_receipt_digest=DIGEST,
        predicates={},
        evidence=(
            EvidenceArtifact.from_content(
                artifact_id="p4-caller-policy",
                repository_path="evidence/alpha/p4-caller-policy.json",
                content=caller_evidence.to_primitive(),
            ),
        ),
        safety=SafetyState(),
    )

    assert p4.successor_authorized is False
    assert "policy digest" in " ".join(p4.authorization_reasons)
