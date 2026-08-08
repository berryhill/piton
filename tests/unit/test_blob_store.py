import hashlib
import io
import os
import tempfile
import unittest
from pathlib import Path

from piton.storage.blobs import BlobCollisionError, BlobStore, BlobValidationError, CustodyError


class BlobStoreTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.project_root = Path(self.temporary_directory.name)
        self.store = BlobStore(self.project_root)

    def tearDown(self):
        self.temporary_directory.cleanup()

    def test_stage_and_promote_uses_digest_derived_immutable_path(self):
        payload = b"source-native geometry\n"
        staged = self.store.stage_stream(
            "attempt-1", "source", [payload[:8], payload[8:]],
            media_type="application/octet-stream", max_bytes=1024,
        )
        expected = "sha256:" + hashlib.sha256(payload).hexdigest()
        self.assertEqual(expected, staged.digest)
        artifact = self.store.promote_no_clobber(staged)
        self.assertEqual(expected, artifact.digest)
        self.assertEqual(len(payload), artifact.byte_length)
        self.assertEqual(
            Path(".piton/objects/sha256") / expected[7:9] / expected[9:],
            Path(artifact.storage_relpath),
        )
        with self.store.open_verified(expected, expected_size=len(payload)) as stream:
            self.assertEqual(payload, stream.read())
        self.assertFalse(staged.path.exists())

    def test_duplicate_matching_object_is_idempotent_and_never_replaced(self):
        first = self.store.stage_stream(
            "attempt-1", "artifact", [b"same"],
            media_type="application/octet-stream", max_bytes=10,
        )
        first_ref = self.store.promote_no_clobber(first)
        object_path = self.project_root / first_ref.storage_relpath
        inode = object_path.stat().st_ino
        second = self.store.stage_stream(
            "attempt-2", "artifact", [b"same"],
            media_type="application/octet-stream", max_bytes=10,
        )
        second_ref = self.store.promote_no_clobber(second)
        self.assertEqual(first_ref, second_ref)
        self.assertEqual(inode, object_path.stat().st_ino)

    def test_mismatching_preexisting_destination_fails_closed_and_quarantines(self):
        staged = self.store.stage_stream(
            "attempt-1", "artifact", [b"expected"],
            media_type="application/octet-stream", max_bytes=20,
        )
        destination = self.store.object_path(staged.digest)
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(b"collision")
        with self.assertRaises(BlobCollisionError):
            self.store.promote_no_clobber(staged)
        self.assertEqual(b"collision", destination.read_bytes())
        self.assertFalse(staged.path.exists())
        self.assertTrue(any(self.store.quarantine_root.rglob("*")))

    def test_staged_bytes_are_independently_revalidated(self):
        staged = self.store.stage_stream(
            "attempt-1", "artifact", [b"original"],
            media_type="application/octet-stream", max_bytes=20,
        )
        staged.path.chmod(0o600)
        staged.path.write_bytes(b"tampered")
        with self.assertRaises(BlobValidationError):
            self.store.validate_staged(staged)
        with self.assertRaises(BlobValidationError):
            self.store.promote_no_clobber(staged)
        self.assertFalse(self.store.object_path(staged.digest).exists())

    def test_malformed_digest_and_path_traversal_fail_closed(self):
        invalid_digests = ["sha256:ABC", "sha512:" + "0" * 64, "../object", "0" * 64]
        for digest in invalid_digests:
            with self.subTest(digest=digest):
                with self.assertRaises(ValueError):
                    self.store.object_path(digest)
        for value in ("../escape", "a/b", ".", ""):
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    self.store.stage_stream(
                        value, "role", [b"x"],
                        media_type="application/octet-stream", max_bytes=1,
                    )

    def test_stream_is_bounded_and_requires_bytes(self):
        with self.assertRaises(BlobValidationError):
            self.store.stage_stream(
                "attempt", "role", [b"123", b"456"],
                media_type="application/octet-stream", max_bytes=5,
            )
        with self.assertRaises(TypeError):
            self.store.stage_stream(
                "attempt", "role", ["not-bytes"],
                media_type="application/octet-stream", max_bytes=20,
            )

    def test_media_signature_and_expected_claims_are_validated(self):
        staged = self.store.stage_stream(
            "attempt", "step", [b"not a STEP file"],
            media_type="model/step", max_bytes=100,
        )
        with self.assertRaises(BlobValidationError):
            self.store.validate_staged(staged)
        valid = self.store.stage_stream(
            "attempt", "step", [b"ISO-10303-21;\nEND-ISO-10303-21;\n"],
            media_type="model/step", max_bytes=100,
        )
        with self.assertRaises(BlobValidationError):
            self.store.validate_staged(valid, expected_size=1)
        with self.assertRaises(BlobValidationError):
            self.store.validate_staged(valid, expected_digest="sha256:" + "0" * 64)

    def test_symlinked_staged_file_is_rejected(self):
        staged = self.store.stage_stream(
            "attempt", "role", [b"held"],
            media_type="application/octet-stream", max_bytes=10,
        )
        staged.path.unlink()
        staged.path.symlink_to(self.project_root / "outside")
        with self.assertRaises(CustodyError):
            self.store.validate_staged(staged)

    def test_symlinked_digest_shard_cannot_redirect_publication(self):
        staged = self.store.stage_stream(
            "attempt", "role", [b"held"],
            media_type="application/octet-stream", max_bytes=10,
        )
        shard = self.store.object_path(staged.digest).parent
        outside = self.project_root / "outside"
        outside.mkdir()
        shard.symlink_to(outside, target_is_directory=True)
        with self.assertRaises(CustodyError):
            self.store.promote_no_clobber(staged)
        self.assertEqual([], list(outside.iterdir()))
        self.assertTrue(staged.path.exists())

    def test_open_verified_detects_object_corruption(self):
        staged = self.store.stage_stream(
            "attempt", "role", [b"held"],
            media_type="application/octet-stream", max_bytes=10,
        )
        artifact = self.store.promote_no_clobber(staged)
        object_path = self.project_root / artifact.storage_relpath
        object_path.chmod(0o600)
        object_path.write_bytes(b"evil")
        with self.assertRaises(BlobValidationError):
            self.store.open_verified(artifact.digest)
        self.assertFalse(self.store.exists_verified(artifact.digest))


if __name__ == "__main__":
    unittest.main()
