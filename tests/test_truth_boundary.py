import unittest

from piton.model import BuildAttempt, BuildStatus, DraftExport, TruthBoundary

DIGEST = "sha256:" + "0" * 64
REVISION_ID = "rev_" + "1" * 64


class TruthBoundaryTests(unittest.TestCase):
    def test_defaults_are_review_only(self):
        truth = TruthBoundary()
        self.assertEqual("needs_human_review", truth.review_state)
        self.assertFalse(truth.fabrication_release)
        self.assertFalse(truth.machine_actuation)

    def test_unsafe_truth_state_fails_during_construction(self):
        with self.assertRaisesRegex(ValueError, "fabrication release"):
            TruthBoundary(fabrication_release=True)
        with self.assertRaisesRegex(ValueError, "needs_human_review"):
            TruthBoundary(review_state="accepted")
        with self.assertRaisesRegex(ValueError, "actuate machines"):
            TruthBoundary(machine_actuation=True)

    def test_stage1_export_fails_closed_and_copies_artifacts(self):
        artifacts = {"step": DIGEST}
        export = DraftExport("exp_1", REVISION_ID, "attempt_1", artifacts)
        artifacts["step"] = "changed"
        self.assertEqual(DIGEST, export.artifact_digests["step"])
        with self.assertRaises(TypeError):
            export.artifact_digests["step"] = "changed"
        with self.assertRaisesRegex(ValueError, "visibly unreleased"):
            DraftExport("exp_2", REVISION_ID, "attempt_1", {"step": DIGEST}, unreleased=False)

    def test_build_attempt_copies_artifacts(self):
        artifacts = {"exact": DIGEST}
        attempt = BuildAttempt(
            "attempt_1", REVISION_ID, DIGEST, DIGEST, BuildStatus.SUCCEEDED, artifacts
        )
        artifacts.clear()
        self.assertEqual({"exact": DIGEST}, dict(attempt.artifact_digests))


if __name__ == "__main__":
    unittest.main()
