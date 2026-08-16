"""Closed lifecycle contract tests for the new Piton framework receipts.

Doctrine anchor: sections 10.5 and 10.6 of ``docs/mvi-doctrine.md``.
These contracts admit the typed shape for ``ApprovalRecord``,
``FabricationRelease``, and ``ReleasedPackageProjection`` so the closed
application-service boundary has a typed target for ``sign_approval``,
``reject_fabrication_release``, and ``record_released_package_projection``.
None of them can mint engineering approval, fabrication release, or machine
actuation under Stage 1.
"""

from __future__ import annotations

import dataclasses
import unittest

from piton import (
    ApprovalRecord,
    FabricationRelease,
    HardenedChannelPointer,
    ReleasedPackageProjection,
)
from piton.storage.revisions import ChannelPointer


REVISION_ID = "rev_" + "1" * 64
ZERO_DIGEST = "sha256:" + "0" * 64
ZERO_DIGEST_2 = "sha256:" + "1" * 64
ZERO_DIGEST_3 = "sha256:" + "2" * 64


def approval_record(**overrides: object) -> ApprovalRecord:
    base = dict(
        receipt_id="ar:1",
        revision_id=REVISION_ID,
        evidence_closure_id="ec:1",
        scoped_decision="accept_for_review",
        scope_reason="bounds-checked against the framework",
        declared_at="2026-08-16T00:00:00Z",
    )
    base.update(overrides)
    return ApprovalRecord(**base)


def fabrication_release(**overrides: object) -> FabricationRelease:
    base = dict(
        release_id="rel:1",
        approval_receipt_id="ar:1",
        revision_id=REVISION_ID,
        deliverables_digest=ZERO_DIGEST,
        declared_at="2026-08-16T00:00:00Z",
    )
    base.update(overrides)
    return FabricationRelease(**base)


def released_package_projection(**overrides: object) -> ReleasedPackageProjection:
    base = dict(
        projection_id="rpp:1",
        release_id="rel:1",
        package_digest=ZERO_DIGEST,
        units="mm",
        declared_at="2026-08-16T00:00:00Z",
    )
    base.update(overrides)
    return ReleasedPackageProjection(**base)


class ApprovalRecordTests(unittest.TestCase):
    def test_default_root_truth_is_pinned(self) -> None:
        record = approval_record()
        self.assertEqual("needs_human_review", record.review_state)
        self.assertFalse(record.fabrication_release)
        self.assertFalse(record.machine_actuation)
        self.assertFalse(record.issues_engineering_approval)
        self.assertFalse(record.issues_fabrication_release)
        self.assertFalse(record.moves_channel)

    def test_unsafe_review_state_fails_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "needs_human_review"):
            approval_record(review_state="approved")

    def test_unsafe_fabrication_release_fails_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "fabrication release"):
            approval_record(fabrication_release=True)

    def test_unsafe_machine_actuation_fails_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "machine actuation"):
            approval_record(machine_actuation=True)

    def test_invalid_scoped_decision_fails_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "scoped decision"):
            approval_record(scoped_decision="Not-Lowercase")

    def test_invalid_revision_id_fails_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "canonical revision"):
            approval_record(revision_id="rev_bad")

    def test_empty_scope_reason_fails_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "non-empty"):
            approval_record(scope_reason="   ")

    def test_frozen(self) -> None:
        record = approval_record()
        with self.assertRaises(dataclasses.FrozenInstanceError):
            record.scoped_decision = "anything"  # type: ignore[misc]

    def test_assert_safe_raises_outside_post_init(self) -> None:
        # Constructed defaults are safe; assert_safe is idempotent.
        record = approval_record()
        record.assert_safe()


class FabricationReleaseTests(unittest.TestCase):
    def test_default_root_truth_is_pinned(self) -> None:
        record = fabrication_release()
        self.assertEqual("needs_human_review", record.review_state)
        self.assertFalse(record.fabrication_release)
        self.assertFalse(record.machine_actuation)
        self.assertFalse(record.issues_engineering_approval)
        self.assertFalse(record.issues_fabrication_release)

    def test_unsafe_fabrication_release_fails_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "fabrication release"):
            fabrication_release(fabrication_release=True)

    def test_unsafe_machine_actuation_fails_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "machine actuation"):
            fabrication_release(machine_actuation=True)

    def test_invalid_deliverables_digest_fails_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "sha256"):
            fabrication_release(deliverables_digest="not-a-digest")

    def test_invalid_approval_receipt_id_fails_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "identifier"):
            fabrication_release(approval_receipt_id="1bad")

    def test_frozen(self) -> None:
        record = fabrication_release()
        with self.assertRaises(dataclasses.FrozenInstanceError):
            record.release_id = "rel:2"  # type: ignore[misc]


