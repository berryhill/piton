"""T006 partner-alpha scaffold is an inert, zero-claim receipt."""

from dataclasses import FrozenInstanceError, replace
import unittest

from piton.partner_alpha import (
    PartnerAlphaReceipt,
    default_partner_alpha_receipt,
    validate_partner_alpha_receipt,
)


class PartnerAlphaReceiptTests(unittest.TestCase):
    def test_default_receipt_is_immutable_slotted_synthetic_and_unavailable(self) -> None:
        receipt = default_partner_alpha_receipt()

        self.assertTrue(receipt.synthetic)
        self.assertFalse(receipt.available)
        self.assertFalse(hasattr(receipt, "__dict__"))
        with self.assertRaises(FrozenInstanceError):
            receipt.available = True  # type: ignore[misc]

    def test_default_receipt_contains_no_threshold_safety_or_gate_claims(self) -> None:
        receipt = default_partner_alpha_receipt()

        self.assertFalse(receipt.threshold_passed)
        self.assertFalse(receipt.fabrication_release)
        self.assertFalse(receipt.machine_actuation)
        self.assertEqual("needs_human_review", receipt.review_state)
        self.assertFalse(receipt.g2_accepted)
        self.assertFalse(receipt.g7_accepted)

    def test_default_receipt_contains_no_partner_job_or_revenue_claims(self) -> None:
        receipt = default_partner_alpha_receipt()

        self.assertEqual(0, receipt.paid_partner_count)
        self.assertEqual(0, receipt.completed_real_job_count)
        self.assertEqual(0, receipt.recognized_revenue_usd)
        validate_partner_alpha_receipt(receipt)

    def test_validator_rejects_each_positive_or_available_claim(self) -> None:
        baseline = default_partner_alpha_receipt()
        unsafe_claims = {
            "synthetic": False,
            "available": True,
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

        for field, value in unsafe_claims.items():
            with self.subTest(field=field):
                with self.assertRaisesRegex(ValueError, field):
                    validate_partner_alpha_receipt(replace(baseline, **{field: value}))

    def test_validator_rejects_wrong_receipt_type_and_nonliteral_zero_values(self) -> None:
        with self.assertRaisesRegex(ValueError, "PartnerAlphaReceipt"):
            validate_partner_alpha_receipt(object())  # type: ignore[arg-type]

        for field, value in (
            ("paid_partner_count", False),
            ("completed_real_job_count", 0.0),
            ("recognized_revenue_usd", False),
        ):
            with self.subTest(field=field):
                receipt = replace(default_partner_alpha_receipt(), **{field: value})
                with self.assertRaisesRegex(ValueError, field):
                    validate_partner_alpha_receipt(receipt)

    def test_public_package_exports_the_scaffold(self) -> None:
        import piton

        self.assertIs(PartnerAlphaReceipt, piton.PartnerAlphaReceipt)
        self.assertIs(default_partner_alpha_receipt, piton.default_partner_alpha_receipt)
        self.assertIs(validate_partner_alpha_receipt, piton.validate_partner_alpha_receipt)


if __name__ == "__main__":
    unittest.main()
