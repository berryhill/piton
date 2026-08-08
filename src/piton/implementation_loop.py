"""Executable, bounded repository implementation-loop contract."""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import StrEnum
from types import MappingProxyType
from typing import Mapping, Tuple


class AttemptStatus(StrEnum):
    SUCCEEDED = "succeeded"
    FAILED = "failed"


class LoopDecision(StrEnum):
    RESTART_LOOP = "restart_loop"
    TERMINAL_SUCCESS = "terminal_success"
    BLOCK = "block"
    STOP_POLICY = "stop_policy"
    STOP_MAX_ATTEMPTS = "stop_max_attempts"


class FailureClass(StrEnum):
    CODE_FAILURE = "code_failure"
    UNIT_TEST_FAILURE = "unit_test_failure"
    INTEGRATION_FAILURE = "integration_failure"
    GEOMETRY_FAILURE = "geometry_failure"
    STEP_READBACK_FAILURE = "step_readback_failure"
    REVIEW_DERIVATIVE_FAILURE = "review_derivative_failure"
    CI_FAILURE = "ci_failure"
    INSTALL_SMOKE_FAILURE = "install_smoke_failure"
    FORBIDDEN_SCOPE = "forbidden_scope"
    SECRET_EXPOSURE = "secret_exposure"
    AMBIGUOUS_AUTHORITY = "ambiguous_authority"
    UNSAFE_FABRICATION_REQUEST = "unsafe_fabrication_request"
    WRONG_REPOSITORY_OR_ACTOR = "wrong_repository_or_actor"
    PROTECTION_BYPASS = "protection_bypass"
    FORCE_PUSH_REQUIRED = "force_push_required"
    CORRUPT_CUSTODY = "corrupt_custody"
    MISSING_HUMAN_APPROVAL = "missing_human_approval"
    MISSING_OPERATOR_MERGE_AUTHORIZATION = "missing_operator_merge_authorization"
    PULL_REQUEST_READY_FOR_OPERATOR = "pull_request_ready_for_operator"
    BASE_BRANCH_ADVANCED_WHILE_WAITING = "base_branch_advanced_while_waiting"


RETRYABLE_FAILURES = frozenset(
    {
        FailureClass.CODE_FAILURE,
        FailureClass.UNIT_TEST_FAILURE,
        FailureClass.INTEGRATION_FAILURE,
        FailureClass.GEOMETRY_FAILURE,
        FailureClass.STEP_READBACK_FAILURE,
        FailureClass.REVIEW_DERIVATIVE_FAILURE,
        FailureClass.CI_FAILURE,
        FailureClass.INSTALL_SMOKE_FAILURE,
        FailureClass.BASE_BRANCH_ADVANCED_WHILE_WAITING,
    }
)
NONRETRYABLE_FAILURES = frozenset(FailureClass) - RETRYABLE_FAILURES
WAITING_FAILURES = frozenset(
    {FailureClass.MISSING_OPERATOR_MERGE_AUTHORIZATION}
)

_HEAD_PATTERN = re.compile(r"^(?:[0-9a-f]{40}|[0-9a-f]{64})$")
_DIGEST_PATTERN = re.compile(r"^sha256:[0-9a-f]{64}$")


def _require_head(name: str, value: str) -> None:
    if not isinstance(value, str) or not _HEAD_PATTERN.fullmatch(value):
        raise ValueError(f"{name} must be an exact 40- or 64-hex candidate head")


def _require_digest(name: str, value: str) -> None:
    if not isinstance(value, str) or not _DIGEST_PATTERN.fullmatch(value):
        raise ValueError(f"{name} must be a sha256:<64 lowercase hex> receipt")


@dataclass(frozen=True)
class OperatorMergeAuthorization:
    """Trusted operator authority to merge one exact task candidate."""

    actor: str
    repository: str
    task_id: str
    candidate_head: str
    action: str
    receipt_digest: str

    def __post_init__(self) -> None:
        if not isinstance(self.actor, str) or not self.actor.strip():
            raise ValueError("operator authorization requires an actor")
        if not isinstance(self.repository, str) or self.repository.count("/") != 1:
            raise ValueError("operator authorization requires owner/repository")
        if not isinstance(self.task_id, str) or not self.task_id.startswith("t_"):
            raise ValueError("operator authorization requires a task ID")
        _require_head("candidate_head", self.candidate_head)
        if self.action != "merge":
            raise ValueError("operator authorization action must be merge")
        _require_digest("receipt_digest", self.receipt_digest)