class ReleasedPackageProjectionTests(unittest.TestCase):
    def test_default_root_truth_is_pinned(self) -> None:
        record = released_package_projection()
        self.assertEqual("needs_human_review", record.review_state)
        self.assertFalse(record.fabrication_release)
        self.assertFalse(record.machine_actuation)
        self.assertFalse(record.issues_engineering_approval)
        self.assertFalse(record.issues_fabrication_release)

    def test_unsafe_fabrication_release_fails_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "fabrication release"):
            released_package_projection(fabrication_release=True)

    def test_unsafe_machine_actuation_fails_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "machine actuation"):
            released_package_projection(machine_actuation=True)

    def test_invalid_package_digest_fails_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "sha256"):
            released_package_projection(package_digest="not-a-digest")

    def test_invalid_units_fails_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "units"):
            released_package_projection(units="   ")

    def test_invalid_projection_id_fails_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "identifier"):
            released_package_projection(projection_id="1bad")

    def test_frozen(self) -> None:
        record = released_package_projection()
        with self.assertRaises(dataclasses.FrozenInstanceError):
            record.projection_id = "rpp:2"  # type: ignore[misc]


class HardenedChannelPointerTests(unittest.TestCase):
    def test_pins_root_truth(self) -> None:
        pointer = ChannelPointer("project_1", "workspace", REVISION_ID, 1, "2026-08-16T00:00:00Z")
        hardened = HardenedChannelPointer(pointer)
        self.assertEqual("needs_human_review", hardened.review_state)
        self.assertFalse(hardened.fabrication_release)
        self.assertFalse(hardened.machine_actuation)

    def test_unsafe_review_state_fails_closed(self) -> None:
        pointer = ChannelPointer("project_1", "workspace", REVISION_ID, 1, "2026-08-16T00:00:00Z")
        with self.assertRaisesRegex(ValueError, "needs_human_review"):
            HardenedChannelPointer(pointer, review_state="approved")

    def test_unsafe_fabrication_release_fails_closed(self) -> None:
        pointer = ChannelPointer("project_1", "workspace", REVISION_ID, 1, "2026-08-16T00:00:00Z")
        with self.assertRaisesRegex(ValueError, "fabrication release"):
            HardenedChannelPointer(pointer, fabrication_release=True)

    def test_unsafe_machine_actuation_fails_closed(self) -> None:
        pointer = ChannelPointer("project_1", "workspace", REVISION_ID, 1, "2026-08-16T00:00:00Z")
        with self.assertRaisesRegex(ValueError, "machine actuation"):
            HardenedChannelPointer(pointer, machine_actuation=True)

    def test_typed_pointer_required(self) -> None:
        with self.assertRaisesRegex(TypeError, "ChannelPointer"):
            HardenedChannelPointer("not-a-pointer")  # type: ignore[arg-type]

    def test_moves_channel_property(self) -> None:
        pointer = ChannelPointer("project_1", "workspace", REVISION_ID, 1, "2026-08-16T00:00:00Z")
        hardened = HardenedChannelPointer(pointer)
        self.assertTrue(hardened.moves_channel)
        self.assertFalse(hardened.issues_engineering_approval)
        self.assertFalse(hardened.issues_fabrication_release)


class ChannelPointerTests(unittest.TestCase):
    def test_default_root_truth_is_pinned(self) -> None:
        pointer = ChannelPointer("project_1", "workspace", REVISION_ID, 1, "2026-08-16T00:00:00Z")
        self.assertEqual("needs_human_review", pointer.review_state)
        self.assertFalse(pointer.fabrication_release)
        self.assertFalse(pointer.machine_actuation)

    def test_unsafe_review_state_fails_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "needs_human_review"):
            ChannelPointer(
                "project_1",
                "workspace",
                REVISION_ID,
                1,
                "2026-08-16T00:00:00Z",
                review_state="approved",
            )

    def test_unsafe_fabrication_release_fails_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "fabrication release"):
            ChannelPointer(
                "project_1",
                "workspace",
                REVISION_ID,
                1,
                "2026-08-16T00:00:00Z",
                fabrication_release=True,
            )

    def test_unsafe_machine_actuation_fails_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "machine actuation"):
            ChannelPointer(
                "project_1",
                "workspace",
                REVISION_ID,
                1,
                "2026-08-16T00:00:00Z",
                machine_actuation=True,
            )


if __name__ == "__main__":
    unittest.main()
