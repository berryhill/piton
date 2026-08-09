"""Acceptance tests for transient, non-authoritative draft custody."""

from __future__ import annotations

import os
import tempfile
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path

from piton.service.drafts import DraftExpiredError, DraftStore
from piton.source_tree import SourceTree, SourceTreeFile


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


class TransientDraftTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self.store = DraftStore(self.root, default_ttl_seconds=60)

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def test_begin_and_update_confine_bytes_and_never_create_object_bytes(self) -> None:
        original = tree()
        record = self.store.begin("project_one", "rev_" + "1" * 64, 3, original)

        self.assertEqual(record.scope.name, "draft_" + record.draft_id)
        self.assertEqual(record.scope.parent, self.root / ".piton" / "staging")
        self.assertEqual(self.store.load_tree(record.draft_id).digest, original.digest)
        self.assertFalse((self.root / ".piton" / "objects").exists())

        changed = tree(b"def build():\n    return 1\n")
        updated = self.store.update(record.draft_id, changed)
        self.assertNotEqual(updated.content_digest, record.content_digest)
        self.assertEqual(self.store.load_tree(record.draft_id).digest, changed.digest)
        self.assertTrue(
            all(path.name.startswith("draft_") for path in self.store.staging_root.iterdir())
        )

    def test_discard_removes_only_exact_confined_scope(self) -> None:
        record = self.store.begin("project_one", "rev_" + "1" * 64, 0, tree())
        neighbor = self.root / ".piton" / "staging" / "keep"
        neighbor.mkdir()
        (neighbor / "content").write_bytes(b"keep")

        discarded = self.store.discard(record.draft_id)

        self.assertFalse(record.scope.exists())
        self.assertEqual((neighbor / "content").read_bytes(), b"keep")
        self.assertIsNone(discarded.persisted_revision_id)

    def test_expiry_and_crash_recovery_remove_transient_scopes(self) -> None:
        now = datetime.now(UTC)
        record = self.store.begin(
            "project_one", "rev_" + "1" * 64, 0, tree(), expires_at=now - timedelta(seconds=1)
        )
        with self.assertRaises(DraftExpiredError):
            self.store.load(record.draft_id, now=now)
        self.assertFalse(record.scope.exists())

        survivor = self.store.begin("project_one", "rev_" + "1" * 64, 0, tree())
        recovered = DraftStore(self.root)
        self.assertEqual(recovered.recover_after_crash(), (survivor.draft_id,))
        self.assertFalse(survivor.scope.exists())

    def test_symlink_in_scope_fails_closed_without_following_target(self) -> None:
        record = self.store.begin("project_one", "rev_" + "1" * 64, 0, tree())
        outside = self.root / "outside"
        outside.write_bytes(b"authority")
        os.symlink(outside, record.scope / "escape")

        with self.assertRaisesRegex(Exception, "symbolic link"):
            self.store.discard(record.draft_id)
        self.assertEqual(outside.read_bytes(), b"authority")

    def test_load_rejects_symlinked_parent_even_when_external_bytes_match(self) -> None:
        record = self.store.begin("project_one", "rev_" + "1" * 64, 0, tree())
        outside = self.root / "outside-files"
        (record.scope / "files").rename(outside)
        os.symlink(outside, record.scope / "files")

        with self.assertRaisesRegex(Exception, "symbolic link"):
            self.store.load_tree(record.draft_id)


if __name__ == "__main__":
    unittest.main()
