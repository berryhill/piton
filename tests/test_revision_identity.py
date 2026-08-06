import unittest

from piton.revision import DesignRevision, compute_revision_id

DIGEST = "sha256:" + "0" * 64


def revision(parameters=None):
    return DesignRevision(
        parent_revision_id=None,
        source_manifest_digest=DIGEST,
        entrypoint="part.py:build",
        dependency_lock_digest=DIGEST,
        toolchain_lock_digest=DIGEST,
        parameter_values=parameters or {"height": "10 mm"},
    )


class RevisionIdentityTests(unittest.TestCase):
    def test_manifest_and_identity_are_canonical(self):
        left = revision({"width": "2 mm", "height": "10 mm"})
        right = revision({"height": "10 mm", "width": "2 mm"})
        self.assertEqual(left.to_manifest(), right.to_manifest())
        self.assertEqual(left.revision_id, right.revision_id)
        self.assertEqual(compute_revision_id(left.to_manifest()), left.revision_id)

    def test_identity_and_authority_cannot_be_caller_minted(self):
        with self.assertRaises(TypeError):
            DesignRevision(
                parent_revision_id=None,
                source_manifest_digest=DIGEST,
                entrypoint="part.py:build",
                dependency_lock_digest=DIGEST,
                toolchain_lock_digest=DIGEST,
                parameter_values={},
                revision_id="rev_caller",
            )
        with self.assertRaises(TypeError):
            DesignRevision(
                parent_revision_id=None,
                source_manifest_digest=DIGEST,
                entrypoint="part.py:build",
                dependency_lock_digest=DIGEST,
                toolchain_lock_digest=DIGEST,
                parameter_values={},
                authority_profile="caller",
            )

    def test_parameters_are_defensively_copied_and_immutable(self):
        parameters = {"height": "10 mm"}
        item = revision(parameters)
        identity = item.revision_id
        parameters["height"] = "999 mm"
        self.assertEqual("10 mm", item.parameter_values["height"])
        self.assertEqual(identity, item.revision_id)
        with self.assertRaises(TypeError):
            item.parameter_values["height"] = "11 mm"
        manifest = item.to_manifest()
        manifest["parameter_values"]["height"] = "12 mm"
        self.assertEqual("10 mm", item.parameter_values["height"])

    def test_manifest_round_trip_rejects_identity_tampering(self):
        item = revision()
        self.assertEqual(item, DesignRevision.from_manifest(item.to_manifest()))
        tampered = item.to_manifest()
        tampered["entrypoint"] = "other.py:build"
        with self.assertRaisesRegex(ValueError, "revision_id does not match"):
            DesignRevision.from_manifest(tampered)

    def test_invalid_manifest_fields_fail_at_construction(self):
        with self.assertRaisesRegex(ValueError, "source_manifest_digest"):
            DesignRevision(None, "invalid", "part.py:build", DIGEST, DIGEST, {})


if __name__ == "__main__":
    unittest.main()