@dataclass(frozen=True)
class OperatorMergeGrant:
    """Trusted operator grant that the runtime binds to one verified task head."""

    actor: str
    repository: str
    task_id: str
    action: str
    candidate_binding: str
    receipt_digest: str

    def __post_init__(self) -> None:
        if not isinstance(self.actor, str) or not self.actor.strip():
            raise ValueError("operator merge grant requires an actor")
        if not isinstance(self.repository, str) or self.repository.count("/") != 1:
            raise ValueError("operator merge grant requires owner/repository")
        if not isinstance(self.task_id, str) or not self.task_id.startswith("t_"):
            raise ValueError("operator merge grant requires a task ID")
        if self.action != "merge":
            raise ValueError("operator merge grant action must be merge")
        if self.candidate_binding != "task_owned_exact_head_after_final_verification":
            raise ValueError("operator merge grant has an unsafe candidate binding")
        _require_digest("receipt_digest", self.receipt_digest)

    def bind(self, candidate_head: str) -> OperatorMergeAuthorization:
        """Mechanically bind this server-owned task grant to the verified exact head."""
        return OperatorMergeAuthorization(
            actor=self.actor,
            repository=self.repository,
            task_id=self.task_id,
            candidate_head=candidate_head,
            action=self.action,
            receipt_digest=self.receipt_digest,
        )


@dataclass(frozen=True)
class SuccessProof:
    """Evidence-bound proof that the exact candidate completed every terminal gate."""

    candidate_head: str
    ci_head: str
    ci_receipt_digest: str
    install_smoke_head: str
    install_smoke_receipt_digest: str
    safety_review_head: str
    safety_review_receipt_digest: str
    merged_tree_head: str
    merged_tree_readback_digest: str
    human_review_head: str | None = None
    human_review_receipt_digest: str | None = None
    operator_merge_authorization: OperatorMergeAuthorization | None = None

    def __post_init__(self) -> None:
        _require_head("candidate_head", self.candidate_head)
        for name in (
            "ci_head",
            "install_smoke_head",
            "safety_review_head",
        ):
            value = getattr(self, name)
            _require_head(name, value)
            if value != self.candidate_head:
                raise ValueError(f"{name} must bind the exact candidate head")
        # A merge commit may differ from the reviewed candidate head. Its receipt
        # must attest that the candidate is contained in this exact merged tree.
        _require_head("merged_tree_head", self.merged_tree_head)
        for name in (
            "ci_receipt_digest",
            "install_smoke_receipt_digest",
            "safety_review_receipt_digest",
            "merged_tree_readback_digest",
        ):
            _require_digest(name, getattr(self, name))
        has_human_review = (
            self.human_review_head is not None
            or self.human_review_receipt_digest is not None
        )
        if has_human_review:
            if self.human_review_head is None or self.human_review_receipt_digest is None:
                raise ValueError("human review head and receipt must be provided together")
            _require_head("human_review_head", self.human_review_head)
            if self.human_review_head != self.candidate_head:
                raise ValueError("human_review_head must bind the exact candidate head")
            _require_digest("human_review_receipt_digest", self.human_review_receipt_digest)
        authorization = self.operator_merge_authorization
        if authorization is not None:
            if not isinstance(authorization, OperatorMergeAuthorization):
                raise ValueError("operator merge authorization has the wrong type")
            if authorization.candidate_head != self.candidate_head:
                raise ValueError("operator merge authorization must bind the exact candidate head")
        if not has_human_review and authorization is None:
            raise ValueError(
                "success proof requires independent human review or trusted operator merge authorization"
            )


