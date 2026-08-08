import unittest
from datetime import datetime, timedelta, timezone

from piton.admission import (
    AdmissionPolicy,
    AutonomyGrant,
    Effect,
    EngineeringRequest,
    PrincipalContext,
    admit_engineering_request,
)

DIGEST = "sha256:" + "a" * 64
OTHER_DIGEST = "sha256:" + "b" * 64
REVISION_ID = "rev_" + "1" * 64
OTHER_REVISION_ID = "rev_" + "2" * 64
NOW = datetime(2026, 8, 8, 15, 0, tzinfo=timezone.utc)


class AdmissionTests(unittest.TestCase):
    def setUp(self):
        self.principal = PrincipalContext(principal_id="agent.nick")
        self.policy = AdmissionPolicy(
            policy_digest=DIGEST,
            allowed_effects=(Effect.READ, Effect.PROPOSE),
            allowed_capabilities=("part.inspect", "parameter.propose"),
            max_budget_units=5,
        )
        self.grant = AutonomyGrant(
            grant_id="grant_1",
            principal_id="agent.nick",
            project_id="project_1",
            resource_ids=("part_1",),
            allowed_effects=(Effect.READ, Effect.PROPOSE),
            allowed_capabilities=("part.inspect", "parameter.propose"),
            policy_digest=DIGEST,
            base_revision_id=REVISION_ID,
            expires_at=NOW + timedelta(minutes=5),
            budget_units=3,
        )

    def request(self, **changes):
        values = {
            "request_id": "request_1",
            "project_id": "project_1",
            "resource_id": "part_1",
            "effect": Effect.PROPOSE,
            "capability": "parameter.propose",
            "base_revision_id": REVISION_ID,
            "policy_digest": DIGEST,
            "budget_units": 2,
        }
        values.update(changes)
        return EngineeringRequest(**values)

    def test_exact_bounded_request_is_admitted(self):
        decision = admit_engineering_request(
            request=self.request(),
            principal=self.principal,
            grant=self.grant,
            policy=self.policy,
            current_revision_id=REVISION_ID,
            now=NOW,
        )
        self.assertTrue(decision.admitted)
        self.assertEqual((), decision.reasons)
        self.assertEqual("grant_1", decision.grant_id)
        self.assertEqual(DIGEST, decision.policy_digest)

    def test_request_content_cannot_supply_authority_or_lifecycle_claims(self):
        baseline = {
            "request_id": "request_1",
            "project_id": "project_1",
            "resource_id": "part_1",
            "effect": "propose",
            "capability": "parameter.propose",
            "base_revision_id": REVISION_ID,
            "policy_digest": DIGEST,
            "budget_units": 1,
        }
        for forbidden in (
            "actor",
            "principal_id",
            "grant",
            "policy",
            "review_state",
            "approval",
            "fabrication_release",
            "machine_actuation",
        ):
            with self.subTest(forbidden=forbidden):
                with self.assertRaisesRegex(ValueError, "unsupported request fields"):
                    EngineeringRequest.from_untrusted({**baseline, forbidden: "claimed"})

    def test_scope_effect_capability_policy_and_budget_must_all_match(self):
        mismatches = (
            ("project_id", "project_2", "project scope"),
            ("resource_id", "part_2", "resource scope"),
            ("effect", Effect.READ, "effect capability pair"),
            ("capability", "part.inspect", "effect capability pair"),
            ("policy_digest", OTHER_DIGEST, "policy digest"),
            ("budget_units", 4, "grant budget"),
        )
        for field, value, reason in mismatches:
            with self.subTest(field=field):
                decision = admit_engineering_request(
                    request=self.request(**{field: value}),
                    principal=self.principal,
                    grant=self.grant,
                    policy=self.policy,
                    current_revision_id=REVISION_ID,
                    now=NOW,
                )
                self.assertFalse(decision.admitted)
                self.assertTrue(any(reason in item for item in decision.reasons), decision.reasons)

    def test_authenticated_principal_and_expiry_are_server_owned_gates(self):
        wrong_principal = admit_engineering_request(
            request=self.request(),
            principal=PrincipalContext("agent.other"),
            grant=self.grant,
            policy=self.policy,
            current_revision_id=REVISION_ID,
            now=NOW,
        )
        expired = admit_engineering_request(
            request=self.request(),
            principal=self.principal,
            grant=self.grant,
            policy=self.policy,
            current_revision_id=REVISION_ID,
            now=self.grant.expires_at,
        )
        self.assertIn("authenticated principal does not hold grant", wrong_principal.reasons)
        self.assertIn("grant is expired", expired.reasons)

    def test_stale_or_nonexact_revision_fails_closed(self):
        for request_revision, current_revision in (
            (OTHER_REVISION_ID, REVISION_ID),
            (REVISION_ID, OTHER_REVISION_ID),
        ):
            with self.subTest(request_revision=request_revision, current=current_revision):
                decision = admit_engineering_request(
                    request=self.request(base_revision_id=request_revision),
                    principal=self.principal,
                    grant=self.grant,
                    policy=self.policy,
                    current_revision_id=current_revision,
                    now=NOW,
                )
                self.assertFalse(decision.admitted)
                self.assertTrue(any("revision" in item for item in decision.reasons))

    def test_release_and_actuation_are_not_representable_effects(self):
        for effect in ("approve", "export", "release", "machine_actuation"):
            with self.subTest(effect=effect):
                with self.assertRaisesRegex(ValueError, "unsupported engineering effect"):
                    self.request(effect=effect)


if __name__ == "__main__":
    unittest.main()
