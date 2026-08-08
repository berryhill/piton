import unittest
from dataclasses import replace
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
        self.assertRegex(decision.request_digest, r"^sha256:[0-9a-f]{64}$")

    def test_request_id_is_strictly_bound_to_canonical_request_content(self):
        first = admit_engineering_request(
            request=self.request(),
            principal=self.principal,
            grant=self.grant,
            policy=self.policy,
            current_revision_id=REVISION_ID,
            now=NOW,
        )
        replay = admit_engineering_request(
            request=self.request(),
            principal=self.principal,
            grant=self.grant,
            policy=self.policy,
            current_revision_id=REVISION_ID,
            now=NOW,
            stored_decision=first,
        )
        conflict = admit_engineering_request(
            request=self.request(budget_units=1),
            principal=self.principal,
            grant=self.grant,
            policy=self.policy,
            current_revision_id=REVISION_ID,
            now=NOW,
            stored_decision=first,
        )
        context_conflict = admit_engineering_request(
            request=self.request(),
            principal=PrincipalContext("agent.other"),
            grant=self.grant,
            policy=self.policy,
            current_revision_id=REVISION_ID,
            now=NOW,
            stored_decision=first,
        )
        self.assertIs(first, replay)
        self.assertFalse(conflict.admitted)
        self.assertIn("request ID was reused with different content", conflict.reasons)
        self.assertEqual(
            ("stored decision does not match server-owned admission context",),
            context_conflict.reasons,
        )

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
            "grant_id",
            "grant",
            "policy",
            "review_state",
            "approval",
            "engineering_approval",
            "export",
            "release",
            "fabrication_release",
            "machine_actuation",
        ):
            with self.subTest(forbidden=forbidden):
                with self.assertRaisesRegex(ValueError, "unsupported request fields"):
                    EngineeringRequest.from_untrusted({**baseline, forbidden: "claimed"})

        for missing in baseline:
            with self.subTest(missing=missing):
                content = dict(baseline)
                del content[missing]
                with self.assertRaisesRegex(ValueError, "unsupported request fields"):
                    EngineeringRequest.from_untrusted(content)

    def test_scope_effect_capability_policy_and_budget_must_all_match(self):
        mismatches = (
            ("project_id", "project_2", "project scope"),
            ("resource_id", "part_2", "resource scope"),
            ("effect", Effect.READ, "effect capability pair"),
            ("capability", "part.inspect", "effect capability pair"),
            ("policy_digest", OTHER_DIGEST, "policy digest"),
            ("budget_units", 4, "grant budget"),
            ("budget_units", 6, "policy budget"),
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
        for effect in (
            "approve",
            "export",
            "release",
            "fabrication_release",
            "machine_actuation",
        ):
            with self.subTest(effect=effect):
                with self.assertRaisesRegex(ValueError, "unsupported engineering effect"):
                    self.request(effect=effect)

    def test_only_the_two_stage_one_effect_capability_pairs_are_representable(self):
        allowed = (
            (Effect.READ, "part.inspect"),
            (Effect.PROPOSE, "parameter.propose"),
        )
        for effect, capability in allowed:
            with self.subTest(effect=effect, capability=capability):
                request = self.request(effect=effect, capability=capability)
                self.assertEqual(effect, request.effect)
                self.assertEqual(capability, request.capability)

        with self.assertRaisesRegex(ValueError, "unsupported Stage 1 capability"):
            self.request(capability="revision.commit")

    def test_malformed_trusted_and_untrusted_inputs_fail_closed(self):
        invalid_requests = (
            {"request_id": ""},
            {"base_revision_id": "rev_not-canonical"},
            {"policy_digest": "sha256:not-canonical"},
            {"budget_units": 0},
            {"budget_units": True},
        )
        for changes in invalid_requests:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                self.request(**changes)

        with self.assertRaisesRegex(ValueError, "duplicates"):
            AdmissionPolicy(DIGEST, (Effect.READ, Effect.READ), ("part.inspect",), 1)
        with self.assertRaisesRegex(ValueError, "duplicates"):
            AdmissionPolicy(DIGEST, (Effect.READ,), ("part.inspect", "part.inspect"), 1)
        with self.assertRaisesRegex(ValueError, "duplicates"):
            replace(self.grant, resource_ids=("part_1", "part_1"))
        with self.assertRaisesRegex(ValueError, "timezone-aware"):
            replace(self.grant, expires_at=self.grant.expires_at.replace(tzinfo=None))
        with self.assertRaisesRegex(ValueError, "timezone-aware"):
            admit_engineering_request(
                request=self.request(),
                principal=self.principal,
                grant=self.grant,
                policy=self.policy,
                current_revision_id=REVISION_ID,
                now=NOW.replace(tzinfo=None),
            )


if __name__ == "__main__":
    unittest.main()