@dataclass(frozen=True)
class RetryErrorPacket:
    attempt: int
    failed_step: str
    head_sha: str | None
    commands: Tuple[str, ...]
    exit_codes: Tuple[int, ...]
    failed_checks: Tuple[str, ...]
    diagnosis: str
    changed_files: Tuple[str, ...]
    next_fix: Tuple[str, ...]
    evidence_refs: Tuple[str, ...]
    sanitized_logs: Tuple[str, ...]
    terminal_blockers: Tuple[str, ...]

    def __post_init__(self) -> None:
        for name in (
            "commands",
            "exit_codes",
            "failed_checks",
            "changed_files",
            "next_fix",
            "evidence_refs",
            "sanitized_logs",
            "terminal_blockers",
        ):
            object.__setattr__(self, name, tuple(getattr(self, name)))
        if (
            isinstance(self.attempt, bool)
            or not isinstance(self.attempt, int)
            or not 1 <= self.attempt <= 10
        ):
            raise ValueError("error-packet attempt must be bounded to 1..10")
        if not self.failed_step or not self.diagnosis:
            raise ValueError("error packet requires failed_step and diagnosis")
        if not self.commands or len(self.commands) != len(self.exit_codes):
            raise ValueError("error packet requires one exit code per command")
        if not self.failed_checks:
            raise ValueError("error packet requires at least one failed check")
        string_fields = (
            self.commands,
            self.failed_checks,
            self.changed_files,
            self.next_fix,
            self.evidence_refs,
            self.sanitized_logs,
            self.terminal_blockers,
        )
        if not all(isinstance(value, str) for values in string_fields for value in values):
            raise ValueError("error-packet list fields must contain strings")
        if not all(
            isinstance(code, int) and not isinstance(code, bool)
            for code in self.exit_codes
        ):
            raise ValueError("error-packet exit codes must be integers")

    def to_payload(self) -> dict[str, object]:
        return {
            "attempt": self.attempt,
            "failed_step": self.failed_step,
            "head_sha": self.head_sha,
            "commands": list(self.commands),
            "exit_codes": list(self.exit_codes),
            "failed_checks": list(self.failed_checks),
            "diagnosis": self.diagnosis,
            "changed_files": list(self.changed_files),
            "next_fix": list(self.next_fix),
            "evidence_refs": list(self.evidence_refs),
            "sanitized_logs": list(self.sanitized_logs),
            "terminal_blockers": list(self.terminal_blockers),
        }


@dataclass(frozen=True)
class GateDecision:
    loop_decision: LoopDecision
    attempt_status: AttemptStatus
    reason: str
    error_packet_payload: Mapping[str, object] | None = None
    success_proof: SuccessProof | None = None

    def __post_init__(self) -> None:
        try:
            decision = LoopDecision(self.loop_decision)
            status = AttemptStatus(self.attempt_status)
        except ValueError as exc:
            raise ValueError("gate decision contains an unknown status or decision") from exc
        object.__setattr__(self, "loop_decision", decision)
        object.__setattr__(self, "attempt_status", status)
        if not isinstance(self.reason, str) or not self.reason.strip():
            raise ValueError("gate decision requires a non-empty reason")
        if self.error_packet_payload is not None:
            if not isinstance(self.error_packet_payload, Mapping):
                raise ValueError("error packet payload must be a mapping")
            copied = {
                key: tuple(value) if isinstance(value, list) else value
                for key, value in self.error_packet_payload.items()
            }
            object.__setattr__(
                self, "error_packet_payload", MappingProxyType(copied)
            )
        if decision is LoopDecision.TERMINAL_SUCCESS:
            if status is not AttemptStatus.SUCCEEDED:
                raise ValueError("terminal success requires succeeded attempt status")
            if (
                self.error_packet_payload is not None
                or not isinstance(self.success_proof, SuccessProof)
            ):
                raise ValueError("terminal success requires only a validated success proof")
        else:
            if status is not AttemptStatus.FAILED:
                raise ValueError("non-success decisions require failed attempt status")
            if self.error_packet_payload is None or self.success_proof is not None:
                raise ValueError("failed decisions require only an error packet")


@dataclass(frozen=True)
class LoopStep:
    step_id: str
    purpose: str
    terminal_gate: bool = False


@dataclass(frozen=True)
class PullRequestLifecyclePolicy:
    """Fail-closed task ownership contract for one branch and one PR."""

    merge_execution: str
    serialization_key_fields: Tuple[str, ...]
    automatic_merge_forbidden: bool
    one_open_pr_per_task: bool
    base_drift_action: str

    def __post_init__(self) -> None:
        object.__setattr__(
            self, "serialization_key_fields", tuple(self.serialization_key_fields)
        )
        if self.merge_execution != "task_owned_terminal_gate":
            raise ValueError("PR merge execution must remain with the owning task gate")
        if self.serialization_key_fields != ("repository", "base_branch"):
            raise ValueError("PR coordination must bind repository and base branch")
        if self.automatic_merge_forbidden:
            raise ValueError("the task-owned terminal gate must be allowed to merge")
        if not self.one_open_pr_per_task:
            raise ValueError("each task must reuse exactly one open pull request")
        if self.base_drift_action != "refresh_same_branch_and_retry":
            raise ValueError("base drift must refresh and retry the same task branch and PR")


