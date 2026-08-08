"""Portfolio phase receipts fail closed at every successor boundary."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path

from piton.portfolio import (
    Authority,
    Disposition,
    EvidenceArtifact,
    EvidenceSource,
    ExecutionStatus,
    Phase,
    SafetyState,
    issue_phase_exit_receipt,
    receipt_digest,
    verify_successor_admission,
)

DIGEST = "sha256:" + "a" * 64
ROOT = Path(__file__).resolve().parents[1]


def evidence(content: object | None = None) -> EvidenceArtifact:
    content = {"result": "measured", "samples": [1, 2]} if content is None else content
    return EvidenceArtifact.from_content(
        artifact_id="ev-1",
        repository_path="evidence/portfolio/result.json",
        content=content,
    )


def receipt(
    phase: Phase,
    *,
    predecessor=None,
    authority: Authority = Authority.AUTONOMOUS,
    disposition: Disposition = Disposition.ADVANCE,
    status: ExecutionStatus = ExecutionStatus.COMPLETED,
    predicates: dict[str, bool] | None = None,
    artifacts: tuple[EvidenceArtifact, ...] | None = None,
):
    predecessor_id = predecessor.receipt_id if predecessor else None
    predecessor_digest = receipt_digest(predecessor) if predecessor else None
    return issue_phase_exit_receipt(
        receipt_id=f"receipt-{phase.value.lower()}",
        phase=phase,
        status=status,
        disposition=disposition,
        authority=authority,
        predecessor_receipt_id=predecessor_id,
        predecessor_receipt_digest=predecessor_digest,
        predicates=predicates or {},
        evidence=artifacts if artifacts is not None else (evidence(),),
        safety=SafetyState(),
    )


class PortfolioAdmissionTests(unittest.TestCase):
    def test_execution_completion_does_not_imply_successor_authorization(self) -> None:
        exited = receipt(Phase.P0, disposition=Disposition.HOLD)
        self.assertTrue(exited.execution_complete)
        self.assertFalse(exited.successor_authorized)
        decision = verify_successor_admission(exited, successor=Phase.P1)
        self.assertFalse(decision.admitted)
        self.assertIn("disposition does not advance", decision.reasons)

    def test_cancelled_skipped_and_failed_queue_states_never_authorize(self) -> None:
        for status in (ExecutionStatus.CANCELLED, ExecutionStatus.SKIPPED, ExecutionStatus.FAILED):
            with self.subTest(status=status):
                exited = receipt(Phase.P1, status=status, predicates={"exact_cad_verified": True})
                self.assertFalse(exited.execution_complete)
                self.assertFalse(exited.successor_authorized)

    def test_autonomy_may_fail_closed_but_not_advance_judgment_phases(self) -> None:
        for phase in (Phase.P0, Phase.P3, Phase.P4, Phase.P5):
            with self.subTest(phase=phase):
                held = receipt(phase, disposition=Disposition.REWORK)
                self.assertTrue(held.execution_complete)
                self.assertFalse(held.successor_authorized)
                advanced = receipt(phase)
                self.assertFalse(advanced.successor_authorized)
                self.assertIn("human authority", advanced.authorization_reasons[0])

    def test_p1_and_p2_require_positive_technical_predicates(self) -> None:
        p0 = receipt(Phase.P0, authority=Authority.HUMAN)
        p1_missing = receipt(Phase.P1, predecessor=p0)
        self.assertFalse(p1_missing.successor_authorized)
        self.assertIn("exact_cad_verified", " ".join(p1_missing.authorization_reasons))

        p1 = receipt(Phase.P1, predecessor=p0, predicates={"exact_cad_verified": True})
        self.assertTrue(p1.successor_authorized)
        p2_missing = receipt(Phase.P2, predecessor=p1, predicates={"local_custody_verified": True})
        self.assertFalse(p2_missing.successor_authorized)
        p2 = receipt(
            Phase.P2,
            predecessor=p1,
            predicates={"local_custody_verified": True, "immutable_revision_verified": True},
        )
        self.assertTrue(p2.successor_authorized)

    def test_scaffold_note_and_placeholder_are_rejected_recursively(self) -> None:
        for content in (
            {"nested": [{"scaffold_note": "not real"}]},
            {"nested": {"result": "placeholder pending field work"}},
        ):
            with self.subTest(content=content):
                exited = receipt(
                    Phase.P1,
                    predicates={"exact_cad_verified": True},
                    artifacts=(evidence(content),),
                )
                self.assertFalse(exited.successor_authorized)
                self.assertIn("scaffold", " ".join(exited.authorization_reasons).lower())

    def test_external_evidence_normalizes_advance_to_completed_hold(self) -> None:
        predecessor = receipt(Phase.P0, authority=Authority.HUMAN)
        external = replace(
            evidence({"result": "externally measured"}),
            artifact_id="ev-external",
            source=EvidenceSource.EXTERNAL,
        )
        exited = receipt(
            Phase.P1,
            predecessor=predecessor,
            predicates={"exact_cad_verified": True},
            artifacts=(evidence(), external),
        )

        self.assertEqual(ExecutionStatus.COMPLETED, exited.status)
        self.assertTrue(exited.execution_complete)
        self.assertEqual(Disposition.HOLD, exited.disposition)
        self.assertFalse(exited.successor_authorized)
        reasons = " ".join(exited.authorization_reasons)
        self.assertIn("disposition does not advance", reasons)
        self.assertIn("not repository-native", reasons)

    def test_external_evidence_forces_requested_advance_to_hold(self) -> None:
        native = evidence()
        external = replace(
            EvidenceArtifact.from_content(
                artifact_id="ev-external",
                repository_path="evidence/portfolio/external.json",
                content={"result": "measured externally"},
            ),
            source=EvidenceSource.EXTERNAL,
        )

        exited = receipt(
            Phase.P1,
            status=ExecutionStatus.COMPLETED,
            disposition=Disposition.ADVANCE,
            predicates={"exact_cad_verified": True},
            artifacts=(native, external),
        )

        self.assertEqual(ExecutionStatus.COMPLETED, exited.status)
        self.assertTrue(exited.execution_complete)
        self.assertEqual(Disposition.HOLD, exited.disposition)
        self.assertFalse(exited.successor_authorized)
        self.assertIn("disposition does not advance", exited.authorization_reasons)
        self.assertIn(
            "evidence ev-external is not repository-native",
            exited.authorization_reasons,
        )
        self.assertEqual(exited, type(exited).from_dict(exited.to_dict()))

    def test_safety_invariants_are_enforced(self) -> None:
        unsafe_states = (
            SafetyState(fabrication_release=True),
            SafetyState(machine_actuation=True),
            SafetyState(review_state="approved"),
        )
        for safety in unsafe_states:
            with self.subTest(safety=safety):
                with self.assertRaisesRegex(ValueError, "safety invariant"):
                    issue_phase_exit_receipt(
                        receipt_id="unsafe",
                        phase=Phase.P1,
                        status=ExecutionStatus.COMPLETED,
                        disposition=Disposition.ADVANCE,
                        authority=Authority.AUTONOMOUS,
                        predecessor_receipt_id=None,
                        predecessor_receipt_digest=None,
                        predicates={"exact_cad_verified": True},
                        evidence=(evidence(),),
                        safety=safety,
                    )

    def test_exact_predecessor_id_and_digest_are_required(self) -> None:
        p0 = receipt(Phase.P0, authority=Authority.HUMAN)
        p1 = receipt(Phase.P1, predecessor=p0, predicates={"exact_cad_verified": True})
        good = verify_successor_admission(p1, successor=Phase.P2, predecessor=p0)
        self.assertTrue(good.admitted)

        wrong_id = replace(p1, predecessor_receipt_id="other")
        self.assertFalse(verify_successor_admission(wrong_id, successor=Phase.P2, predecessor=p0).admitted)
        wrong_digest = replace(p1, predecessor_receipt_digest=DIGEST)
        self.assertFalse(
            verify_successor_admission(wrong_digest, successor=Phase.P2, predecessor=p0).admitted
        )
        self.assertFalse(verify_successor_admission(p1, successor=Phase.P2).admitted)

    def test_evidence_digest_is_content_bound(self) -> None:
        tampered = replace(evidence(), content={"result": "changed"})
        exited = receipt(
            Phase.P1,
            predicates={"exact_cad_verified": True},
            artifacts=(tampered,),
        )
        self.assertFalse(exited.successor_authorized)
        self.assertIn("digest", " ".join(exited.authorization_reasons))

    def test_forged_predecessor_authorization_claim_is_rejected(self) -> None:
        denied_p0 = receipt(Phase.P0)  # Autonomous P0 cannot advance.
        forged_p0 = replace(denied_p0, successor_authorized=True, authorization_reasons=())
        p1 = receipt(
            Phase.P1,
            predecessor=forged_p0,
            predicates={"exact_cad_verified": True},
        )
        decision = verify_successor_admission(p1, successor=Phase.P2, predecessor=forged_p0)
        self.assertFalse(decision.admitted)
        self.assertIn("predecessor did not authorize", " ".join(decision.reasons))

    def test_cli_rejects_scaffold_receipt(self) -> None:
        p0 = receipt(Phase.P0, authority=Authority.HUMAN)
        payload = p0.to_dict()
        payload["evidence"][0]["content"] = {"scaffold_note": "pending"}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "receipt.json"
            path.write_text(json.dumps(payload), encoding="utf-8")
            result = subprocess.run(
                [sys.executable, str(ROOT / "scripts/verify_portfolio_admission.py"), str(path), "P1"],
                cwd=ROOT,
                text=True,
                capture_output=True,
                check=False,
            )
        self.assertEqual(1, result.returncode)
        self.assertIn("DENY", result.stdout)


if __name__ == "__main__":
    unittest.main()
