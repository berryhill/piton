"""Deterministic contracts for the fixed Stage 1 evidence checks."""

from __future__ import annotations

from dataclasses import FrozenInstanceError, replace

import pytest

from piton.evidence import (
    PREDECLARED_CHECKS,
    CheckReceipt,
    EvidenceCheckDeclaration,
    canonical_digest,
)

DIGEST = "sha256:" + "1" * 64
REVISION_ID = "rev_" + "2" * 64


def declaration() -> EvidenceCheckDeclaration:
    return EvidenceCheckDeclaration.for_attempt(
        project_id="project_one",
        revision_id=REVISION_ID,
        attempt_id="attempt_one",
        expected_outputs_digest=DIGEST,
    )


def receipt(**changes) -> CheckReceipt:
    base = CheckReceipt(
        check_id=PREDECLARED_CHECKS[0].check_id,
        declaration_digest=declaration().declaration_digest,
        revision_id=REVISION_ID,
        attempt_id="attempt_one",
        worker_result_digest=DIGEST,
        toolchain_digest=DIGEST,
        environment_digest=DIGEST,
        checker_digest=PREDECLARED_CHECKS[0].checker_digest,
        comparator_digest=PREDECLARED_CHECKS[0].comparator_digest,
        checker_command="piton.evidence:EvidenceRepository.execute_checks",
        checker_version="piton.check-receipt.v1",
        method=PREDECLARED_CHECKS[0].method,
        units=PREDECLARED_CHECKS[0].units,
        tolerance=PREDECLARED_CHECKS[0].tolerance,
        evidence_inputs={role: DIGEST for role in PREDECLARED_CHECKS[0].evidence_roles},
        status="pass",
        measured={"closed": "true"},
        warnings=(),
        uncertainty="none",
        invalidation_conditions=PREDECLARED_CHECKS[0].invalidation_conditions,
        claim_scope=PREDECLARED_CHECKS[0].claim_scope,
    )
    return replace(base, **changes)


def test_exactly_three_fixed_checks_are_fully_predeclared_before_execution() -> None:
    declared = declaration()

    assert len(PREDECLARED_CHECKS) == 3
    assert len({item.check_id for item in PREDECLARED_CHECKS}) == 3
    assert tuple(item.check_id for item in declared.checks) == tuple(
        item.check_id for item in PREDECLARED_CHECKS
    )
    for check in declared.checks:
        assert check.checker_digest.startswith("sha256:")
        assert check.comparator_digest.startswith("sha256:")
        assert check.method and check.units
        assert check.evidence_roles and check.invalidation_conditions
    with pytest.raises(TypeError):
        EvidenceCheckDeclaration.for_attempt(
            project_id="project_one",
            revision_id=REVISION_ID,
            attempt_id="attempt_one",
            expected_outputs_digest=DIGEST,
            checks=PREDECLARED_CHECKS,
        )


def test_receipt_identity_is_canonical_deterministic_and_complete() -> None:
    first = receipt()
    second = receipt(
        evidence_inputs=dict(reversed(tuple(first.evidence_inputs.items())))
    )

    assert first.canonical_bytes == second.canonical_bytes
    assert first.receipt_digest == second.receipt_digest
    assert canonical_digest(first.to_primitive()) == first.receipt_digest

    identity_fields = {
        "revision_id": "rev_" + "3" * 64,
        "attempt_id": "attempt_two",
        "worker_result_digest": "sha256:" + "4" * 64,
        "toolchain_digest": "sha256:" + "9" * 64,
        "environment_digest": "sha256:" + "a" * 64,
        "checker_digest": "sha256:" + "5" * 64,
        "comparator_digest": "sha256:" + "6" * 64,
        "checker_command": "other.command",
        "checker_version": "v2",
        "method": "other-method",
        "units": "count",
        "tolerance": "0",
        "status": "fail",
        "warnings": ("bounded warning",),
        "uncertainty": "bounded",
        "invalidation_conditions": ("any binding changes",),
        "claim_scope": "review-only",
    }
    for name, value in identity_fields.items():
        assert replace(first, **{name: value}).receipt_digest != first.receipt_digest

    with pytest.raises(FrozenInstanceError):
        first.status = "fail"  # type: ignore[misc]


def test_receipt_rejects_unbound_or_indeterminate_results() -> None:
    with pytest.raises(ValueError, match="declared evidence roles"):
        receipt(evidence_inputs={})
    with pytest.raises(ValueError, match="status"):
        receipt(status="indeterminate")
    with pytest.raises(ValueError, match="warnings"):
        receipt(warnings=tuple("warning" for _ in range(17)))