@dataclass(frozen=True)
class ImplementationLoop:
    flow_id: str
    version: int
    max_attempts: int
    restart_step: str
    gate_step: str
    pr_lifecycle: PullRequestLifecyclePolicy
    steps: Tuple[LoopStep, ...]

    def __post_init__(self) -> None:
        object.__setattr__(self, "steps", tuple(self.steps))
        self.validate()

    def validate(self) -> None:
        ids = [step.step_id for step in self.steps]
        if len(ids) != len(set(ids)):
            raise ValueError("loop step IDs must be unique")
        if self.restart_step not in ids or self.gate_step not in ids:
            raise ValueError("restart_step and gate_step must exist")
        gates = [step.step_id for step in self.steps if step.terminal_gate]
        if gates != [self.gate_step]:
            raise ValueError("exactly one terminal gate is required")
        if not 1 <= self.max_attempts <= 10:
            raise ValueError("retry budget must be bounded to 1..10")
        if not isinstance(self.pr_lifecycle, PullRequestLifecyclePolicy):
            raise ValueError("implementation loop requires a PR lifecycle policy")

    def decide(
        self,
        *,
        attempt: int,
        attempt_status: AttemptStatus,
        reason: str,
        failure_class: FailureClass | None = None,
        error_packet: RetryErrorPacket | None = None,
        success_proof: SuccessProof | None = None,
    ) -> GateDecision:
        """Emit the sole gate decision, enforcing packet, stop, and budget rules."""
        if (
            isinstance(attempt, bool)
            or not isinstance(attempt, int)
            or not 1 <= attempt <= self.max_attempts
        ):
            raise ValueError("attempt must be within the configured retry budget")
        if not reason:
            raise ValueError("gate decision requires a reason")
        status = AttemptStatus(attempt_status)

        if status is AttemptStatus.SUCCEEDED:
            if failure_class is not None or error_packet is not None:
                raise ValueError("successful attempts cannot carry failure data")
            if success_proof is None:
                raise ValueError("successful attempts require a validated success proof")
            return GateDecision(
                LoopDecision.TERMINAL_SUCCESS,
                status,
                reason,
                success_proof=success_proof,
            )

        if success_proof is not None:
            raise ValueError("failed attempts cannot carry a success proof")
        if failure_class is None or error_packet is None:
            raise ValueError("failed attempts require a failure class and error packet")
        failure = FailureClass(failure_class)
        if error_packet.attempt != attempt:
            raise ValueError("error packet attempt must match the gate attempt")
        payload = error_packet.to_payload()

        if failure in WAITING_FAILURES:
            decision = LoopDecision.BLOCK
        elif error_packet.terminal_blockers or failure in NONRETRYABLE_FAILURES:
            decision = LoopDecision.STOP_POLICY
        elif attempt >= self.max_attempts:
            decision = LoopDecision.STOP_MAX_ATTEMPTS
        else:
            decision = LoopDecision.RESTART_LOOP
        return GateDecision(decision, status, reason, payload)


PITON_IMPLEMENTATION_LOOP = ImplementationLoop(
    flow_id="piton_implementation_loop",
    version=3,
    max_attempts=10,
    restart_step="implement_minimally",
    gate_step="merge_on_success_or_loop",
    pr_lifecycle=PullRequestLifecyclePolicy(
        merge_execution="task_owned_terminal_gate",
        serialization_key_fields=("repository", "base_branch"),
        automatic_merge_forbidden=False,
        one_open_pr_per_task=True,
        base_drift_action="refresh_same_branch_and_retry",
    ),
    steps=(
        LoopStep("prepare_feature_worktree", "Prepare one trusted task-owned feature worktree"),
        LoopStep("understand", "Lock the Piton change contract"),
        LoopStep("inspect", "Inspect current source and evidence"),
        LoopStep("trace", "Trace authority and consequence boundaries"),
        LoopStep("implement_minimally", "Implement the smallest source-native change"),
        LoopStep("test_the_behavior", "Run deterministic product verification"),
        LoopStep("diagnose_and_repeat", "Diagnose failures without deciding the loop"),
        LoopStep("review_security_boundaries", "Review Piton authority and safety boundaries"),
        LoopStep("review_launch_assets", "Review repository, schema, evidence, and operator assets"),
        LoopStep("final_verification", "Verify the exact current candidate head"),
        LoopStep("report_concisely", "Assemble the review and residual-risk packet"),
        LoopStep("push_feature_branch", "Publish the authorized branch without force"),
        LoopStep("watch_cicd", "Observe CI for the exact candidate head"),
        LoopStep("merge_on_success_or_loop", "Sole merge, retry, or terminal gate", True),
    ),
)
