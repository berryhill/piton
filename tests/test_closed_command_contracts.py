"""Closed typed command contract tests for the new lifecycle kinds.

Doctrine anchor: section 10.5 of ``docs/mvi-doctrine.md``.
Each new command kind must validate its identity payload and reject any
authority-shaped key. The closed application-service boundary must not
admit ``fabrication_release``, ``machine_actuation``, ``approval_authority``,
``release_authority``, ``machine_actuation_authority``, ``fabrication_releaser``,
or ``machine_actuator`` fields. The same rule is enforced by the closed
AF_UNIX envelope (``_closed_mapping``) in ``piton.service.daemon``.
"""

from __future__ import annotations

import unittest

from piton.service.commands import (
    AdmitBuildAttempt,
    AdmitChangeProposal,
    CreateDraftExport,
    MoveChannel,
    RecordEvidenceClosure,
    RecordProposalDisposition,
    RecordReleasedPackageProjection,
    RejectFabricationRelease,
    SignApproval,
)


REVISION_ID = "rev_" + "1" * 64
ZERO_DIGEST = "sha256:" + "0" * 64
ZERO_DIGEST_2 = "sha256:" + "1" * 64
ZERO_DIGEST_3 = "sha256:" + "2" * 64


def admit_change_proposal(**overrides: object) -> AdmitChangeProposal:
    base = dict(
        command_id="cmd_admit",
        project_id="project_1",
        proposal_id="proposal:1",
        base_revision_id=REVISION_ID,
        parameter_id="height",
        expected_old_quantity="10 mm",
        new_quantity="11 mm",
        requirement_ids=("req:1",),
    )
    base.update(overrides)
    return AdmitChangeProposal(**base)


def record_proposal_disposition(**overrides: object) -> RecordProposalDisposition:
    base = dict(
        command_id="cmd_disp",
        project_id="project_1",
        disposition_id="disp:1",
        proposal_id="proposal:1",
        base_revision_id=REVISION_ID,
        state="accepted_for_review",
        reason="checked against the base revision",
    )
    base.update(overrides)
    return RecordProposalDisposition(**base)


def admit_build_attempt(**overrides: object) -> AdmitBuildAttempt:
    base = dict(
        command_id="cmd_admit_build",
        project_id="project_1",
        attempt_id="attempt:1",
        revision_id=REVISION_ID,
        recipe_digest=ZERO_DIGEST,
        environment_digest=ZERO_DIGEST,
        toolchain_digest=ZERO_DIGEST,
        capability_manifest_digest=ZERO_DIGEST,
        resource_limits_digest=ZERO_DIGEST,
        expected_outputs_digest=ZERO_DIGEST,
        request_signature_digest=ZERO_DIGEST,
        input_manifest_digest=ZERO_DIGEST,
        worker_id="worker_a",
        isolation_class="wasm",
    )
    base.update(overrides)
    return AdmitBuildAttempt(**base)


def record_evidence_closure(**overrides: object) -> RecordEvidenceClosure:
    base = dict(
        command_id="cmd_evidence",
        project_id="project_1",
        closure_id="closure:1",
        revision_id=REVISION_ID,
        attempt_id="attempt:1",
        requirement_ids=("req:1",),
        receipt_digests=(ZERO_DIGEST,),
        policy_digest=ZERO_DIGEST,
    )
    base.update(overrides)
    return RecordEvidenceClosure(**base)


def move_channel(**overrides: object) -> MoveChannel:
    base = dict(
        command_id="cmd_move",
        project_id="project_1",
        channel="workspace",
        target_revision_id=REVISION_ID,
        expected_revision_id=None,
        expected_generation=0,
    )
    base.update(overrides)
    return MoveChannel(**base)


