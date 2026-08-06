import unittest

from piton.model import (
    BuildAttempt,
    BuildStatus,
    DraftExport,
    EvidenceClosure,
    validate_lifecycle,
)
from piton.revision import DesignRevision

DIGEST = "sha256:" + "0" * 64


def revision():
    return DesignRevision(None, DIGEST, "part.py:build", DIGEST, DIGEST, {"height": "10 mm"})


class LifecycleTests(unittest.TestCase):
    def test_consistent_successful_lifecycle(self):
        item = revision()
        attempt = BuildAttempt(
            "attempt_1", item.revision_id, DIGEST, DIGEST, BuildStatus.SUCCEEDED,
            {"step": DIGEST},
        )
        evidence = EvidenceClosure(
            "closure_1", item.revision_id, attempt.attempt_id, ("req_1",),
            (DIGEST,), DIGEST,
        )
        export = DraftExport(
            "export_1", item.revision_id, attempt.attempt_id,
            {"step": DIGEST},
        )
        validate_lifecycle(item, attempt, evidence=evidence, draft_export=export)

    def test_failed_or_mismatched_attempt_cannot_back_derived_records(self):
        item = revision()
        failed = BuildAttempt("attempt_1", item.revision_id, DIGEST, DIGEST, BuildStatus.FAILED)
        export = DraftExport(
            "export_1", item.revision_id, failed.attempt_id,
            {"step": DIGEST},
        )
        with self.assertRaisesRegex(ValueError, "successful build"):
            validate_lifecycle(item, failed, draft_export=export)

        succeeded = BuildAttempt(
            "attempt_2", item.revision_id, DIGEST, DIGEST, BuildStatus.SUCCEEDED,
            {"step": DIGEST},
        )
        mismatched = DraftExport(
            "export_2", item.revision_id, "other_attempt",
            {"step": DIGEST},
        )
        with self.assertRaisesRegex(ValueError, "must match"):
            validate_lifecycle(item, succeeded, draft_export=mismatched)

    def test_export_artifact_must_be_from_build(self):
        item = revision()
        attempt = BuildAttempt(
            "attempt_1", item.revision_id, DIGEST, DIGEST, BuildStatus.SUCCEEDED,
            {"step": "sha256:" + "1" * 64},
        )
        export = DraftExport(
            "export_1", item.revision_id, attempt.attempt_id,
            {"step": "sha256:" + "2" * 64},
        )
        with self.assertRaisesRegex(ValueError, "must come from"):
            validate_lifecycle(item, attempt, draft_export=export)


if __name__ == "__main__":
    unittest.main()
