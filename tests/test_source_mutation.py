import unittest
from typing import Any

from piton import ChangeProposal, TruthBoundary, apply_change_proposal
from piton.revision import DesignRevision

DIGEST_A = "sha256:" + "a" * 64
DIGEST_B = "sha256:" + "b" * 64
DIGEST_C = "sha256:" + "c" * 64


def base_revision() -> DesignRevision:
    return DesignRevision(
        parent_revision_id=None,
        source_manifest_digest=DIGEST_A,
        entrypoint="piton.parts.l_bracket:build_part",
        dependency_lock_digest=DIGEST_B,
        toolchain_lock_digest=DIGEST_C,
        parameter_values={
            "leg_length_mm": "80 mm",
            "leg_width_mm": "40 mm",
        },
    )


def proposal(base: DesignRevision, **overrides: str) -> ChangeProposal:
    values: dict[str, Any] = {
        "proposal_id": "proposal_leg_length_90",
        "base_revision_id": base.revision_id,
        "parameter_id": "leg_length_mm",
        "expected_old_quantity": "80 mm",
        "new_quantity": "90 mm",
    }
    values.update(overrides)
    return ChangeProposal(**values)


class SourceMutationContractTests(unittest.TestCase):
    def test_derives_one_immutable_candidate_from_exact_current_base(self):
        base = base_revision()
        change = proposal(base)

        candidate = apply_change_proposal(
            base,
            change,
            current_revision_id=base.revision_id,
        )
        repeated = apply_change_proposal(
            base,
            change,
            current_revision_id=base.revision_id,
        )

        self.assertEqual(base.revision_id, candidate.parent_revision_id)
        self.assertEqual("proposal_leg_length_90", candidate.proposal_id)
        self.assertEqual(set(base.parameter_values), set(candidate.parameter_values))
        changed = {
            key
            for key in base.parameter_values
            if base.parameter_values[key] != candidate.parameter_values[key]
        }
        self.assertEqual({"leg_length_mm"}, changed)
        self.assertEqual("90 mm", candidate.parameter_values["leg_length_mm"])
        self.assertEqual("40 mm", candidate.parameter_values["leg_width_mm"])
        self.assertNotEqual(base.revision_id, candidate.revision_id)
        self.assertEqual(candidate.revision_id, repeated.revision_id)
        with self.assertRaises(TypeError):
            candidate.parameter_values["leg_length_mm"] = "100 mm"

    def test_preserves_source_authority_and_does_not_mutate_base(self):
        base = base_revision()
        original_manifest = base.to_manifest()

        candidate = apply_change_proposal(
            base,
            proposal(base),
            current_revision_id=base.revision_id,
        )

        self.assertEqual(original_manifest, base.to_manifest())
        self.assertEqual(base.source_manifest_digest, candidate.source_manifest_digest)
        self.assertEqual(base.entrypoint, candidate.entrypoint)
        self.assertEqual(base.dependency_lock_digest, candidate.dependency_lock_digest)
        self.assertEqual(base.toolchain_lock_digest, candidate.toolchain_lock_digest)
        self.assertEqual("source-native/v0", candidate.authority_profile)
        self.assertNotIn("review_state", candidate.to_manifest())
        self.assertNotIn("fabrication_release", candidate.to_manifest())
        self.assertNotIn("machine_actuation", candidate.to_manifest())
        self.assertEqual(
            TruthBoundary(),
            TruthBoundary(
                review_state="needs_human_review",
                fabrication_release=False,
                machine_actuation=False,
            ),
        )

    def test_rejects_proposal_whose_base_does_not_match_supplied_base(self):
        base = base_revision()
        other_revision_id = "rev_" + "d" * 64

        with self.assertRaisesRegex(ValueError, "proposal base_revision_id"):
            apply_change_proposal(
                base,
                proposal(base, base_revision_id=other_revision_id),
                current_revision_id=base.revision_id,
            )

    def test_rejects_stale_server_owned_current_revision(self):
        base = base_revision()
        newer_revision_id = "rev_" + "e" * 64

        with self.assertRaisesRegex(ValueError, "current revision"):
            apply_change_proposal(
                base,
                proposal(base),
                current_revision_id=newer_revision_id,
            )

    def test_rejects_unknown_parameter(self):
        base = base_revision()

        with self.assertRaisesRegex(ValueError, "unknown parameter_id"):
            apply_change_proposal(
                base,
                proposal(
                    base,
                    parameter_id="missing_mm",
                    expected_old_quantity="1 mm",
                    new_quantity="2 mm",
                ),
                current_revision_id=base.revision_id,
            )

    def test_rejects_stale_expected_old_quantity_without_normalizing(self):
        base = base_revision()

        with self.assertRaisesRegex(ValueError, "expected_old_quantity"):
            apply_change_proposal(
                base,
                proposal(base, expected_old_quantity="80.0 mm"),
                current_revision_id=base.revision_id,
            )

    def test_rejects_no_op_mutation(self):
        base = base_revision()

        with self.assertRaisesRegex(ValueError, "must differ"):
            apply_change_proposal(
                base,
                proposal(base, new_quantity="80 mm"),
                current_revision_id=base.revision_id,
            )


if __name__ == "__main__":
    unittest.main()
