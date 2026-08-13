"""Sole adapter-facing custody application service.

Adapters receive typed commands and trusted principal context. They do not
receive database handles, object paths, repositories, or mutation capability.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, fields, is_dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Callable, Mapping

from ..evidence import EvidenceClosure, EvidenceClosureError, EvidenceRepository
from ..human_review import (
    FrameworkPacketClosure,
    FrameworkPacketClosureError,
    HumanReviewIntake,
    HumanReviewIntakeError,
)
from ..model import ChangeProposal, _derive_change_candidate
from ..portfolio import (
    Authority,
    Disposition,
    EvidenceArtifact,
    ExecutionStatus,
    Phase,
    PhaseExitReceipt,
    SafetyState,
    issue_phase_exit_receipt,
    receipt_digest,
    verify_successor_admission,
)
from ..review_packet import ReviewPacket, build_review_packet, validate_review_packet
from ..revision import DesignRevision
from ..source_tree import SourceTree, SourceTreeFile
from ..storage.blobs import BlobStore
from ..storage.build_attempts import BuildAttemptCoordinator, CoordinatorState, DurableBuildAttempt
from ..storage.db import Database
from ..storage.custody import (
    BackupIdentity,
    BackupReceipt,
    DeletionReceipt,
    RestoreReceipt,
    RetentionPolicy,
    RetentionReceipt,
    _authorize_project_custody_factory,
    _take_project_custody_factory,
)
from ..storage.revisions import (
    ChannelConflictError,
    RevisionRepository,
    _issue_server_mutation_capability,
)
from .commands import (
    BeginDraft,
    CommitDraft,
    CreateProject,
    DeleteProject,
    DiscardDraft,
    ImportSourceBase,
    RestoreForward,
    UpdateDraft,
)
from .drafts import DraftRecord, DraftStore
from ..worker_contracts import PrecisionWorkerRequest, PrecisionWorkerResult

if TYPE_CHECKING:
    from ..realization import RealizationInputs

_PRINCIPAL_PROOF = object()
ExactInputs = Callable[[str, str, str], "RealizationInputs"]
Clock = Callable[[], datetime]
_construct_project_custody = _take_project_custody_factory()
del _take_project_custody_factory


class PrincipalAuthorityError(PermissionError):
    """Caller-supplied labels cannot become an authenticated principal."""


class IdempotencyConflictError(RuntimeError):
    """An idempotency identity was reused for a non-identical admission."""


class StaleBaseConflictError(RuntimeError):
    """The command's exact authored base is no longer current."""


class StaleDraftBaseError(StaleBaseConflictError):
    """The workspace is not the exact revision and generation captured by the draft."""


class PrincipalContext:
    """Opaque context issued only by the trusted service composition root."""

    __slots__ = ("principal_id", "_proof")

    def __new__(cls, principal_id: str, proof: object = None) -> "PrincipalContext":
        if proof is not _PRINCIPAL_PROOF:
            raise PrincipalAuthorityError("principal context is server-issued only")
        if not isinstance(principal_id, str) or not principal_id:
            raise ValueError("principal_id must not be empty")
        instance = super().__new__(cls)
        instance.principal_id = principal_id
        instance._proof = proof
        return instance


def _issue_principal_context(principal_id: str) -> PrincipalContext:
    """Trusted daemon authentication seam, intentionally not service-facing."""
    return PrincipalContext(principal_id, _PRINCIPAL_PROOF)


@dataclass(frozen=True, slots=True)
class CommandReceipt:
    command_id: str
    project_id: str
    kind: str
    outcome: str = "applied"
    persisted_revision_id: str | None = None
    parent_revision_id: str | None = None
    source_manifest_digest: str | None = None
    fabrication_release: bool = False
    machine_actuation: bool = False
    review_state: str = "needs_human_review"


@dataclass(frozen=True, slots=True)
class DraftReceipt:
    command_id: str
    project_id: str
    draft_id: str
    base_revision_id: str
    content_digest: str
    expires_at: str
    persisted_revision_id: None = None
    fabrication_release: bool = False
    machine_actuation: bool = False
    review_state: str = "needs_human_review"


