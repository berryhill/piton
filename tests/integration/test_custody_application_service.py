"""Acceptance tests for the sole daemon-owned custody command boundary."""

from __future__ import annotations

import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from piton import ChangeProposal
from piton.model import _derive_change_candidate
from piton.service.application import (
    IdempotencyConflictError,
    PitonApplicationService,
    StaleBaseConflictError,
    StaleDraftBaseError,
    _issue_principal_context,
)
from piton.service.commands import (
    BeginDraft,
    CommitDraft,
    CreateProject,
    DiscardDraft,
    ImportSourceBase,
    UpdateDraft,
)
from piton.source_tree import SourceTree, SourceTreeFile
from piton.storage.db import Database
from piton.storage.revisions import RevisionRepository


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


class CustodyApplicationServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self.service = PitonApplicationService.open(self.root)
        self.context = _issue_principal_context("operator_one")
        self.service.create_project(CreateProject("cmd_create", "project_one", "One"), self.context)
        self.base = self.service.import_source_base(
            ImportSourceBase("cmd_import", "project_one", tree(), {"height": "10 mm"}),
            self.context,
        )

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def counts(self) -> tuple[int, int, int, int]:
        database = Database(self.root / ".piton" / "piton.sqlite3")
        with database.read() as connection:
            return tuple(
                connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
                for table in ("design_revisions", "channel_pointers", "artifacts", "outbox")
            )

    def receipt_count(self) -> int:
        database = Database(self.root / ".piton" / "piton.sqlite3")
        with database.read() as connection:
            return connection.execute("SELECT count(*) FROM command_receipts").fetchone()[0]

    def test_exact_replay_returns_stored_receipt_without_a_second_effect(self) -> None:
        command = CreateProject("cmd_create_two", "project_two", "Two")

        first = self.service.execute(command, self.context)
        counts_after_first = self.counts()
        receipts_after_first = self.receipt_count()
        second = self.service.create_project(command, self.context)

        self.assertEqual(second, first)
        self.assertEqual(self.counts(), counts_after_first)
        self.assertEqual(self.receipt_count(), receipts_after_first)

    def test_reused_identity_with_changed_request_or_principal_fails_closed(self) -> None:
        command = CreateProject("cmd_create_two", "project_two", "Two")
        receipt = self.service.create_project(command, self.context)
        counts_after_first = self.counts()
        receipts_after_first = self.receipt_count()

        with self.assertRaises(IdempotencyConflictError):
            self.service.execute(
                CreateProject("cmd_create_two", "project_two", "Changed"), self.context
            )
        with self.assertRaises(IdempotencyConflictError):
            self.service.execute(command, _issue_principal_context("operator_two"))

        self.assertEqual(receipt.kind, "create_project")
        self.assertEqual(self.counts(), counts_after_first)
        self.assertEqual(self.receipt_count(), receipts_after_first)

    def test_direct_and_generic_adapter_paths_share_typed_stale_conflicts(self) -> None:
        stale = BeginDraft("cmd_stale", "project_one", self.base.persisted_revision_id, 0)

        for invoke in (self.service.begin_draft, self.service.execute):
            with self.subTest(adapter=invoke.__name__):
                with self.assertRaises(StaleBaseConflictError) as caught:
                    invoke(stale, self.context)
                self.assertIs(type(caught.exception), StaleDraftBaseError)

        self.assertEqual(self.receipt_count(), 2)

    def test_change_candidate_uses_custodied_head_not_caller_asserted_current_state(self) -> None:
        proposal = ChangeProposal(
            proposal_id="proposal_height_11",
            base_revision_id=self.base.persisted_revision_id,
            parameter_id="height",
            expected_old_quantity="10 mm",
            new_quantity="11 mm",
        )

        database = Database(self.root / ".piton" / "piton.sqlite3")
        with database.read() as connection:
            pointer_before = tuple(
                connection.execute(
                    "SELECT revision_id, generation FROM channel_pointers "
                    "WHERE project_id=? AND channel='workspace'",
                    ("project_one",),
                ).fetchone()
            )

        candidate = self.service.derive_change_candidate(
            "project_one", proposal, self.context
        )
        with database.read() as connection:
            pointer_after = tuple(
                connection.execute(
                    "SELECT revision_id, generation FROM channel_pointers "
                    "WHERE project_id=? AND channel='workspace'",
                    ("project_one",),
                ).fetchone()
            )
        self.assertEqual(candidate.parent_revision_id, self.base.persisted_revision_id)
        self.assertEqual(candidate.parameter_values["height"], "11 mm")
        self.assertEqual(pointer_after, pointer_before)
        self.assertEqual(self.counts()[0:2], (1, 1))

        draft = self.service.begin_draft(
            BeginDraft(
                "cmd_begin_advance",
                "project_one",
                self.base.persisted_revision_id,
                1,
            ),
            self.context,
        )
        self.service.commit_draft(
            CommitDraft(
                "cmd_commit_advance",
                "project_one",
                draft.draft_id,
                self.base.persisted_revision_id,
                1,
                {"height": "12 mm"},
            ),
            self.context,
        )

        with self.assertRaisesRegex(StaleBaseConflictError, "custodied workspace head"):
            self.service.derive_change_candidate("project_one", proposal, self.context)

    def test_change_candidate_rejects_cross_project_and_untrusted_context(self) -> None:
        assert self.base.persisted_revision_id is not None
        proposal = ChangeProposal(
            proposal_id="proposal_wrong_custody",
            base_revision_id=self.base.persisted_revision_id,
            parameter_id="height",
            expected_old_quantity="10 mm",
            new_quantity="11 mm",
        )
        self.service.create_project(
            CreateProject("cmd_create_two_for_mutation", "project_two", "Two"),
            self.context,
        )
        self.service.import_source_base(
            ImportSourceBase(
                "cmd_import_two_for_mutation",
                "project_two",
                tree(b"def build():\n    return 2\n"),
                {"height": "10 mm"},
            ),
            self.context,
        )

        with self.assertRaisesRegex(StaleBaseConflictError, "custodied workspace head"):
            self.service.derive_change_candidate("project_two", proposal, self.context)
        with self.assertRaisesRegex(TypeError, "trusted PrincipalContext"):
            self.service.derive_change_candidate("project_one", proposal, object())  # type: ignore[arg-type]

    def test_change_candidate_serializes_head_binding_through_derivation(self) -> None:
        proposal = ChangeProposal(
            proposal_id="proposal_height_serialized",
            base_revision_id=self.base.persisted_revision_id,
            parameter_id="height",
            expected_old_quantity="10 mm",
            new_quantity="11 mm",
        )
        competing_database = Database(
            self.root / ".piton" / "piton.sqlite3", busy_timeout_ms=1
        )

        def derive_while_competing_writer_is_denied(base, change):
            with self.assertRaisesRegex(sqlite3.OperationalError, "locked"):
                with competing_database.immediate() as connection:
                    connection.execute(
                        "UPDATE channel_pointers SET generation=generation+1 "
                        "WHERE project_id=? AND channel='workspace'",
                        ("project_one",),
                    )
            return _derive_change_candidate(base, change)

        with mock.patch(
            "piton.service.application._derive_change_candidate",
            side_effect=derive_while_competing_writer_is_denied,
        ):
            candidate = self.service.derive_change_candidate(
                "project_one", proposal, self.context
            )

        self.assertEqual(candidate.parent_revision_id, self.base.persisted_revision_id)
        self.assertEqual(candidate.parameter_values["height"], "11 mm")

    def test_idempotency_identity_and_receipt_rows_are_immutable(self) -> None:
        database = Database(self.root / ".piton" / "piton.sqlite3")

        for statement in (
            "UPDATE command_receipts SET outcome='rejected' WHERE command_id='cmd_create'",
            "DELETE FROM command_receipts WHERE command_id='cmd_create'",
            "UPDATE idempotency_keys SET request_digest='changed' WHERE idempotency_key='cmd_create'",
            "DELETE FROM idempotency_keys WHERE idempotency_key='cmd_create'",
        ):
            with self.subTest(statement=statement):
                with self.assertRaisesRegex(sqlite3.IntegrityError, "immutable"):
                    with database.immediate() as connection:
                        connection.execute(statement)

        self.assertEqual(self.receipt_count(), 2)

    def test_draft_lifecycle_does_not_claim_committed_work(self) -> None:
        before = self.counts()
        draft = self.service.begin_draft(
            BeginDraft("cmd_begin", "project_one", self.base.persisted_revision_id, 1), self.context
        )
        changed = tree(b"def build():\n    return 1\n")
        self.service.update_draft(
            UpdateDraft("cmd_update", "project_one", draft.draft_id, changed), self.context
        )
        discarded = self.service.discard_draft(
            DiscardDraft("cmd_discard", "project_one", draft.draft_id), self.context
        )

        self.assertEqual(self.counts(), before)
        self.assertIsNone(discarded.persisted_revision_id)
        self.assertFalse(discarded.fabrication_release)
        self.assertFalse(discarded.machine_actuation)
        self.assertEqual(discarded.review_state, "needs_human_review")

    def test_commit_revalidates_tree_creates_one_child_and_cas_moves_workspace(self) -> None:
        draft = self.service.begin_draft(
            BeginDraft("cmd_begin", "project_one", self.base.persisted_revision_id, 1), self.context
        )
        changed = tree(b"def build():\n    return 1\n")
        updated = self.service.update_draft(
            UpdateDraft("cmd_update", "project_one", draft.draft_id, changed), self.context
        )

        command = CommitDraft(
            "cmd_commit",
            "project_one",
            draft.draft_id,
            self.base.persisted_revision_id,
            1,
            {"height": "11 mm"},
        )
        committed = self.service.commit_draft(command, self.context)

        self.assertIsNotNone(committed.persisted_revision_id)
        self.assertEqual(committed.parent_revision_id, self.base.persisted_revision_id)
        self.assertEqual(committed.source_manifest_digest, updated.content_digest)
        self.assertFalse(committed.fabrication_release)
        self.assertFalse(committed.machine_actuation)
        self.assertEqual(committed.review_state, "needs_human_review")
        with Database(self.root / ".piton" / "piton.sqlite3").read() as connection:
            rows = connection.execute(
                "SELECT revision_id, parent_revision_id FROM design_revisions ORDER BY created_at"
            ).fetchall()
            workspace = connection.execute(
                "SELECT revision_id, generation FROM channel_pointers WHERE project_id=? AND channel='workspace'",
                ("project_one",),
            ).fetchone()
        self.assertEqual(len(rows), 2)
        self.assertEqual(tuple(rows[-1]), (committed.persisted_revision_id, self.base.persisted_revision_id))
        self.assertEqual(tuple(workspace), (committed.persisted_revision_id, 2))
        self.assertFalse((self.root / ".piton" / "staging" / ("draft_" + draft.draft_id)).exists())

        durable_counts = self.counts()
        durable_receipts = self.receipt_count()
        reopened = PitonApplicationService.open(self.root)
        replay = reopened.execute(command, self.context)
        self.assertEqual(replay, committed)
        self.assertEqual(self.counts(), durable_counts)
        self.assertEqual(self.receipt_count(), durable_receipts)

    def test_stale_commit_fails_before_publication_and_preserves_history(self) -> None:
        draft = self.service.begin_draft(
            BeginDraft("cmd_begin", "project_one", self.base.persisted_revision_id, 1), self.context
        )
        self.service.update_draft(
            UpdateDraft("cmd_update", "project_one", draft.draft_id, tree(b"def build():\n    return 2\n")),
            self.context,
        )
        before = self.counts()

        with self.assertRaises(StaleDraftBaseError):
            self.service.commit_draft(
                CommitDraft(
                    "cmd_commit", "project_one", draft.draft_id, self.base.persisted_revision_id, 0, {}
                ),
                self.context,
            )

        self.assertEqual(self.counts(), before)

    def test_publication_failure_rolls_back_every_durable_metadata_claim(self) -> None:
        draft = self.service.begin_draft(
            BeginDraft("cmd_begin", "project_one", self.base.persisted_revision_id, 1), self.context
        )
        self.service.update_draft(
            UpdateDraft(
                "cmd_update",
                "project_one",
                draft.draft_id,
                tree(b"def build():\n    return 3\n"),
            ),
            self.context,
        )
        before = self.counts()

        with mock.patch.object(
            RevisionRepository,
            "_record_artifact",
            side_effect=RuntimeError("simulated metadata publication failure"),
        ):
            with self.assertRaisesRegex(RuntimeError, "simulated metadata"):
                self.service.commit_draft(
                    CommitDraft(
                        "cmd_commit",
                        "project_one",
                        draft.draft_id,
                        self.base.persisted_revision_id,
                        1,
                        {},
                    ),
                    self.context,
                )

        self.assertEqual(self.counts(), before)

    def test_command_payload_cannot_mint_principal_or_mutation_authority(self) -> None:
        with self.assertRaises(TypeError):
            self.service.create_project(
                CreateProject("cmd_forged", "project_two", "Two"), "operator_one"  # type: ignore[arg-type]
            )
        self.assertFalse(hasattr(self.service, "database"))
        self.assertFalse(hasattr(self.service, "blobs"))
        self.assertFalse(hasattr(self.service, "repository"))
        self.assertFalse(hasattr(self.service, "mutation_capability"))
        self.assertFalse(hasattr(self.service, "issue_principal_context"))


if __name__ == "__main__":
    unittest.main()
