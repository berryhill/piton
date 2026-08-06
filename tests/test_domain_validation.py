import unittest

from piton.model import BuildAttempt, ChangeProposal, DraftExport, EvidenceClosure

DIGEST = "sha256:" + "0" * 64
REVISION_ID = "rev_" + "1" * 64


class DomainValidationTests(unittest.TestCase):
    def test_change_proposal_copies_and_validates_tuple_elements(self):
        requirements = ["req_1"]
        proposal = ChangeProposal(
            "proposal_1", REVISION_ID, "height", "10 mm", "11 mm", requirements
        )
        requirements.append("req_2")
        self.assertEqual(("req_1",), proposal.requirement_ids)
        with self.assertRaisesRegex(ValueError, "non-empty strings"):
            ChangeProposal(
                "proposal_1", REVISION_ID, "height", "10 mm", "11 mm", (["nested"],)
            )
        with self.assertRaisesRegex(ValueError, "canonical revision"):
            ChangeProposal("proposal_1", "rev_1", "height", "10 mm", "11 mm")

    def test_build_attempt_rejects_unshaped_digests_and_nested_diagnostics(self):
        with self.assertRaisesRegex(ValueError, "sha256"):
            BuildAttempt("attempt_1", REVISION_ID, "recipe", DIGEST)
        with self.assertRaisesRegex(ValueError, "non-empty strings"):
            BuildAttempt(
                "attempt_1", REVISION_ID, DIGEST, DIGEST, diagnostics=(["nested"],)
            )
        with self.assertRaisesRegex(ValueError, "sha256"):
            BuildAttempt(
                "attempt_1", REVISION_ID, DIGEST, DIGEST,
                artifact_digests={"step": "sha256:short"},
            )

    def test_evidence_and_export_reject_empty_or_unshaped_references(self):
        with self.assertRaisesRegex(ValueError, "at least one reference"):
            EvidenceClosure("closure_1", REVISION_ID, "attempt_1", (), (DIGEST,), DIGEST)
        with self.assertRaisesRegex(ValueError, "sha256"):
            EvidenceClosure(
                "closure_1", REVISION_ID, "attempt_1", ("req_1",), ("receipt",), DIGEST
            )
        with self.assertRaisesRegex(ValueError, "shaped"):
            DraftExport("export_1", REVISION_ID, "attempt_1", {"": DIGEST})


if __name__ == "__main__":
    unittest.main()
