"""Acceptance tests for immutable precision-worker request/result contracts."""
from __future__ import annotations

import json
from dataclasses import FrozenInstanceError, replace
from datetime import UTC, datetime
from pathlib import Path

import pytest

from piton.parts.l_bracket import DEFAULT_PARAMETERS
from piton.precision_worker import (
    EXPECTED_OUTPUTS_DIGEST,
    PINNED_CAPABILITY_DIGEST,
    PINNED_RECIPE_DIGEST,
    PINNED_RESOURCE_LIMITS_DIGEST,
    PINNED_TOOLCHAIN_DIGEST,
    PRECISION_WORKER_ID,
)
from piton.realization import RealizationInputs
from piton.service.application import PitonApplicationService
from piton.storage.build_attempts import BuildAttemptCoordinator, CoordinatorState, DurableBuildAttempt
from piton.worker_contracts import PrecisionWorkerRequest

ROOT = Path(__file__).resolve().parents[2]
SIGNATURE_REF = "sha256:" + "7" * 64


def admitted(inputs: RealizationInputs, **changes) -> DurableBuildAttempt:
    values = {
        "attempt_id": "attempt_one",
        "project_id": "project_one",
        "revision_id": inputs.revision.revision_id,
        "input_manifest_digest": inputs.revision.source_manifest_digest,
        "recipe_digest": PINNED_RECIPE_DIGEST,
        "toolchain_digest": PINNED_TOOLCHAIN_DIGEST,
        "capability_manifest_digest": PINNED_CAPABILITY_DIGEST,
        "resource_limits_digest": PINNED_RESOURCE_LIMITS_DIGEST,
        "expected_outputs_digest": EXPECTED_OUTPUTS_DIGEST,
        "request_signature_digest": SIGNATURE_REF,
        "worker_id": PRECISION_WORKER_ID,
        "isolation_class": "trusted-local",
        "admission_state": "admitted",
        "admitted_at": "2026-08-10T00:00:00Z",
    }
    values.update(changes)
    return DurableBuildAttempt(**values)


def leased(**changes) -> CoordinatorState:
    values = {
        "attempt_id": "attempt_one",
        "state": "running",
        "generation": 3,
        "fence": 9,
        "lease_id": "lease_one",
        "lease_expires_at": "2026-08-10T01:00:00Z",
        "updated_at": "2026-08-10T00:00:01Z",
    }
    values.update(changes)
    return CoordinatorState(**values)


def request(tmp_path: Path) -> PrecisionWorkerRequest:
    inputs = RealizationInputs.from_repository(ROOT, DEFAULT_PARAMETERS)
    custody = object.__new__(BuildAttemptCoordinator)
    custody.get_execution_bindings = lambda project_id, attempt_id: (admitted(inputs), leased())
    worker_custody = PitonApplicationService.open(
        tmp_path,
        precision_inputs=lambda project_id, revision_id, manifest_digest: inputs,
        precision_clock=lambda: datetime(2026, 8, 10, 0, 30, tzinfo=UTC),
    )
    setattr(worker_custody, "_PitonApplicationService__build_attempt_coordinator", custody)
    return worker_custody.issue_precision_worker_request("project_one", "attempt_one")


def test_request_is_deeply_immutable_and_canonical(tmp_path: Path) -> None:
    first = request(tmp_path)
    second = PrecisionWorkerRequest.from_manifest(json.loads(first.canonical_bytes))

    assert first == second
    assert first.canonical_bytes == second.canonical_bytes
    assert first.request_digest == second.request_digest
    assert tuple(first.expected_outputs) == ("exact_brep", "inspection_receipt", "step")
    assert first.truth == {
        "fabrication_release": False,
        "machine_actuation": False,
        "review_state": "needs_human_review",
    }
    with pytest.raises(FrozenInstanceError):
        first.fence = 10  # type: ignore[misc]
    with pytest.raises(TypeError):
        first.truth["fabrication_release"] = True  # type: ignore[index]


def test_identity_bearing_mutation_changes_identity_or_is_rejected(tmp_path: Path) -> None:
    original = request(tmp_path)
    changed = replace(original, fence=original.fence + 1)
    assert changed.request_digest != original.request_digest

    manifest = json.loads(original.canonical_bytes)
    manifest["unknown"] = "not allowed"
    with pytest.raises(ValueError, match="fields"):
        PrecisionWorkerRequest.from_manifest(manifest)
    manifest = json.loads(original.canonical_bytes)
    manifest["truth"]["fabrication_release"] = True
    with pytest.raises(ValueError, match="fabrication_release"):
        PrecisionWorkerRequest.from_manifest(manifest)


