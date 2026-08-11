import dataclasses
import json
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
EXACT_DIGEST = "sha256:" + "1" * 64
STEP_DIGEST = "sha256:" + "2" * 64
VALIDATION_DIGEST = "sha256:" + "3" * 64


def draft_export(revision_id: str, attempt_id: str, **overrides):
    arguments = {
        "receipt_id": "receipt_1",
        "export_id": "export_1",
        "project_id": "project_1",
        "revision_id": revision_id,
        "attempt_id": attempt_id,
        "authority_profile": "source-native/v0",
        "exact_body_digest": EXACT_DIGEST,
        "step_digest": STEP_DIGEST,
        "units": "mm",
        "warnings": ("Framework-only draft; receiver qualification is not implemented.",),
        "environment_lock_digest": DIGEST,
        "validation_report_digest": VALIDATION_DIGEST,
    }
    arguments.update(overrides)
    return DraftExport(**arguments)


def revision():
    return DesignRevision(None, DIGEST, "part.py:build", DIGEST, DIGEST, {"height": "10 mm"})


class LifecycleTests(unittest.TestCase):
    def test_consistent_successful_lifecycle(self):
        item = revision()
        attempt = BuildAttempt(
            "attempt_1", item.revision_id, DIGEST, DIGEST, BuildStatus.SUCCEEDED,
            {"exact_brep": EXACT_DIGEST, "step": STEP_DIGEST},
        )
        evidence = EvidenceClosure(
            "closure_1", item.revision_id, attempt.attempt_id, ("req_1",),
            (VALIDATION_DIGEST,), DIGEST,
        )
        export = draft_export(item.revision_id, attempt.attempt_id)
        validate_lifecycle(item, attempt, evidence=evidence, draft_export=export)

    def test_draft_export_is_a_canonical_framework_only_unreleased_receipt(self):
        item = revision()
        export = draft_export(item.revision_id, "attempt_1")

        expected = {
            "schema": "piton.draft-export-receipt.v1",
            "receipt_id": "receipt_1",
            "export_id": "export_1",
            "project_id": "project_1",
            "revision_id": item.revision_id,
            "attempt_id": "attempt_1",
            "authority_profile": "source-native/v0",
            "exact_body_digest": EXACT_DIGEST,
            "step_digest": STEP_DIGEST,
            "units": "mm",
            "warnings": ["Framework-only draft; receiver qualification is not implemented."],
            "environment_lock_digest": DIGEST,
            "validation_report_digest": VALIDATION_DIGEST,
            "review_state": "needs_human_review",
            "fabrication_release": False,
            "machine_actuation": False,
            "release_state": "unreleased",
            "unreleased": True,
        }
        self.assertEqual(export.to_primitive(), expected)
        self.assertEqual(json.loads(export.canonical_bytes), expected)
        self.assertEqual(export.canonical_bytes, export.canonical_bytes)
        self.assertFalse(export.issues_engineering_approval)
        self.assertFalse(export.issues_fabrication_release)
        self.assertFalse(export.moves_channel)

        with self.assertRaises(dataclasses.FrozenInstanceError):
            export.export_id = "changed"  # type: ignore[misc]

    def test_draft_export_root_truth_is_fail_closed(self):
        item = revision()
        unsafe_values = {
            "review_state": "approved",
            "fabrication_release": True,
            "machine_actuation": True,
            "release_state": "released",
            "unreleased": False,
        }
        for field, value in unsafe_values.items():
            with self.subTest(field=field):
                with self.assertRaises(ValueError):
                    draft_export(item.revision_id, "attempt_1", **{field: value})

    def test_draft_export_rejects_malformed_identity_digests_and_warnings(self):
        item = revision()
        invalid = {
            "receipt_id": "",
            "project_id": "bad project",
            "authority_profile": "worker-native/v1",
            "exact_body_digest": "not-a-digest",
            "step_digest": "sha256:ABC",
            "units": "",
            "warnings": ("",),
            "environment_lock_digest": "bad",
            "validation_report_digest": "bad",
        }
        for field, value in invalid.items():
            with self.subTest(field=field):
                with self.assertRaises(ValueError):
                    draft_export(item.revision_id, "attempt_1", **{field: value})

    def test_draft_export_normalizes_unicode_before_canonical_serialization(self):
        item = revision()
        composed = draft_export(item.revision_id, "attempt_1", warnings=("caf\u00e9",))
        decomposed = draft_export(item.revision_id, "attempt_1", warnings=("cafe\u0301",))
        self.assertEqual(composed.warnings, decomposed.warnings)
        self.assertEqual(composed.canonical_bytes, decomposed.canonical_bytes)

    def test_draft_export_requires_validation_report_evidence_custody(self):
        item = revision()
        attempt = BuildAttempt(
            "attempt_1", item.revision_id, DIGEST, DIGEST, BuildStatus.SUCCEEDED,
            {"exact_brep": EXACT_DIGEST, "step": STEP_DIGEST},
        )
        export = draft_export(item.revision_id, attempt.attempt_id)
        with self.assertRaisesRegex(ValueError, "requires validation evidence"):
            validate_lifecycle(item, attempt, draft_export=export)

        unrelated = EvidenceClosure(
            "closure_1", item.revision_id, attempt.attempt_id, ("req_1",),
            (DIGEST,), DIGEST,
        )
        with self.assertRaisesRegex(ValueError, "bound by evidence custody"):
            validate_lifecycle(item, attempt, evidence=unrelated, draft_export=export)

    def test_failed_or_mismatched_attempt_cannot_back_derived_records(self):
        item = revision()
        failed = BuildAttempt("attempt_1", item.revision_id, DIGEST, DIGEST, BuildStatus.FAILED)
        export = draft_export(item.revision_id, failed.attempt_id)
        with self.assertRaisesRegex(ValueError, "successful build"):
            validate_lifecycle(item, failed, draft_export=export)

        succeeded = BuildAttempt(
            "attempt_2", item.revision_id, DIGEST, DIGEST, BuildStatus.SUCCEEDED,
            {"step": DIGEST},
        )
        mismatched = draft_export(item.revision_id, "other_attempt", export_id="export_2")
        with self.assertRaisesRegex(ValueError, "must match"):
            validate_lifecycle(item, succeeded, draft_export=mismatched)

    def test_export_artifact_must_be_from_build(self):
        item = revision()
        attempt = BuildAttempt(
            "attempt_1", item.revision_id, DIGEST, DIGEST, BuildStatus.SUCCEEDED,
            {"step": "sha256:" + "1" * 64},
        )
        export = draft_export(
            item.revision_id,
            attempt.attempt_id,
            exact_body_digest="sha256:" + "4" * 64,
        )
        evidence = EvidenceClosure(
            "closure_1", item.revision_id, attempt.attempt_id, ("req_1",),
            (VALIDATION_DIGEST,), DIGEST,
        )
        with self.assertRaisesRegex(ValueError, "must come from"):
            validate_lifecycle(item, attempt, evidence=evidence, draft_export=export)


if __name__ == "__main__":
    unittest.main()
