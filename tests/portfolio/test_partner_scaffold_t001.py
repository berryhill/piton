from __future__ import annotations

import unittest
from dataclasses import fields, replace

from piton.portfolio.partner_scaffold_t001 import (
    PartnerScaffoldT001Receipt,
    validate_partner_scaffold_t001,
)


class PartnerScaffoldT001Tests(unittest.TestCase):
    def test_partner_scaffold_t001_is_zero_claim_and_review_only(self) -> None:
        receipt = PartnerScaffoldT001Receipt()

        self.assertIs(validate_partner_scaffold_t001(receipt), True)
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

    def test_partner_scaffold_t001_rejects_every_nondefault_claim(self) -> None:
        receipt = PartnerScaffoldT001Receipt()
        unsafe_values = {
            "disposition": "advance",
            "synthetic": False,
            "threshold_passed": True,
            "review_state": "approved",
            "fabrication_release": True,
            "machine_actuation": True,
            "g2_accepted": True,
            "g7_accepted": True,
            "paid_partner_count": 1,
            "completed_real_job_count": 1,
            "recognized_revenue_usd": 1,
        }

        self.assertEqual({field.name for field in fields(receipt)}, set(unsafe_values))
        for name, value in unsafe_values.items():
            with self.subTest(field=name):
                self.assertIs(
                    validate_partner_scaffold_t001(replace(receipt, **{name: value})),
                    False,
                )


if __name__ == "__main__":
    unittest.main()
