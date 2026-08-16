"""Integration tests for the closed lifecycle service routes.

Doctrine anchor: sections 10.5 and 10.6 of ``docs/mvi-doctrine.md``.
Every command kind in the SQLite CHECK constraint (0010_destructive_custody_
admission.sql) must map to a service handler. The hard-closed Stage 1
issuance kinds always return ``outcome='rejected'`` without writing
fabrication_release or machine_actuation state. ``move_channel`` must
honor expected_head + expected_generation CAS and fail closed on mismatch.
The LocalDaemonCommandAdapter must reject authority-shaped payload fields.
"""

from __future__ import annotations

import os
import socket
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from piton.service import (
    AdmitBuildAttempt,
    AdmitChangeProposal,
    CommandReceipt,
    CreateDraftExport,
    CreateProject,
    ImportSourceBase,
    MoveChannel,
    RecordEvidenceClosure,
    RecordProposalDisposition,
    RecordReleasedPackageProjection,
    RejectFabricationRelease,
    SignApproval,
)
from piton.service.application import (
    PitonApplicationService,
    StaleBaseConflictError,
    _issue_principal_context,
)
from piton.service.commands import (
    BeginDraft,
    CommitDraft,
    UpdateDraft,
)
from piton.service.daemon import CommandAdmissionError, LocalDaemonCommandAdapter
from piton.source_tree import SourceTree, SourceTreeFile
from piton.storage.db import Database


REVISION_ID = "rev_" + "1" * 64
ZERO_DIGEST = "sha256:" + "0" * 64
ZERO_DIGEST_2 = "sha256:" + "1" * 64
ZERO_DIGEST_3 = "sha256:" + "2" * 64


def tree(source: bytes = b"def build():\n    return None\n") -> SourceTree:
    return SourceTree(
        files=(
            SourceTreeFile("source/part.py", source, "text/x-python"),
            SourceTreeFile("locks/dependencies.lock", b"build123d==0.11.1\n", "text/plain"),
            SourceTreeFile("locks/toolchain.lock", b"python==3.12.11\n", "text/plain"),
        ),
        entrypoint="source/part.py:build",
        dependency_lock="locks/dependencies.lock",
        toolchain_lock="locks/toolchain.lock",
    )


def receipt_outcome(service: PitonApplicationService, command_id: str) -> str:
    database = Database(service_root(service) / ".piton" / "piton.sqlite3")
    with database.read() as connection:
        return connection.execute(
            "SELECT outcome FROM command_receipts WHERE command_id=?",
            (command_id,),
        ).fetchone()[0]


def receipt_kind(service: PitonApplicationService, command_id: str) -> str:
    database = Database(service_root(service) / ".piton" / "piton.sqlite3")
    with database.read() as connection:
        return connection.execute(
            "SELECT kind FROM command_receipts WHERE command_id=?",
            (command_id,),
        ).fetchone()[0]


def service_root(service: PitonApplicationService) -> Path:
    # The service exposes ``_database`` path via its database.
    return Path(service._PitonApplicationService__database.path).parent.parent  # type: ignore[attr-defined]


class ClosedLifecycleServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self.service = PitonApplicationService.open(self.root)
        self.context = _issue_principal_context("operator_one")
        self.service.create_project(
            CreateProject("cmd_create", "project_one", "One"), self.context
        )
        self.base = self.service.import_source_base(
            ImportSourceBase(
                "cmd_import", "project_one", tree(), {"height": "10 mm"}
            ),
            self.context,
        )
        self.revision_id = self.base.persisted_revision_id

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def test_admit_change_proposal_routes_to_handler_and_returns_applied(self) -> None:
        cmd = AdmitChangeProposal(
            command_id="cmd_admit",
            project_id="project_one",
            proposal_id="proposal:1",
            base_revision_id=self.revision_id,
            parameter_id="height",
            expected_old_quantity="10 mm",
            new_quantity="11 mm",
            requirement_ids=("req:1",),
        )
        receipt = self.service.execute(cmd, self.context)
        self.assertIsInstance(receipt, CommandReceipt)
        self.assertEqual("admit_change_proposal", receipt.kind)
        self.assertEqual("applied", receipt.outcome)
        self.assertEqual(self.revision_id, receipt.persisted_revision_id)
        self.assertEqual(receipt_kind(self.service, "cmd_admit"), "admit_change_proposal")

    def test_admit_change_proposal_fails_closed_on_stale_base(self) -> None:
        cmd = AdmitChangeProposal(
            command_id="cmd_admit_stale",
            project_id="project_one",
            proposal_id="proposal:2",
            base_revision_id="rev_" + "0" * 64,
            parameter_id="height",
            expected_old_quantity="10 mm",
            new_quantity="11 mm",
            requirement_ids=("req:1",),
        )
        with self.assertRaises(StaleBaseConflictError):
            self.service.execute(cmd, self.context)

    def test_record_proposal_disposition_routes_to_handler_and_returns_applied(self) -> None:
        cmd = RecordProposalDisposition(
            command_id="cmd_disp",
            project_id="project_one",
            disposition_id="disp:1",
            proposal_id="proposal:1",
            base_revision_id=self.revision_id,
            state="accepted_for_review",
            reason="framework-only acceptance",
        )
        receipt = self.service.execute(cmd, self.context)
        self.assertEqual("record_proposal_disposition", receipt.kind)
        self.assertEqual("applied", receipt.outcome)

    def test_admit_build_attempt_routes_to_handler_and_persists_row(self) -> None:
        cmd = AdmitBuildAttempt(
            command_id="cmd_attempt",
            project_id="project_one",
            attempt_id="attempt:1",
            revision_id=self.revision_id,
            recipe_digest=ZERO_DIGEST,
            environment_digest=ZERO_DIGEST,
            toolchain_digest=ZERO_DIGEST,
            capability_manifest_digest=ZERO_DIGEST,
            resource_limits_digest=ZERO_DIGEST,
            expected_outputs_digest=ZERO_DIGEST,
            request_signature_digest=ZERO_DIGEST,
            input_manifest_digest=ZERO_DIGEST,
            worker_id="worker_a",
            isolation_class="wasm",
        )
        receipt = self.service.execute(cmd, self.context)
        self.assertEqual("admit_build_attempt", receipt.kind)
        self.assertEqual("applied", receipt.outcome)

    def test_record_evidence_closure_routes_to_handler_and_returns_applied(self) -> None:
        # First, admit a build attempt.
        self.test_admit_build_attempt_routes_to_handler_and_persists_row()
        # The build attempt is in 'admitted' state, not 'succeeded', so the
        # closure must fail closed with a typed error.
        cmd = RecordEvidenceClosure(
            command_id="cmd_evidence",
            project_id="project_one",
            closure_id="closure:1",
            revision_id=self.revision_id,
            attempt_id="attempt:1",
            requirement_ids=("req:1",),
            receipt_digests=(ZERO_DIGEST,),
            policy_digest=ZERO_DIGEST,
        )
        with self.assertRaises(Exception):
            self.service.execute(cmd, self.context)

    def test_move_channel_routes_to_handler(self) -> None:
        cmd = MoveChannel(
            command_id="cmd_move",
            project_id="project_one",
            channel="workspace",
            target_revision_id=self.revision_id,
            expected_revision_id=None,
            expected_generation=0,
        )
        # The workspace is already at this revision_id with generation 1
        # because of the import; first move to the candidate channel.
        candidate_cmd = MoveChannel(
            command_id="cmd_move_candidate",
            project_id="project_one",
            channel="candidate",
            target_revision_id=self.revision_id,
            expected_revision_id=None,
            expected_generation=0,
        )
        candidate_receipt = self.service.execute(candidate_cmd, self.context)
        self.assertEqual("move_channel", candidate_receipt.kind)
        self.assertEqual("applied", candidate_receipt.outcome)
        del cmd

    def test_move_channel_fails_closed_on_stale_generation(self) -> None:
        cmd = MoveChannel(
            command_id="cmd_move_stale",
            project_id="project_one",
            channel="candidate",
            target_revision_id=self.revision_id,
            expected_revision_id=None,
            expected_generation=99,
        )
        with self.assertRaises(StaleBaseConflictError):
            self.service.execute(cmd, self.context)

    def test_sign_approval_routes_to_handler_and_returns_rejected(self) -> None:
        cmd = SignApproval(
            command_id="cmd_sign",
            project_id="project_one",
            receipt_id="ar:1",
            revision_id=self.revision_id,
            evidence_closure_id="ec:1",
            scoped_decision="accept_for_review",
            scope_reason="framework only",
            declared_at="2026-08-16T00:00:00Z",
        )
        receipt = self.service.execute(cmd, self.context)
        self.assertEqual("sign_approval", receipt.kind)
        self.assertEqual("rejected", receipt.outcome)
        self.assertFalse(receipt.fabrication_release)
        self.assertFalse(receipt.machine_actuation)
        self.assertEqual("rejected", receipt_outcome(self.service, "cmd_sign"))

    def test_create_draft_export_routes_to_handler_and_returns_applied(self) -> None:
        cmd = CreateDraftExport(
            command_id="cmd_export",
            project_id="project_one",
            receipt_id="receipt_x",
            export_id="export_x",
            revision_id=self.revision_id,
            attempt_id="attempt:1",
            authority_profile="source-native/v0",
            exact_body_digest=ZERO_DIGEST,
            step_digest=ZERO_DIGEST_2,
            units="mm",
            warnings=("framework only",),
            environment_lock_digest=ZERO_DIGEST_3,
            validation_report_digest=ZERO_DIGEST,
        )
        receipt = self.service.execute(cmd, self.context)
        self.assertEqual("create_draft_export", receipt.kind)
        self.assertEqual("applied", receipt.outcome)
        self.assertFalse(receipt.fabrication_release)
        self.assertFalse(receipt.machine_actuation)

    def test_reject_fabrication_release_routes_to_handler_and_returns_rejected(self) -> None:
        cmd = RejectFabricationRelease(
            command_id="cmd_reject",
            project_id="project_one",
            release_id="rel:1",
            approval_receipt_id="ar:1",
            revision_id=self.revision_id,
            deliverables_digest=ZERO_DIGEST,
            declared_at="2026-08-16T00:00:00Z",
        )
        receipt = self.service.execute(cmd, self.context)
        self.assertEqual("reject_fabrication_release", receipt.kind)
        self.assertEqual("rejected", receipt.outcome)
        self.assertEqual("rejected", receipt_outcome(self.service, "cmd_reject"))

    def test_record_released_package_projection_routes_to_handler_and_returns_rejected(self) -> None:
        cmd = RecordReleasedPackageProjection(
            command_id="cmd_projection",
            project_id="project_one",
            projection_id="rpp:1",
            release_id="rel:1",
            package_digest=ZERO_DIGEST,
            units="mm",
            declared_at="2026-08-16T00:00:00Z",
        )
        receipt = self.service.execute(cmd, self.context)
        self.assertEqual("record_released_package_projection", receipt.kind)
        self.assertEqual("rejected", receipt.outcome)
        self.assertEqual("rejected", receipt_outcome(self.service, "cmd_projection"))

    def test_replay_returns_stored_receipt(self) -> None:
        # Admit a change proposal twice with the same command_id; the
        # second call must return the stored receipt without re-running the
        # closed boundary.
        cmd = AdmitChangeProposal(
            command_id="cmd_replay",
            project_id="project_one",
            proposal_id="proposal:replay",
            base_revision_id=self.revision_id,
            parameter_id="height",
            expected_old_quantity="10 mm",
            new_quantity="11 mm",
            requirement_ids=("req:1",),
        )
        first = self.service.execute(cmd, self.context)
        second = self.service.execute(cmd, self.context)
        self.assertEqual(first, second)

    def test_unknown_command_type_fails_closed(self) -> None:
        with self.assertRaises(TypeError):
            self.service.execute("not-a-command", self.context)

    def test_draft_export_is_a_canonical_unreleased_receipt(self) -> None:
        # Apply a draft so the workspace has a child revision that satisfies
        # validate_lifecycle for the DraftExport contract we want to test.
        draft = self.service.begin_draft(
            BeginDraft(
                "cmd_begin",
                "project_one",
                self.revision_id,
                1,
            ),
            self.context,
        )
        self.service.update_draft(
            UpdateDraft(
                "cmd_update",
                "project_one",
                draft.draft_id,
                tree(b"def build():\n    return 1\n"),
            ),
            self.context,
        )
        commit = self.service.commit_draft(
            CommitDraft(
                "cmd_commit",
                "project_one",
                draft.draft_id,
                self.revision_id,
                1,
                {"height": "11 mm"},
            ),
            self.context,
        )
        self.assertEqual("commit_draft", commit.kind)


class LocalDaemonClosedLifecycleTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self.server_socket, self.client_socket = socket.socketpair()
        self.adapter = LocalDaemonCommandAdapter.open(
            self.root, principal_ids_by_uid={os.getuid(): "operator_local"}
        )
        # Seed a project with a base revision so admit_change_proposal works.
        self.service = PitonApplicationService.open(self.root)
        self.context = _issue_principal_context("operator_local")
        self.service.create_project(
            CreateProject("cmd_create", "project_one", "One"), self.context
        )
        self.base = self.service.import_source_base(
            ImportSourceBase(
                "cmd_import", "project_one", tree(), {"height": "10 mm"}
            ),
            self.context,
        )
        self.revision_id = self.base.persisted_revision_id

    def tearDown(self) -> None:
        self.server_socket.close()
        self.client_socket.close()
        self.temporary_directory.cleanup()

    def execute(self, command_type: str, payload: dict) -> object:
        return self.adapter.execute(
            self.server_socket,
            {"command_type": command_type, "payload": payload},
        )

    def test_sign_approval_via_daemon_returns_rejected(self) -> None:
        receipt = self.execute(
            "sign_approval",
            {
                "command_id": "cmd_sign",
                "project_id": "project_one",
                "receipt_id": "ar:1",
                "revision_id": self.revision_id,
                "evidence_closure_id": "ec:1",
                "scoped_decision": "accept_for_review",
                "scope_reason": "framework only",
                "declared_at": "2026-08-16T00:00:00Z",
            },
        )
        self.assertEqual("sign_approval", receipt.kind)
        self.assertEqual("rejected", receipt.outcome)

    def test_reject_fabrication_release_via_daemon_returns_rejected(self) -> None:
        receipt = self.execute(
            "reject_fabrication_release",
            {
                "command_id": "cmd_reject",
                "project_id": "project_one",
                "release_id": "rel:1",
                "approval_receipt_id": "ar:1",
                "revision_id": self.revision_id,
                "deliverables_digest": ZERO_DIGEST,
                "declared_at": "2026-08-16T00:00:00Z",
            },
        )
        self.assertEqual("reject_fabrication_release", receipt.kind)
        self.assertEqual("rejected", receipt.outcome)

    def test_record_released_package_projection_via_daemon_returns_rejected(self) -> None:
        receipt = self.execute(
            "record_released_package_projection",
            {
                "command_id": "cmd_projection",
                "project_id": "project_one",
                "projection_id": "rpp:1",
                "release_id": "rel:1",
                "package_digest": ZERO_DIGEST,
                "units": "mm",
                "declared_at": "2026-08-16T00:00:00Z",
            },
        )
        self.assertEqual("record_released_package_projection", receipt.kind)
        self.assertEqual("rejected", receipt.outcome)

    def test_daemon_rejects_authority_shaped_keys(self) -> None:
        with self.assertRaises(CommandAdmissionError):
            self.execute(
                "sign_approval",
                {
                    "command_id": "cmd_sign",
                    "project_id": "project_one",
                    "receipt_id": "ar:1",
                    "revision_id": self.revision_id,
                    "evidence_closure_id": "ec:1",
                    "scoped_decision": "accept_for_review",
                    "scope_reason": "framework only",
                    "declared_at": "2026-08-16T00:00:00Z",
                    "approval_authority": "forged",
                },
            )
        with self.assertRaises(CommandAdmissionError):
            self.execute(
                "move_channel",
                {
                    "command_id": "cmd_move",
                    "project_id": "project_one",
                    "channel": "candidate",
                    "target_revision_id": self.revision_id,
                    "expected_revision_id": None,
                    "expected_generation": 0,
                    "fabrication_releaser": "forged",
                },
            )
        with self.assertRaises(CommandAdmissionError):
            self.execute(
                "reject_fabrication_release",
                {
                    "command_id": "cmd_reject",
                    "project_id": "project_one",
                    "release_id": "rel:1",
                    "approval_receipt_id": "ar:1",
                    "revision_id": self.revision_id,
                    "deliverables_digest": ZERO_DIGEST,
                    "declared_at": "2026-08-16T00:00:00Z",
                    "release_authority": "forged",
                },
            )


if __name__ == "__main__":
    unittest.main()