@pytest.mark.parametrize(
    ("attempt_changes", "state_changes", "message"),
    (
        ({"project_id": ""}, {}, "project"),
        ({"revision_id": "rev_" + "0" * 64}, {}, "revision"),
        ({"input_manifest_digest": "sha256:" + "0" * 64}, {}, "input manifest"),
        ({"recipe_digest": "sha256:" + "0" * 64}, {}, "recipe"),
        ({"toolchain_digest": "sha256:" + "0" * 64}, {}, "toolchain"),
        ({"capability_manifest_digest": "sha256:" + "0" * 64}, {}, "capability manifest"),
        ({"resource_limits_digest": "sha256:" + "0" * 64}, {}, "resource limits"),
        ({"expected_outputs_digest": "sha256:" + "0" * 64}, {}, "expected outputs"),
        ({"worker_id": "other_worker"}, {}, "worker"),
        ({"isolation_class": "container"}, {}, "trusted-local"),
        ({}, {"attempt_id": "attempt_two"}, "attempt"),
        ({}, {"state": "admitted"}, "running"),
        ({}, {"lease_id": None}, "lease"),
        ({}, {"lease_expires_at": None}, "lease expiry"),
        ({}, {"generation": -1}, "generation"),
        ({}, {"fence": -1}, "fence"),
    ),
)
def test_request_construction_fails_closed_on_authority_mismatch(
    attempt_changes: dict[str, object],
    state_changes: dict[str, object],
    message: str,
    tmp_path: Path,
) -> None:
    inputs = RealizationInputs.from_repository(ROOT, DEFAULT_PARAMETERS)
    with pytest.raises(ValueError, match=message):
        custody = object.__new__(BuildAttemptCoordinator)
        custody.get_execution_bindings = lambda project_id, attempt_id: (
            admitted(inputs, **attempt_changes), leased(**state_changes)
        )
        service = PitonApplicationService.open(
            tmp_path,
            precision_inputs=lambda project_id, revision_id, manifest_digest: inputs,
            precision_clock=lambda: datetime(2026, 8, 10, 0, 30, tzinfo=UTC),
        )
        setattr(service, "_PitonApplicationService__build_attempt_coordinator", custody)
        service.issue_precision_worker_request("project_one", "attempt_one")


def test_request_authority_has_no_importable_issuer_or_caller_dto_bypass() -> None:
    import piton.precision_worker as worker

    assert not hasattr(worker, "create_precision_worker_request")
    assert not hasattr(worker, "run_precision_worker")
    assert not hasattr(worker, "_issue_worker_request_capability")
    assert not hasattr(worker, "open_precision_worker_custody")
    assert not hasattr(worker, "BuildAttemptCoordinator")


def test_expired_lease_is_rejected_by_trusted_clock(tmp_path: Path) -> None:
    inputs = RealizationInputs.from_repository(ROOT, DEFAULT_PARAMETERS)
    custody = object.__new__(BuildAttemptCoordinator)
    custody.get_execution_bindings = lambda project_id, attempt_id: (admitted(inputs), leased())
    worker_custody = PitonApplicationService.open(
        tmp_path,
        precision_inputs=lambda project_id, revision_id, manifest_digest: inputs,
        precision_clock=lambda: datetime(2026, 8, 10, 1, 0, tzinfo=UTC),
    )
    setattr(worker_custody, "_PitonApplicationService__build_attempt_coordinator", custody)
    with pytest.raises(ValueError, match="expired"):
        worker_custody.issue_precision_worker_request("project_one", "attempt_one")


def test_contract_rejects_malformed_and_non_lowercase_digests(tmp_path: Path) -> None:
    manifest = json.loads(request(tmp_path).canonical_bytes)
    manifest["toolchain_digest"] = "sha256:" + "A" * 64
    with pytest.raises(ValueError, match="toolchain_digest"):
        PrecisionWorkerRequest.from_manifest(manifest)


def test_request_copies_caller_owned_nested_values(tmp_path: Path) -> None:
    original = request(tmp_path)
    outputs = list(original.expected_outputs)
    truth = dict(original.truth)
    copied = PrecisionWorkerRequest(
        **{
            name: getattr(original, name)
            for name in (
                "project_id",
                "revision_id",
                "attempt_id",
                "generation",
                "fence",
                "lease_id",
                "input_manifest_digest",
                "recipe_digest",
                "toolchain_digest",
                "capability_manifest_digest",
                "resource_limits_digest",
                "expected_outputs_digest",
                "request_signature_ref",
                "worker_id",
                "worker_pin",
                "isolation_class",
            )
        },
        expected_outputs=outputs,
        truth=truth,
    )
    canonical = copied.canonical_bytes
    outputs.append("extra")
    truth["fabrication_release"] = True
    assert copied.canonical_bytes == canonical
