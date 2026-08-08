import errno
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from piton.storage.blobs import BlobStore, CustodyError


class BlobPublicationFaultTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.project_root = Path(self.temporary_directory.name)
        self.store = BlobStore(self.project_root)

    def tearDown(self):
        self.temporary_directory.cleanup()

    def test_short_writes_are_completed_without_changing_digest(self):
        real_write = os.write

        def short_write(fd, data):
            return real_write(fd, data[: max(1, min(2, len(data)))])

        with mock.patch("piton.storage.blobs.os.write", side_effect=short_write):
            staged = self.store.stage_stream(
                "attempt", "artifact", [b"abcdefgh"],
                media_type="application/octet-stream", max_bytes=8,
            )
        reference = self.store.promote_no_clobber(staged)
        with self.store.open_verified(reference.digest, expected_size=8) as stream:
            self.assertEqual(b"abcdefgh", stream.read())

    def test_disk_full_removes_partial_staging_and_publishes_nothing(self):
        with mock.patch(
            "piton.storage.blobs.os.write",
            side_effect=OSError(errno.ENOSPC, "injected disk full"),
        ):
            with self.assertRaises(OSError):
                self.store.stage_stream(
                    "attempt", "artifact", [b"payload"],
                    media_type="application/octet-stream", max_bytes=10,
                )
        scope = self.store.staging_root / "attempt"
        self.assertEqual([], list(scope.iterdir()))
        self.assertEqual([], [path for path in self.store.objects_root.rglob("*") if path.is_file()])

    def test_interrupted_atomic_link_retains_staged_bytes_and_no_object(self):
        staged = self.store.stage_stream(
            "attempt", "artifact", [b"payload"],
            media_type="application/octet-stream", max_bytes=10,
        )
        with mock.patch(
            "piton.storage.blobs.os.link",
            side_effect=OSError(errno.EIO, "injected link interruption"),
        ):
            with self.assertRaises(OSError):
                self.store.promote_no_clobber(staged)
        self.assertTrue(staged.path.exists())
        self.assertFalse(self.store.object_path(staged.digest).exists())

    def test_parent_fsync_failure_never_reports_publication_success(self):
        staged = self.store.stage_stream(
            "attempt", "artifact", [b"payload"],
            media_type="application/octet-stream", max_bytes=10,
        )
        real_fsync = os.fsync
        calls = 0

        def fail_destination_parent(fd):
            nonlocal calls
            calls += 1
            if calls == 3:  # shard mkdir, promoted file, then destination parent
                raise OSError(errno.EIO, "injected parent fsync failure")
            return real_fsync(fd)

        with mock.patch("piton.storage.blobs.os.fsync", side_effect=fail_destination_parent):
            with self.assertRaises(OSError):
                self.store.promote_no_clobber(staged)
        # Atomic install may have happened, but failure cannot be mistaken for closure.
        self.assertTrue(staged.path.exists())
        self.assertTrue(self.store.exists_verified(staged.digest))

    def test_filesystem_mismatch_blocks_before_staging(self):
        real_stat = os.stat

        def mismatched_stat(path, *args, **kwargs):
            result = real_stat(path, *args, **kwargs)
            if Path(path) == self.store.staging_root:
                values = list(result)
                values[2] = result.st_dev + 1
                return os.stat_result(values)
            return result

        with mock.patch("piton.storage.blobs.os.stat", side_effect=mismatched_stat):
            with self.assertRaisesRegex(CustodyError, "one filesystem"):
                self.store.stage_stream(
                    "attempt", "artifact", [b"payload"],
                    media_type="application/octet-stream", max_bytes=10,
                )


if __name__ == "__main__":
    unittest.main()
