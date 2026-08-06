import unittest

from piton.implementation_loop import (
    AttemptStatus,
    FailureClass,
    GateDecision,
    LoopDecision,
    PITON_IMPLEMENTATION_LOOP,
    RetryErrorPacket,
    SuccessProof,
)


def packet(attempt=1, blockers=()):
    return RetryErrorPacket(
        attempt=attempt,
        failed_step="test_the_behavior",
        head_sha=None,
        commands=("python -m unittest",),
        exit_codes=(1,),
        failed_checks=("unit",),
        diagnosis="representative failure",
        changed_files=("src/piton/model.py",),
        next_fix=("repair contract",),
        evidence_refs=(),
        sanitized_logs=("test failed",),
        terminal_blockers=blockers,
    )


def success_proof(head="a" * 40):
    digest = "sha256:" + "b" * 64
    return SuccessProof(
        candidate_head=head,
        ci_head=head,
        ci_receipt_digest=digest,
        install_smoke_head=head,
        install_smoke_receipt_digest=digest,
        safety_review_head=head,
        safety_review_receipt_digest=digest,
        human_review_head=head,
        human_review_receipt_digest=digest,
        merged_tree_head=head,
        merged_tree_readback_digest=digest,
    )


class ImplementationLoopTests(unittest.TestCase):
    def test_loop_contract_is_bounded_and_has_one_gate(self):
        PITON_IMPLEMENTATION_LOOP.validate()
        self.assertEqual("implement_minimally", PITON_IMPLEMENTATION_LOOP.restart_step)
        self.assertEqual("merge_on_success_or_loop", PITON_IMPLEMENTATION_LOOP.gate_step)
        self.assertEqual(10, PITON_IMPLEMENTATION_LOOP.max_attempts)
        self.assertEqual(14, len(PITON_IMPLEMENTATION_LOOP.steps))

    def test_retry_requires_matching_error_packet(self):
        with self.assertRaisesRegex(ValueError, "require.*error packet"):
            PITON_IMPLEMENTATION_LOOP.decide(
                attempt=1,
                attempt_status=AttemptStatus.FAILED,
                reason="tests failed",
                failure_class=FailureClass.UNIT_TEST_FAILURE,
            )
        decision = PITON_IMPLEMENTATION_LOOP.decide(
            attempt=1,
            attempt_status=AttemptStatus.FAILED,
            reason="tests failed",
            failure_class=FailureClass.UNIT_TEST_FAILURE,
            error_packet=packet(),
        )
        self.assertEqual(LoopDecision.RESTART_LOOP, decision.loop_decision)
        with self.assertRaises(TypeError):
            decision.error_packet_payload["attempt"] = 2

    def test_budget_exhaustion_stops(self):
        decision = PITON_IMPLEMENTATION_LOOP.decide(
            attempt=10,
            attempt_status=AttemptStatus.FAILED,
            reason="tests still fail",
            failure_class=FailureClass.UNIT_TEST_FAILURE,
            error_packet=packet(attempt=10),
        )
        self.assertEqual(LoopDecision.STOP_MAX_ATTEMPTS, decision.loop_decision)

    def test_policy_failure_or_terminal_blocker_never_retries(self):
        policy = PITON_IMPLEMENTATION_LOOP.decide(
            attempt=1,
            attempt_status=AttemptStatus.FAILED,
            reason="authority is ambiguous",
            failure_class=FailureClass.AMBIGUOUS_AUTHORITY,
            error_packet=packet(),
        )
        blocked = PITON_IMPLEMENTATION_LOOP.decide(
            attempt=1,
            attempt_status=AttemptStatus.FAILED,
            reason="external terminal blocker",
            failure_class=FailureClass.CODE_FAILURE,
            error_packet=packet(blockers=("operator stop",)),
        )
        self.assertEqual(LoopDecision.STOP_POLICY, policy.loop_decision)
        self.assertEqual(LoopDecision.STOP_POLICY, blocked.loop_decision)

    def test_success_requires_exact_head_bound_proof(self):
        with self.assertRaisesRegex(ValueError, "success proof"):
            PITON_IMPLEMENTATION_LOOP.decide(
                attempt=1,
                attempt_status=AttemptStatus.SUCCEEDED,
                reason="caller assertion only",
            )
        decision = PITON_IMPLEMENTATION_LOOP.decide(
            attempt=1,
            attempt_status=AttemptStatus.SUCCEEDED,
            reason="all gate requirements satisfied",
            success_proof=success_proof(),
        )
        self.assertEqual(LoopDecision.TERMINAL_SUCCESS, decision.loop_decision)
        self.assertIsNone(decision.error_packet_payload)
        self.assertEqual("a" * 40, decision.success_proof.candidate_head)

    def test_success_proof_rejects_mismatched_head_and_bad_receipt(self):
        values = success_proof().__dict__ | {"ci_head": "c" * 40}
        with self.assertRaisesRegex(ValueError, "exact candidate head"):
            SuccessProof(**values)
        values = success_proof().__dict__ | {"ci_receipt_digest": "sha256:short"}
        with self.assertRaisesRegex(ValueError, "receipt"):
            SuccessProof(**values)

    def test_success_proof_allows_distinct_attested_merge_commit(self):
        values = success_proof().__dict__ | {"merged_tree_head": "d" * 40}
        proof = SuccessProof(**values)
        self.assertEqual("d" * 40, proof.merged_tree_head)
        self.assertEqual("a" * 40, proof.candidate_head)

    def test_gate_decision_rejects_inconsistent_direct_construction(self):
        with self.assertRaisesRegex(ValueError, "requires succeeded"):
            GateDecision(
                LoopDecision.TERMINAL_SUCCESS,
                AttemptStatus.FAILED,
                "inconsistent",
                success_proof=success_proof(),
            )
        with self.assertRaisesRegex(ValueError, "require failed"):
            GateDecision(
                LoopDecision.RESTART_LOOP,
                AttemptStatus.SUCCEEDED,
                "inconsistent",
                {"attempt": 1},
            )


if __name__ == "__main__":
    unittest.main()
