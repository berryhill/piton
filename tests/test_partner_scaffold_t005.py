from __future__ import annotations

import unittest
from dataclasses import FrozenInstanceError, fields, replace

from piton.portfolio.partner_scaffold_t005 import (
    PartnerScaffoldT005Receipt,
    validate_partner_scaffold_t005,
)


class PartnerScaffoldT005Tests(unittest.TestCase):
    def test_default_receipt_is_valid_zero_claim_scaffold(self) -> None:
        receipt = PartnerScaffoldT005Receipt()

        self.assertIs(validate_partner_scaffold_t005(receipt), True)
        self.assertEqual(receipt.disposition, "unavailable")
        self.assertIs(receipt.synthetic, True)
        self.assertIs(receipt.threshold_passed, False)
        self.assertEqual(receipt.review_state, "needs_human_review")
        self.assertIs(receipt.fabrication_release, False)
        self.assertIs(receipt.machine_actuation, False)
        self.assertIs(receipt.g2_accepted, False)
        self.assertIs(receipt.g7_accepted, False)
        self.assertEqual(receipt.paid_partner_count, 0)
        self.assertEqual(receipt.completed_real_job_count, 0)
        self.assertEqual(receipt.recognized_revenue_usd, 0)

    def test_each_non_default_claim_fails_closed(self) -> None:
        receipt = PartnerScaffoldT005Receipt()
        unsafe_or_claiming_values = {
            "disposition": "go",
            "synthetic": False,
            "threshold_passed": True,
            "fabrication_release": True,
            "machine_actuation": True,
            "review_state": "approved",
            "g2_accepted": True,
            "g7_accepted": True,
            "paid_partner_count": 1,
            "completed_real_job_count": 1,
            "recognized_revenue_usd": 1,
        }

        self.assertEqual({field.name for field in fields(receipt)}, set(unsafe_or_claiming_values))
        for name, value in unsafe_or_claiming_values.items():
            with self.subTest(field=name):
                self.assertIs(
                    validate_partner_scaffold_t005(replace(receipt, **{name: value})),
                    False,
                )

    def test_boolean_values_cannot_masquerade_as_zero_counts(self) -> None:
        receipt = PartnerScaffoldT005Receipt()

        for name in (
            "paid_partner_count",
            "completed_real_job_count",
            "recognized_revenue_usd",
        ):
            with self.subTest(field=name):
                self.assertIs(
                    validate_partner_scaffold_t005(replace(receipt, **{name: False})),
                    False,
                )

    def test_validator_rejects_wrong_runtime_type_without_raising(self) -> None:
        self.assertIs(
            validate_partner_scaffold_t005(object()),  # type: ignore[arg-type]
            False,
        )

    def test_receipt_is_frozen_slotted_and_closed(self) -> None:
        receipt = PartnerScaffoldT005Receipt()

        with self.assertRaises(FrozenInstanceError):
            receipt.g7_accepted = True  # type: ignore[misc]
        with self.assertRaises((AttributeError, TypeError)):
            receipt.unknown_authority = True  # type: ignore[attr-defined]
        self.assertFalse(hasattr(receipt, "__dict__"))


if __name__ == "__main__":
    unittest.main()
