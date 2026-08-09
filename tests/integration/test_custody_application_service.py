"""Acceptance tests for the sole daemon-owned custody command boundary."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest import mock

from piton.service.application import (
    PitonApplicationService,
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

        committed = self.service.commit_draft(
            CommitDraft(
                "cmd_commit",
                "project_one",
                draft.draft_id,
                self.base.persisted_revision_id,
                1,
                {"height": "11 mm"},
            ),
            self.context,
        )

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