class PitonApplicationService:
    """Own every Stage-1 authored-state effect behind one typed boundary."""

    def __init__(
        self,
        database: Database,
        blobs: BlobStore,
        drafts: DraftStore,
        *,
        precision_inputs: ExactInputs | None = None,
        precision_clock: Clock | None = None,
    ) -> None:
        if not isinstance(database, Database) or not isinstance(blobs, BlobStore):
            raise TypeError("trusted Database and BlobStore are required")
        if not isinstance(drafts, DraftStore):
            raise TypeError("trusted DraftStore is required")
        if precision_inputs is not None and not callable(precision_inputs):
            raise TypeError("precision_inputs must be callable")
        if precision_clock is not None and not callable(precision_clock):
            raise TypeError("precision_clock must be callable")
        self.__database = database
        self.__blobs = blobs
        self.__drafts = drafts
        self.__repository = RevisionRepository(database, blobs)
        self.__project_custody = _construct_project_custody(database, blobs)
        self.__mutation_capability = _issue_server_mutation_capability()
        self.__build_attempt_coordinator = BuildAttemptCoordinator(database)
        self.__precision_inputs = precision_inputs
        self.__precision_clock = precision_clock or (lambda: datetime.now(UTC))
        self.__evidence_repository = EvidenceRepository(
            database, blobs=blobs, trusted_clock=self.__precision_clock
        )
        self.__evidence_repository.recover_incomplete_publications()
        self.__precision_control_root = blobs.control_root

    @classmethod
    def open(
        cls,
        project_root: str | Path,
        *,
        precision_inputs: ExactInputs | None = None,
        precision_clock: Clock | None = None,
    ) -> "PitonApplicationService":
        root = Path(project_root)
        blobs = BlobStore(root)
        database = Database(root / ".piton" / "piton.sqlite3")
        database.migrate()
        drafts = DraftStore(root)
        drafts.recover_after_crash()
        return cls(
            database,
            blobs,
            drafts,
            precision_inputs=precision_inputs,
            precision_clock=precision_clock,
        )

    def backup_project(
        self,
        project_id: str,
        destination: str | Path,
        ctx: PrincipalContext | None = None,
        *,
        created_at: str | None = None,
    ) -> BackupReceipt:
        self._require_context(ctx)
        return self.__project_custody.backup(
            project_id, destination, created_at=created_at
        )

    def restore_project(
        self,
        source: str | Path,
        ctx: PrincipalContext | None = None,
        *,
        trusted_identity: BackupIdentity | str,
    ) -> RestoreReceipt:
        self._require_context(ctx)
        return self.__project_custody.restore(
            source, trusted_identity=trusted_identity
        )

    def apply_retention(
        self,
        policy: RetentionPolicy,
        ctx: PrincipalContext | None = None,
        *,
        dry_run: bool = True,
    ) -> RetentionReceipt:
        self._require_context(ctx)
        return self.__project_custody.apply_retention(policy, dry_run=dry_run)

    @staticmethod
    def _lease_expiry(value: str) -> datetime:
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError as error:
            raise ValueError("coordinator lease expiry must be an ISO-8601 timestamp") from error
        if parsed.tzinfo is None or parsed.utcoffset() is None:
            raise ValueError("coordinator lease expiry must include a timezone")
        return parsed.astimezone(UTC)

    def _precision_worker_bindings(
        self, project_id: str, attempt_id: str
    ) -> tuple[DurableBuildAttempt, CoordinatorState, RealizationInputs]:
        from ..precision_worker import validate_precision_worker_bindings
        from ..realization import RealizationInputs

        attempt, state = self.__build_attempt_coordinator.get_execution_bindings(
            project_id, attempt_id
        )
        now = self.__precision_clock()
        if not isinstance(now, datetime) or now.tzinfo is None or now.utcoffset() is None:
            raise ValueError("trusted clock must return a timezone-aware datetime")
        if state.lease_expires_at is None:
            raise ValueError("coordinator lease expiry is required")
        if self._lease_expiry(state.lease_expires_at) <= now.astimezone(UTC):
            raise ValueError("coordinator lease is expired")
        if self.__precision_inputs is None:
            raise RuntimeError("trusted exact-input repository is not configured")
        inputs = self.__precision_inputs(
            attempt.project_id, attempt.revision_id, attempt.input_manifest_digest
        )
        if not isinstance(inputs, RealizationInputs):
            raise TypeError("trusted exact-input repository returned invalid inputs")
        validate_precision_worker_bindings(attempt, state, inputs.revision, inputs)
        return attempt, state, inputs

    @staticmethod
    def _compose_precision_worker_request(
        attempt: DurableBuildAttempt, state: CoordinatorState
    ) -> PrecisionWorkerRequest:
        from ..precision_worker import EXPECTED_OUTPUTS, PRECISION_WORKER_PIN

        if state.lease_id is None:
            raise ValueError("coordinator lease is required")
        return PrecisionWorkerRequest(
            project_id=attempt.project_id,
            revision_id=attempt.revision_id,
            attempt_id=attempt.attempt_id,
            generation=state.generation,
            fence=state.fence,
            lease_id=state.lease_id,
            input_manifest_digest=attempt.input_manifest_digest,
            recipe_digest=attempt.recipe_digest,
            toolchain_digest=attempt.toolchain_digest,
            capability_manifest_digest=attempt.capability_manifest_digest,
            resource_limits_digest=attempt.resource_limits_digest,
            expected_outputs_digest=attempt.expected_outputs_digest,
            request_signature_ref=attempt.request_signature_digest,
            worker_id=attempt.worker_id,
            worker_pin=PRECISION_WORKER_PIN,
            isolation_class=attempt.isolation_class,
            expected_outputs=EXPECTED_OUTPUTS,
        )

    def issue_precision_worker_request(
        self, project_id: str, attempt_id: str
    ) -> PrecisionWorkerRequest:
        """Compose one request solely from daemon-custodied current bindings."""
        attempt, state, _ = self._precision_worker_bindings(project_id, attempt_id)
        # Geometry-only contract tests use a coordinator double with no durable
        # database. Every production coordinator has this daemon-owned binding.
        if hasattr(self.__build_attempt_coordinator, "_database"):
            self.__evidence_repository.declare(attempt)
        return self._compose_precision_worker_request(attempt, state)

    def run_precision_worker(self, request: PrecisionWorkerRequest) -> PrecisionWorkerResult:
        """Rebind an issued request and launch exact admitted bytes in a sandbox."""
        import hashlib
        import os
        import shutil
        import subprocess
        import sys

        from ..precision_worker import (
            preflight_precision_output_custody,
            verify_precision_worker_result,
        )
        from ..precision_worker_launch import (
            SANDBOX_BOOTSTRAP,
            bounded_diagnostic_fd,
            bundle_file_manifest,
            classify_sandbox_failure,
            create_isolated_output_root,
            execution_archive,
            execution_manifest,
            publish_isolated_attempt,
            read_bounded_diagnostic,
            remove_input_bundle,
            sandbox_mount_arguments,
            sealed_archive_fd,
            stage_input_bundle,
            validate_admitted_worker_payload,
            worker_payload_digest,
        )
        from ..worker_admission import ADMITTED_WORKER_PAYLOADS
        from ..worker_contracts import canonical_json_bytes

        if not isinstance(request, PrecisionWorkerRequest):
            raise TypeError("request must be a PrecisionWorkerRequest")
        attempt, state, inputs = self._precision_worker_bindings(
            request.project_id, request.attempt_id
        )
        expected = self._compose_precision_worker_request(attempt, state)
        if request.canonical_bytes != expected.canonical_bytes:
            raise ValueError("request no longer matches durable attempt and coordinator bindings")
        blocked = preflight_precision_output_custody(request, self.__precision_control_root)
        if blocked is not None:
            return blocked
        sandbox = Path("/usr/bin/bwrap")
        try:
            sandbox_metadata = sandbox.stat()
        except FileNotFoundError:
            raise RuntimeError("precision worker sandbox is unavailable")
        if (
            not sandbox.is_file()
            or sandbox_metadata.st_uid != 0
            or sandbox_metadata.st_mode & 0o022
            or not os.access(sandbox, os.X_OK)
        ):
            raise RuntimeError("precision worker sandbox executable is not trusted")
        bundle, bundle_digest = stage_input_bundle(
            inputs.repository_root, self.__precision_control_root, inputs.revision
        )
        try:
            payload_digest = worker_payload_digest(bundle)
            validate_admitted_worker_payload(
                request.worker_pin, payload_digest, ADMITTED_WORKER_PAYLOADS
            )
            bundle_files = bundle_file_manifest(bundle)
            archive_bytes = execution_archive(bundle)
            archive_fd = sealed_archive_fd(archive_bytes)
        finally:
            remove_input_bundle(bundle)
        try:
            archive_digest = "sha256:" + hashlib.sha256(archive_bytes).hexdigest()
            manifest = execution_manifest(
                request,
                inputs.revision,
                bundle_digest,
                payload_digest,
                archive_digest,
                bundle_files,
            )
            output_root = self.__precision_control_root / "build-attempts"
            runtime_root = Path(sys.base_prefix).resolve(strict=True)
            virtual_environment = Path(sys.prefix).resolve(strict=True)
        except Exception:
            os.close(archive_fd)
            raise
        try:
            sandbox_output_root = create_isolated_output_root(self.__precision_control_root)
        except Exception:
            os.close(archive_fd)
            raise
        command = [
            str(sandbox),
            "--die-with-parent",
            "--new-session",
            "--unshare-all",
        ]
        try:
            command.extend(
                sandbox_mount_arguments(
                    archive_fd, sandbox_output_root, runtime_root, virtual_environment
                )
            )
            command.extend(
                (
                "--proc",
                "/proc",
                "--dev",
                "/dev",
                "--tmpfs",
                "/tmp",
                "--chdir",
                "/tmp",
                "--clearenv",
                "--setenv",
                "LANG",
                "C.UTF-8",
                "--setenv",
                "LC_ALL",
                "C.UTF-8",
                "--setenv",
                "PYTHONHASHSEED",
                "0",
                "--setenv",
                "PYTHONNOUSERSITE",
                "1",
                "--setenv",
                "PYTHONDONTWRITEBYTECODE",
                "1",
                "--setenv",
                "HOME",
                "/tmp",
                "--setenv",
                "XDG_CONFIG_HOME",
                "/tmp/.config",
                "--setenv",
                "XDG_CACHE_HOME",
                "/tmp/.cache",
                str(Path(sys.executable).absolute()),
                "-I",
                "-B",
                "-c",
                SANDBOX_BOOTSTRAP,
                )
            )
        except Exception:
            os.close(archive_fd)
            shutil.rmtree(sandbox_output_root, ignore_errors=True)
            raise
        environment = {"PATH": os.defpath}
        diagnostic_fd = bounded_diagnostic_fd()
        try:
            completed = subprocess.run(
                command,
                input=canonical_json_bytes(manifest),
                stdout=subprocess.PIPE,
                stderr=diagnostic_fd,
                cwd="/",
                env=environment,
                close_fds=True,
                pass_fds=(archive_fd,),
                check=False,
                timeout=300,
            )
            diagnostic = read_bounded_diagnostic(diagnostic_fd)
        except Exception:
            shutil.rmtree(sandbox_output_root, ignore_errors=True)
            raise
        finally:
            os.close(diagnostic_fd)
            os.close(archive_fd)
        try:
            if completed.returncode != 0 or len(completed.stdout) > 1024 * 1024:
                failure_class = classify_sandbox_failure(completed.returncode, diagnostic)
                raise RuntimeError(f"precision worker child failed: {failure_class}")
            try:
                result = PrecisionWorkerResult.from_manifest(
                    json.loads(completed.stdout.decode("utf-8", errors="strict"))
                )
            except (UnicodeDecodeError, json.JSONDecodeError, TypeError, ValueError) as error:
                raise RuntimeError("precision worker child returned an invalid result") from error
            staged_output = sandbox_output_root / request.project_id / request.attempt_id
            verified = verify_precision_worker_result(request, result, staged_output)
            output = publish_isolated_attempt(
                sandbox_output_root, output_root, request.project_id, request.attempt_id
            )
            return verify_precision_worker_result(request, verified, output)
        finally:
            shutil.rmtree(sandbox_output_root, ignore_errors=True)

    def close_precision_worker_evidence(
        self, request: PrecisionWorkerRequest, result: PrecisionWorkerResult
    ) -> EvidenceClosure:
        """Verify current daemon custody, run fixed checks, and publish atomically."""
        from ..precision_worker import verify_custodied_precision_worker_result

        if not isinstance(request, PrecisionWorkerRequest):
            raise TypeError("request must be a PrecisionWorkerRequest")
        if not isinstance(result, PrecisionWorkerResult):
            raise TypeError("result must be a PrecisionWorkerResult")
        with self.__database.read() as connection:
            existing = connection.execute(
                "SELECT closure_digest,worker_result_digest FROM evidence_closures "
                "WHERE project_id=? AND attempt_id=?",
                (request.project_id, request.attempt_id),
            ).fetchone()
        if existing is not None:
            if (
                result.status != "succeeded"
                or existing["worker_result_digest"] != result.result_digest
            ):
                raise EvidenceClosureError(
                    "immutable closure attempt is bound to a different or unsuccessful worker result"
                )
            closure = self.__evidence_repository.get_closure(
                request.project_id, existing["closure_digest"]
            )
            bindings = (
                (request.project_id, closure.project_id),
                (request.revision_id, closure.revision_id),
                (request.attempt_id, closure.attempt_id),
                (request.generation, closure.generation),
                (request.fence, closure.fence),
                (request.lease_id, closure.lease_id),
                (result.request_digest, request.request_digest),
            )
            if any(actual != expected for actual, expected in bindings):
                raise EvidenceClosureError("replay does not match exact closure custody bindings")
            verify_custodied_precision_worker_result(
                request, result, self.__precision_control_root
            )
            return closure

        attempt, state, _ = self._precision_worker_bindings(
            request.project_id, request.attempt_id
        )
        expected = self._compose_precision_worker_request(attempt, state)
        if request.canonical_bytes != expected.canonical_bytes:
            raise ValueError("request no longer matches durable attempt and coordinator bindings")
        verified, artifact_bytes = verify_custodied_precision_worker_result(
            request, result, self.__precision_control_root
        )
        if result.status != "succeeded":
            raise EvidenceClosureError("unsuccessful worker result cannot close evidence")
        declaration = self.__evidence_repository.get_declaration(
            attempt.project_id, attempt.attempt_id
        )
        inspection = json.loads(artifact_bytes["inspection_receipt"])
        receipts = self.__evidence_repository.execute_checks(declaration, verified, inspection)
        self.__evidence_repository.begin_publication(attempt, state, result)
        return self.__evidence_repository.publish(
            attempt=attempt,
            state=state,
            declaration=declaration,
            result=result,
            receipts=receipts,
        )

    def get_evidence_closure(
        self, project_id: str, closure_digest: str
    ) -> EvidenceClosure:
        """Read and revalidate one exact project-scoped immutable closure."""
        return self.__evidence_repository.get_closure(project_id, closure_digest)

    def build_precision_review_packet(
        self,
        project_id: str,
        closure_digest: str,
        result: PrecisionWorkerResult,
        output_directory: str | Path,
    ) -> ReviewPacket:
        """Project one successful custodied closure into a read-only review packet."""
        closure = self.__evidence_repository.get_closure(project_id, closure_digest)
        artifact_root = (
            self.__precision_control_root
            / "build-attempts"
            / closure.project_id
            / closure.attempt_id
        )
        return build_review_packet(closure, result, artifact_root, output_directory)

    def intake_human_review(
        self, intake: HumanReviewIntake, packet_directory: str | Path
    ) -> HumanReviewIntake:
        """Admit identified review work without recording a review decision or effect."""
        if not isinstance(intake, HumanReviewIntake):
            raise TypeError("intake must be a HumanReviewIntake")
        closure = self.__evidence_repository.get_closure(
            intake.project_id, intake.evidence_closure_digest
        )
        packet = validate_review_packet(packet_directory)
        bindings = (
            ("project", intake.project_id, closure.project_id, packet.project_id),
            ("revision", intake.revision_id, closure.revision_id, packet.revision_id),
            ("attempt", intake.attempt_id, closure.attempt_id, packet.build_attempt_id),
            (
                "evidence closure",
                intake.evidence_closure_digest,
                closure.closure_digest,
                packet.evidence_closure_digest,
            ),
        )
        for label, asserted, custodied, packet_value in bindings:
            if asserted != custodied or asserted != packet_value:
                raise HumanReviewIntakeError(
                    f"human-review intake {label} identity is not exact"
                )
        if intake.review_packet_digest != packet.packet_digest:
            raise HumanReviewIntakeError("human-review intake packet digest is not exact")
        if (
            packet.truth.get("review_state") != "needs_human_review"
            or packet.fabrication_release is not False
            or packet.truth.get("machine_actuation") is not False
        ):
            raise HumanReviewIntakeError(
                "human-review intake packet violates the root truth boundary"
            )
        return intake

    def close_framework_packet(
        self, closure: FrameworkPacketClosure, packet_directory: str | Path
    ) -> FrameworkPacketClosure:
        """Confirm one exact packet remains ready for, but not accepted by, a human."""
        if not isinstance(closure, FrameworkPacketClosure):
            raise TypeError("closure must be a FrameworkPacketClosure")
        evidence = self.__evidence_repository.get_closure(
            closure.project_id, closure.evidence_closure_digest
        )
        packet = validate_review_packet(packet_directory)
        bindings = (
            ("project", closure.project_id, evidence.project_id, packet.project_id),
            ("revision", closure.revision_id, evidence.revision_id, packet.revision_id),
            ("attempt", closure.attempt_id, evidence.attempt_id, packet.build_attempt_id),
            (
                "evidence closure",
                closure.evidence_closure_digest,
                evidence.closure_digest,
                packet.evidence_closure_digest,
            ),
            (
                "review packet",
                closure.review_packet_digest,
                packet.packet_digest,
                packet.packet_digest,
            ),
            (
                "worker result",
                closure.worker_result_digest,
                evidence.worker_result_digest,
                packet.worker_result_digest,
            ),
            (
                "declaration",
                closure.declaration_digest,
                evidence.declaration_digest,
                packet.declaration_digest,
            ),
            ("generation", closure.generation, evidence.generation, packet.generation),
            ("fence", closure.fence, evidence.fence, packet.fence),
            ("lease", closure.lease_id, evidence.lease_id, packet.lease_id),
        )
        for label, asserted, custodied, packet_value in bindings:
            if asserted != custodied or asserted != packet_value:
                raise FrameworkPacketClosureError(
                    f"framework-packet closure {label} identity is not exact"
                )
        artifact_bindings = {
            "exact_brep": closure.exact_brep_digest,
            "step": closure.step_digest,
            "review_glb": closure.review_glb_digest,
            "review_selection_map": closure.review_selection_map_digest,
        }
        artifact_claims = {
            "exact_brep": "exact_occt_brep_derived_realization",
            "step": "derived_exchange_representation",
            "review_glb": "review-only",
            "review_selection_map": "artifact-local-review-selection-only",
        }
        if any(
            digest != evidence.artifacts[role]["digest"]
            or digest != packet.artifacts[role]["digest"]
            or evidence.artifacts[role]["claim_scope"] != artifact_claims[role]
            or packet.artifacts[role]["claim_scope"] != artifact_claims[role]
            for role, digest in artifact_bindings.items()
        ):
            raise FrameworkPacketClosureError(
                "framework-packet closure artifact identity or claim scope is not exact"
            )
        if dict(packet.truth) != {
            "review_state": "needs_human_review",
            "fabrication_release": False,
            "machine_actuation": False,
            "release_state": "unreleased",
            "channel_transition": False,
        }:
            raise FrameworkPacketClosureError(
                "framework-packet closure violates the root truth boundary"
            )
        return closure

    def issue_autonomous_p1_engineering_disposition(
        self,
        *,
        receipt_id: str,
        predecessor_receipt_id: str,
        revision: DesignRevision,
        realization_receipt_path: Path,
        qualification_receipt_path: Path,
    ) -> PhaseExitReceipt:
        """Issue P1 only from an authenticated receipt already held by this daemon."""
        from ..feasibility import evaluate_exact_cad_feasibility

        predecessor = self._load_custodied_p0_receipt(predecessor_receipt_id)
        predecessor_admission = verify_successor_admission(predecessor, successor=Phase.P1)
        if (
            predecessor.phase is not Phase.P0
            or predecessor.authority is not Authority.HUMAN
            or not predecessor_admission.admitted
        ):
            raise ValueError("an authorized human P0 predecessor is required")

        decision = evaluate_exact_cad_feasibility(
            revision,
            realization_receipt_path,
            qualification_receipt_path,
        )
        evidence = EvidenceArtifact.from_content(
            artifact_id="p1-exact-cad-feasibility",
            repository_path=(
                f"evidence/p1/{revision.revision_id}/{decision.attempt_scope}/"
                "exact-cad-feasibility.json"
            ),
            content=decision.to_dict(),
        )
        receipt = issue_phase_exit_receipt(
            receipt_id=receipt_id,
            phase=Phase.P1,
            status=ExecutionStatus.COMPLETED,
            disposition=Disposition.ADVANCE,
            authority=Authority.AUTONOMOUS,
            predecessor_receipt_id=predecessor.receipt_id,
            predecessor_receipt_digest=receipt_digest(predecessor),
            predicates=decision.predicates,
            evidence=(evidence,),
            safety=SafetyState(),
        )
        receipt_json = json.dumps(
            receipt.to_dict(), sort_keys=True, separators=(",", ":")
        ).encode("utf-8")
        with self.__database.immediate() as connection:
            connection.execute(
                "INSERT INTO portfolio_phase_receipts("
                "receipt_id, phase, authority, receipt_digest, receipt_json, "
                "authenticated_actor_id, authenticated_at) VALUES(?, ?, ?, ?, ?, ?, ?)",
                (
                    receipt.receipt_id,
                    receipt.phase.value,
                    receipt.authority.value,
                    receipt_digest(receipt),
                    receipt_json,
                    "piton-daemon:autonomous-p1",
                    self._now(),
                ),
            )
            connection.execute(
                "INSERT INTO portfolio_phase_heads(phase, receipt_id, receipt_digest) "
                "VALUES(?, ?, ?) ON CONFLICT(phase) DO UPDATE SET "
                "receipt_id=excluded.receipt_id, receipt_digest=excluded.receipt_digest",
                (receipt.phase.value, receipt.receipt_id, receipt_digest(receipt)),
            )
        return receipt

    def _load_custodied_p0_receipt(self, receipt_id: str) -> PhaseExitReceipt:
        if not isinstance(receipt_id, str) or not receipt_id:
            raise ValueError("predecessor_receipt_id must not be empty")
        with self.__database.read() as connection:
            row = connection.execute(
                "SELECT receipt.phase, receipt.authority, receipt.receipt_digest, "
                "receipt.receipt_json, receipt.authenticated_actor_id, "
                "receipt.authenticated_at "
                "FROM portfolio_phase_heads AS head "
                "JOIN portfolio_phase_receipts AS receipt "
                "ON receipt.receipt_id=head.receipt_id "
                "AND receipt.receipt_digest=head.receipt_digest "
                "WHERE head.phase=? AND head.receipt_id=?",
                (Phase.P0.value, receipt_id),
            ).fetchone()
        if row is None:
            raise LookupError("current daemon-custodied P0 receipt was not found")
        if row[0] != Phase.P0.value or row[1] != Authority.HUMAN.value:
            raise ValueError("an authorized human P0 predecessor is required")
        if not row[4] or not row[5]:
            raise RuntimeError("custodied P0 receipt lacks authentication provenance")

        raw = row[3]
        if not isinstance(raw, bytes):
            raise RuntimeError("custodied P0 receipt payload is not immutable bytes")
        try:
            payload = json.loads(raw.decode("utf-8", errors="strict"))
            predecessor = PhaseExitReceipt.from_dict(payload)
        except (UnicodeDecodeError, json.JSONDecodeError, TypeError, ValueError) as error:
            raise RuntimeError("custodied P0 receipt payload is invalid") from error
        if predecessor.receipt_id != receipt_id:
            raise RuntimeError("custodied P0 receipt ID does not bind its payload")
        if predecessor.phase.value != row[0] or predecessor.authority.value != row[1]:
            raise RuntimeError("custodied P0 receipt metadata does not bind its payload")
        if receipt_digest(predecessor) != row[2]:
            raise RuntimeError("custodied P0 receipt digest does not bind its payload")
        return predecessor

    def execute(
        self, command: object, ctx: PrincipalContext
    ) -> CommandReceipt | DraftReceipt | DeletionReceipt:
        """Admit every adapter through one typed, idempotent command path."""
        routes = {
            CreateProject: ("create_project", self._create_project),
            DeleteProject: ("delete_project", self._delete_project),
            ImportSourceBase: ("import_source_base", self._import_source_base),
            BeginDraft: ("begin_draft", self._begin_draft),
            UpdateDraft: ("update_draft", self._update_draft),
            CommitDraft: ("commit_draft", self._commit_draft),
            DiscardDraft: ("discard_draft", self._discard_draft),
            RestoreForward: ("restore_forward", self._restore_forward),
        }
        route = routes.get(type(command))
        if route is None:
            raise TypeError("command must be a supported Piton command")
        operation, handler = route
        self._require(command, type(command), ctx)
        request_digest = self._request_digest(command)
        replay = self._replay(command, ctx, operation, request_digest)
        if replay is not None:
            return replay
        receipt = handler(command, ctx)
        self._store_receipt(command, ctx, operation, request_digest, receipt)
        return receipt

    def delete_project(
        self, cmd: DeleteProject, ctx: PrincipalContext
    ) -> DeletionReceipt:
        receipt = self.execute(cmd, ctx)
        if not isinstance(receipt, DeletionReceipt):
            raise TypeError("delete_project returned a non-deletion receipt")
        return receipt

    def _delete_project(
        self, cmd: DeleteProject, ctx: PrincipalContext
    ) -> DeletionReceipt:
        self._require(cmd, DeleteProject, ctx)
        with self.__database.read() as connection:
            row = connection.execute(
                "SELECT state FROM projects WHERE project_id=?", (cmd.project_id,)
            ).fetchone()
        if row is None or row[0] != cmd.expected_state:
            raise StaleBaseConflictError(
                "project state does not match the destructive command precondition"
            )
        return self.__project_custody.delete_project(cmd.project_id, reason=cmd.reason)

    def create_project(self, cmd: CreateProject, ctx: PrincipalContext) -> CommandReceipt:
        receipt = self.execute(cmd, ctx)
        if not isinstance(receipt, CommandReceipt):
            raise TypeError("create_project returned a non-command receipt")
        return receipt

    def _create_project(self, cmd: CreateProject, ctx: PrincipalContext) -> CommandReceipt:
        self._require(cmd, CreateProject, ctx)
        now = self._now()
        with self.__database.immediate() as connection:
            connection.execute(
                "INSERT INTO projects(project_id, display_name, format_version, state, created_at) "
                "VALUES(?, ?, 1, 'active', ?)",
                (cmd.project_id, cmd.display_name, now),
            )
        return CommandReceipt(cmd.command_id, cmd.project_id, "create_project")

    def import_source_base(
        self, cmd: ImportSourceBase, ctx: PrincipalContext
    ) -> CommandReceipt:
        receipt = self.execute(cmd, ctx)
        if not isinstance(receipt, CommandReceipt):
            raise TypeError("import_source_base returned a non-command receipt")
        return receipt

    def derive_change_candidate(
        self,
        project_id: str,
        proposal: ChangeProposal,
        ctx: PrincipalContext,
    ) -> DesignRevision:
        """Derive a review candidate from the daemon-custodied workspace head.

        Adapters cannot assert which revision is current. The service reads the
        workspace pointer from trusted storage, binds the proposal to that exact
        revision, and only then invokes the pure one-parameter derivation. This
        operation neither persists the candidate nor moves a channel.
        """
        self._require(proposal, ChangeProposal, ctx)
        if not isinstance(project_id, str) or not project_id:
            raise ValueError("project_id must not be empty")
        with self.__database.immediate() as connection:
            current = connection.execute(
                "SELECT pointer.revision_id, revision.manifest_digest "
                "FROM channel_pointers AS pointer "
                "JOIN design_revisions AS revision "
                "ON revision.project_id=pointer.project_id "
                "AND revision.revision_id=pointer.revision_id "
                "WHERE pointer.project_id=? AND pointer.channel='workspace'",
                (project_id,),
            ).fetchone()
            if current is None or current[0] != proposal.base_revision_id:
                raise StaleBaseConflictError(
                    "proposal base is not the daemon-custodied workspace head"
                )
            with self.__blobs.open_verified(current[1]) as stream:
                manifest = json.load(stream)
            base_revision = DesignRevision.from_manifest(manifest)
            if base_revision.revision_id != current[0]:
                raise RuntimeError("custodied workspace revision failed exact readback")
            return _derive_change_candidate(base_revision, proposal)

    def _import_source_base(
        self, cmd: ImportSourceBase, ctx: PrincipalContext
    ) -> CommandReceipt:
        self._require(cmd, ImportSourceBase, ctx)
        with self.__database.read() as connection:
            existing = connection.execute(
                "SELECT revision_id, generation FROM channel_pointers "
                "WHERE project_id=? AND channel='workspace'",
                (cmd.project_id,),
            ).fetchone()
        if existing is not None:
            raise StaleDraftBaseError("workspace already has an imported source base")
        self.__repository.publish_source_tree(
            cmd.project_id, cmd.source_tree, capability=self.__mutation_capability
        )
        revision = self._revision(None, cmd.source_tree, cmd.parameter_values)
        self.__repository.persist_revision(
            cmd.project_id, revision, capability=self.__mutation_capability
        )
        self.__repository.move_channel(
            cmd.project_id,
            "workspace",
            revision.revision_id,
            expected_revision_id=None,
            expected_generation=0,
            capability=self.__mutation_capability,
        )
        return self._command_receipt(cmd.command_id, cmd.project_id, "import_source_base", revision)

    def begin_draft(self, cmd: BeginDraft, ctx: PrincipalContext) -> DraftReceipt:
        receipt = self.execute(cmd, ctx)
        if not isinstance(receipt, DraftReceipt):
            raise TypeError("begin_draft returned a non-draft receipt")
        return receipt

    def _begin_draft(self, cmd: BeginDraft, ctx: PrincipalContext) -> DraftReceipt:
        self._require(cmd, BeginDraft, ctx)
        self._require_workspace(
            cmd.project_id, cmd.base_revision_id, cmd.expected_generation
        )
        source = self._load_source_tree(cmd.project_id, cmd.base_revision_id)
        record = self.__drafts.begin(
            cmd.project_id,
            cmd.base_revision_id,
            cmd.expected_generation,
            source,
        )
        return self._draft_receipt(cmd.command_id, record)

    def update_draft(self, cmd: UpdateDraft, ctx: PrincipalContext) -> DraftReceipt:
        receipt = self.execute(cmd, ctx)
        if not isinstance(receipt, DraftReceipt):
            raise TypeError("update_draft returned a non-draft receipt")
        return receipt

    def _update_draft(self, cmd: UpdateDraft, ctx: PrincipalContext) -> DraftReceipt:
        self._require(cmd, UpdateDraft, ctx)
        current = self.__drafts.load(cmd.draft_id)
        if current.project_id != cmd.project_id:
            raise ValueError("draft does not belong to the exact project")
        updated = self.__drafts.update(cmd.draft_id, cmd.source_tree)
        return self._draft_receipt(cmd.command_id, updated)

    def commit_draft(self, cmd: CommitDraft, ctx: PrincipalContext) -> CommandReceipt:
        receipt = self.execute(cmd, ctx)
        if not isinstance(receipt, CommandReceipt):
            raise TypeError("commit_draft returned a non-command receipt")
        return receipt

    def _commit_draft(self, cmd: CommitDraft, ctx: PrincipalContext) -> CommandReceipt:
        self._require(cmd, CommitDraft, ctx)
        draft = self.__drafts.load(cmd.draft_id)
        if draft.project_id != cmd.project_id:
            raise ValueError("draft does not belong to the exact project")
        if (
            draft.base_revision_id != cmd.expected_revision_id
            or draft.base_generation != cmd.expected_generation
        ):
            raise StaleDraftBaseError("command does not match the draft's exact base")
        self._require_workspace(
            cmd.project_id, cmd.expected_revision_id, cmd.expected_generation
        )
        source = self.__drafts.load_tree(cmd.draft_id)
        revision = self._revision(cmd.expected_revision_id, source, cmd.parameter_values)
        try:
            self.__repository._commit_source_tree_revision_to_channel(
                cmd.project_id,
                source,
                revision,
                "workspace",
                expected_revision_id=cmd.expected_revision_id,
                expected_generation=cmd.expected_generation,
                capability=self.__mutation_capability,
            )
        except ChannelConflictError as error:
            raise StaleDraftBaseError("workspace changed before commit") from error
        self.__drafts.discard(cmd.draft_id)
        return self._command_receipt(cmd.command_id, cmd.project_id, "commit_draft", revision)

    def discard_draft(self, cmd: DiscardDraft, ctx: PrincipalContext) -> DraftReceipt:
        receipt = self.execute(cmd, ctx)
        if not isinstance(receipt, DraftReceipt):
            raise TypeError("discard_draft returned a non-draft receipt")
        return receipt

    def _discard_draft(self, cmd: DiscardDraft, ctx: PrincipalContext) -> DraftReceipt:
        self._require(cmd, DiscardDraft, ctx)
        record = self.__drafts.load(cmd.draft_id)
        if record.project_id != cmd.project_id:
            raise ValueError("draft does not belong to the exact project")
        discarded = self.__drafts.discard(cmd.draft_id)
        return self._draft_receipt(cmd.command_id, discarded)

    def restore_forward(self, cmd: RestoreForward, ctx: PrincipalContext) -> CommandReceipt:
        receipt = self.execute(cmd, ctx)
        if not isinstance(receipt, CommandReceipt):
            raise TypeError("restore_forward returned a non-command receipt")
        return receipt

    def _restore_forward(self, cmd: RestoreForward, ctx: PrincipalContext) -> CommandReceipt:
        self._require(cmd, RestoreForward, ctx)
        self._require_workspace(
            cmd.project_id, cmd.expected_revision_id, cmd.expected_generation
        )
        source = self._load_source_tree(cmd.project_id, cmd.target_revision_id)
        target = self._load_revision(cmd.project_id, cmd.target_revision_id)
        revision = self._revision(
            cmd.expected_revision_id, source, target.parameter_values
        )
        try:
            self.__repository._commit_source_tree_revision_to_channel(
                cmd.project_id,
                source,
                revision,
                "workspace",
                expected_revision_id=cmd.expected_revision_id,
                expected_generation=cmd.expected_generation,
                capability=self.__mutation_capability,
            )
        except ChannelConflictError as error:
            raise StaleDraftBaseError("workspace changed before restore-forward") from error
        return self._command_receipt(cmd.command_id, cmd.project_id, "restore_forward", revision)

    def expire_drafts(self) -> tuple[str, ...]:
        """Crash/maintenance cleanup creates no committed-work claim."""
        return self.__drafts.recover_after_crash()

    def _require_workspace(
        self, project_id: str, expected_revision_id: str, expected_generation: int
    ) -> None:
        with self.__database.read() as connection:
            current = connection.execute(
                "SELECT revision_id, generation FROM channel_pointers "
                "WHERE project_id=? AND channel='workspace'",
                (project_id,),
            ).fetchone()
        if current is None or tuple(current) != (expected_revision_id, expected_generation):
            raise StaleDraftBaseError("workspace expected head or generation is stale")

    def _load_source_tree(self, project_id: str, revision_id: str) -> SourceTree:
        revision = self._load_revision(project_id, revision_id)
        with self.__blobs.open_verified(revision.source_manifest_digest) as stream:
            manifest = json.load(stream)
        files: list[SourceTreeFile] = []
        for claim in manifest["files"]:
            with self.__blobs.open_verified(
                claim["digest"], expected_size=claim["byte_length"]
            ) as stream:
                content = stream.read()
            files.append(SourceTreeFile(claim["path"], content, claim["media_type"]))
        tree = SourceTree(
            files=tuple(files),
            entrypoint=manifest["entrypoint"],
            dependency_lock=manifest["dependency_lock"],
            toolchain_lock=manifest["toolchain_lock"],
        )
        if tree.digest != revision.source_manifest_digest:
            raise ValueError("immutable source tree failed canonical readback")
        return tree

    def _load_revision(self, project_id: str, revision_id: str) -> DesignRevision:
        with self.__database.read() as connection:
            row = connection.execute(
                "SELECT manifest_digest FROM design_revisions "
                "WHERE project_id=? AND revision_id=?",
                (project_id, revision_id),
            ).fetchone()
        if row is None:
            raise ValueError("revision is not in the exact project")
        with self.__blobs.open_verified(row[0]) as stream:
            manifest = json.load(stream)
        return DesignRevision.from_manifest(manifest)

    @staticmethod
    def _revision(
        parent_revision_id: str | None,
        tree: SourceTree,
        parameters: Mapping[str, str],
    ) -> DesignRevision:
        by_path = {item.path: item for item in tree.files}
        return DesignRevision(
            parent_revision_id=parent_revision_id,
            source_manifest_digest=tree.digest,
            entrypoint=tree.entrypoint,
            dependency_lock_digest=by_path[tree.dependency_lock].digest,
            toolchain_lock_digest=by_path[tree.toolchain_lock].digest,
            parameter_values=parameters,
        )

    @staticmethod
    def _canonical_value(value: object) -> object:
        if isinstance(value, SourceTree):
            return {"source_tree_digest": value.digest}
        if isinstance(value, Mapping):
            return {
                key: PitonApplicationService._canonical_value(value[key])
                for key in sorted(value)
            }
        if isinstance(value, tuple):
            return [PitonApplicationService._canonical_value(item) for item in value]
        if is_dataclass(value) and not isinstance(value, type):
            return {
                field.name: PitonApplicationService._canonical_value(
                    getattr(value, field.name)
                )
                for field in fields(value)
            }
        if value is None or isinstance(value, (str, int, bool)):
            return value
        raise TypeError(f"unsupported canonical command value: {type(value).__name__}")

    @classmethod
    def _request_digest(cls, command: object) -> str:
        payload = {
            "command_type": type(command).__name__,
            "command": cls._canonical_value(command),
        }
        encoded = json.dumps(
            payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False
        ).encode("utf-8")
        return "sha256:" + hashlib.sha256(encoded).hexdigest()

    def _replay(
        self,
        command: object,
        ctx: PrincipalContext,
        operation: str,
        request_digest: str,
    ) -> CommandReceipt | DraftReceipt | DeletionReceipt | None:
        command_id = getattr(command, "command_id")
        project_id = getattr(command, "project_id")
        with self.__database.read() as connection:
            row = connection.execute(
                "SELECT r.project_id, r.actor_id, r.kind, r.request_digest, "
                "r.receipt_json, k.operation, k.idempotency_key "
                "FROM command_receipts AS r "
                "JOIN idempotency_keys AS k ON k.receipt_id=r.receipt_id "
                "WHERE r.command_id=?",
                (command_id,),
            ).fetchone()
        if row is None:
            return None
        identity = (
            row[0] == project_id
            and row[1] == ctx.principal_id
            and row[3] == request_digest
            and row[2] == operation
            and row[5] == operation
            and row[6] == command_id
        )
        if not identity:
            raise IdempotencyConflictError(
                "idempotency identity is already bound to a different canonical admission"
            )
        payload = json.loads(row[4])
        receipt_type = payload.pop("receipt_type", None)
        if receipt_type == "CommandReceipt":
            receipt: CommandReceipt | DraftReceipt | DeletionReceipt = CommandReceipt(**payload)
        elif receipt_type == "DraftReceipt":
            receipt = DraftReceipt(**payload)
        elif receipt_type == "DeletionReceipt":
            receipt = DeletionReceipt(**payload)
        else:
            raise RuntimeError("stored command receipt has an unsupported type")
        return receipt

    def _store_receipt(
        self,
        command: object,
        ctx: PrincipalContext,
        operation: str,
        request_digest: str,
        receipt: CommandReceipt | DraftReceipt | DeletionReceipt,
    ) -> None:
        command_id = getattr(command, "command_id")
        project_id = getattr(command, "project_id")
        kind = receipt.kind if isinstance(receipt, CommandReceipt) else operation
        payload = asdict(receipt)
        payload["receipt_type"] = type(receipt).__name__
        receipt_json = json.dumps(
            payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False
        ).encode("utf-8")
        identity = f"{command_id}\0{project_id}\0{ctx.principal_id}".encode("utf-8")
        receipt_id = "receipt_" + hashlib.sha256(identity).hexdigest()
        now = self._now()
        with self.__database.immediate() as connection:
            connection.execute(
                "INSERT INTO command_receipts(receipt_id, command_id, project_id, actor_id, "
                "kind, request_digest, outcome, receipt_json, committed_at) "
                "VALUES(?, ?, ?, ?, ?, ?, 'applied', ?, ?)",
                (
                    receipt_id,
                    command_id,
                    project_id,
                    ctx.principal_id,
                    kind,
                    request_digest,
                    receipt_json,
                    now,
                ),
            )
            connection.execute(
                "INSERT INTO idempotency_keys(project_id, actor_id, operation, "
                "idempotency_key, request_digest, receipt_id, created_at) "
                "VALUES(?, ?, ?, ?, ?, ?, ?)",
                (
                    project_id,
                    ctx.principal_id,
                    operation,
                    command_id,
                    request_digest,
                    receipt_id,
                    now,
                ),
            )

    @staticmethod
    def _require_context(ctx: PrincipalContext | None) -> None:
        if (
            type(ctx) is not PrincipalContext
            or getattr(ctx, "_proof", None) is not _PRINCIPAL_PROOF
        ):
            raise TypeError("trusted PrincipalContext is required")

    @staticmethod
    def _require(command: object, expected_type: type, ctx: PrincipalContext) -> None:
        if not isinstance(command, expected_type):
            raise TypeError(f"command must be {expected_type.__name__}")
        PitonApplicationService._require_context(ctx)

    @staticmethod
    def _draft_receipt(command_id: str, record: DraftRecord) -> DraftReceipt:
        return DraftReceipt(
            command_id,
            record.project_id,
            record.draft_id,
            record.base_revision_id,
            record.content_digest,
            record.expires_at,
        )

    @staticmethod
    def _command_receipt(
        command_id: str, project_id: str, kind: str, revision: DesignRevision
    ) -> CommandReceipt:
        return CommandReceipt(
            command_id,
            project_id,
            kind,
            persisted_revision_id=revision.revision_id,
            parent_revision_id=revision.parent_revision_id,
            source_manifest_digest=revision.source_manifest_digest,
        )

    @staticmethod
    def _now() -> str:
        return datetime.now(UTC).isoformat(timespec="microseconds").replace("+00:00", "Z")


_authorize_project_custody_factory(PitonApplicationService.__init__.__code__)
del _authorize_project_custody_factory