def sign_approval(**overrides: object) -> SignApproval:
    base = dict(
        command_id="cmd_sign",
        project_id="project_1",
        receipt_id="ar:1",
        revision_id=REVISION_ID,
        evidence_closure_id="ec:1",
        scoped_decision="accept_for_review",
        scope_reason="framework only",
        declared_at="2026-08-16T00:00:00Z",
    )
    base.update(overrides)
    return SignApproval(**base)


def create_draft_export(**overrides: object) -> CreateDraftExport:
    base = dict(
        command_id="cmd_export",
        project_id="project_1",
        receipt_id="receipt_x",
        export_id="export_x",
        revision_id=REVISION_ID,
        attempt_id="attempt:1",
        authority_profile="source-native/v0",
        exact_body_digest=ZERO_DIGEST,
        step_digest=ZERO_DIGEST_2,
        units="mm",
        warnings=("framework only",),
        environment_lock_digest=ZERO_DIGEST_3,
        validation_report_digest=ZERO_DIGEST,
    )
    base.update(overrides)
    return CreateDraftExport(**base)


def reject_fabrication_release(**overrides: object) -> RejectFabricationRelease:
    base = dict(
        command_id="cmd_reject",
        project_id="project_1",
        release_id="rel:1",
        approval_receipt_id="ar:1",
        revision_id=REVISION_ID,
        deliverables_digest=ZERO_DIGEST,
        declared_at="2026-08-16T00:00:00Z",
    )
    base.update(overrides)
    return RejectFabricationRelease(**base)


def record_released_package_projection(**overrides: object) -> RecordReleasedPackageProjection:
    base = dict(
        command_id="cmd_projection",
        project_id="project_1",
        projection_id="rpp:1",
        release_id="rel:1",
        package_digest=ZERO_DIGEST,
        units="mm",
        declared_at="2026-08-16T00:00:00Z",
    )
    base.update(overrides)
    return RecordReleasedPackageProjection(**base)


class AdmitChangeProposalContractTests(unittest.TestCase):
    def test_accepts_valid_payload(self) -> None:
        admit_change_proposal()

    def test_invalid_requirement_ids_fails_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "non-empty tuple"):
            admit_change_proposal(requirement_ids=())
        with self.assertRaisesRegex(ValueError, "non-empty tuple"):
            admit_change_proposal(requirement_ids=["req:1"])  # type: ignore[arg-type]

    def test_blank_quantity_fails_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "non-empty"):
            admit_change_proposal(new_quantity="   ")


class RecordProposalDispositionContractTests(unittest.TestCase):
    def test_accepts_valid_payload(self) -> None:
        record_proposal_disposition()

    def test_unknown_state_fails_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "known proposal disposition state"):
            record_proposal_disposition(state="approved_for_release")

    def test_blank_reason_fails_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "non-empty"):
            record_proposal_disposition(reason="   ")


class AdmitBuildAttemptContractTests(unittest.TestCase):
    def test_accepts_valid_payload(self) -> None:
        admit_build_attempt()

    def test_invalid_isolation_class_fails_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "isolation class"):
            admit_build_attempt(isolation_class="vm")

    def test_blank_digest_fails_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "non-empty"):
            admit_build_attempt(recipe_digest="")


class RecordEvidenceClosureContractTests(unittest.TestCase):
    def test_accepts_valid_payload(self) -> None:
        record_evidence_closure()

    def test_empty_requirement_ids_fails_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "non-empty tuple"):
            record_evidence_closure(requirement_ids=())

    def test_blank_receipt_digest_fails_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "sha256"):
            record_evidence_closure(receipt_digests=("not-a-digest",))

    def test_empty_receipt_digests_fails_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "non-empty tuple"):
            record_evidence_closure(receipt_digests=())


class MoveChannelContractTests(unittest.TestCase):
    def test_accepts_valid_payload(self) -> None:
        move_channel()

    def test_unknown_channel_fails_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "channel"):
            move_channel(channel="breakglass")

    def test_negative_generation_fails_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "non-negative"):
            move_channel(expected_generation=-1)


class SignApprovalContractTests(unittest.TestCase):
    def test_accepts_valid_payload(self) -> None:
        sign_approval()

    def test_invalid_scoped_decision_fails_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "scoped decision"):
            sign_approval(scoped_decision="AcceptForReview")

    def test_blank_scope_reason_fails_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "non-empty"):
            sign_approval(scope_reason="   ")


class CreateDraftExportContractTests(unittest.TestCase):
    def test_accepts_valid_payload(self) -> None:
        create_draft_export()

    def test_blank_authority_profile_fails_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "non-empty"):
            create_draft_export(authority_profile="   ")


class RejectFabricationReleaseContractTests(unittest.TestCase):
    def test_accepts_valid_payload(self) -> None:
        reject_fabrication_release()

    def test_blank_deliverables_digest_fails_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "non-empty"):
            reject_fabrication_release(deliverables_digest="")


class RecordReleasedPackageProjectionContractTests(unittest.TestCase):
    def test_accepts_valid_payload(self) -> None:
        record_released_package_projection()

    def test_blank_units_fails_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "non-empty"):
            record_released_package_projection(units="   ")


class ClosedEnvelopeAuthorityShapeTests(unittest.TestCase):
    """Tests that the AF_UNIX envelope rejects authority-shaped keys.

    The daemon's ``_parse_command`` enforces a closed schema via
    ``_closed_mapping``: any payload that includes an unknown field must
    raise ``CommandAdmissionError`` before any typed command is constructed.
    """

    def test_admit_change_proposal_rejects_authority_keys(self) -> None:
        from piton.service.daemon import CommandAdmissionError, _parse_command

        payload = {
            "command_id": "cmd_admit",
            "project_id": "project_1",
            "proposal_id": "proposal:1",
            "base_revision_id": REVISION_ID,
            "parameter_id": "height",
            "expected_old_quantity": "10 mm",
            "new_quantity": "11 mm",
            "requirement_ids": ["req:1"],
            "fabrication_release": True,
        }
        with self.assertRaises(CommandAdmissionError):
            _parse_command({"command_type": "admit_change_proposal", "payload": payload})

    def test_sign_approval_rejects_authority_keys(self) -> None:
        from piton.service.daemon import CommandAdmissionError, _parse_command

        payload = {
            "command_id": "cmd_sign",
            "project_id": "project_1",
            "receipt_id": "ar:1",
            "revision_id": REVISION_ID,
            "evidence_closure_id": "ec:1",
            "scoped_decision": "accept_for_review",
            "scope_reason": "framework only",
            "declared_at": "2026-08-16T00:00:00Z",
            "approval_authority": "forged",
        }
        with self.assertRaises(CommandAdmissionError):
            _parse_command({"command_type": "sign_approval", "payload": payload})

    def test_reject_fabrication_release_rejects_authority_keys(self) -> None:
        from piton.service.daemon import CommandAdmissionError, _parse_command

        payload = {
            "command_id": "cmd_reject",
            "project_id": "project_1",
            "release_id": "rel:1",
            "approval_receipt_id": "ar:1",
            "revision_id": REVISION_ID,
            "deliverables_digest": ZERO_DIGEST,
            "declared_at": "2026-08-16T00:00:00Z",
            "release_authority": "forged",
        }
        with self.assertRaises(CommandAdmissionError):
            _parse_command(
                {"command_type": "reject_fabrication_release", "payload": payload}
            )

    def test_move_channel_rejects_authority_keys(self) -> None:
        from piton.service.daemon import CommandAdmissionError, _parse_command

        payload = {
            "command_id": "cmd_move",
            "project_id": "project_1",
            "channel": "workspace",
            "target_revision_id": REVISION_ID,
            "expected_revision_id": None,
            "expected_generation": 0,
            "fabrication_releaser": "forged",
        }
        with self.assertRaises(CommandAdmissionError):
            _parse_command({"command_type": "move_channel", "payload": payload})


if __name__ == "__main__":
    unittest.main()
