"""Acceptance tests for the pinned trusted-local precision worker."""
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
    execute_precision_worker,
    verify_precision_worker_result,
)
from piton.realization import RealizationInputs
from piton.service.application import PitonApplicationService
from piton.storage.build_attempts import BuildAttemptCoordinator, CoordinatorState, DurableBuildAttempt
from piton.worker_contracts import PrecisionWorkerResult

ROOT = Path(__file__).resolve().parents[2]
DIGEST = "sha256:" + "7" * 64


def context(tmp_path: Path):
    inputs = RealizationInputs.from_repository(ROOT, DEFAULT_PARAMETERS)
    attempt = DurableBuildAttempt(
        attempt_id="attempt_one",
        project_id="project_one",
        revision_id=inputs.revision.revision_id,
        input_manifest_digest=inputs.revision.source_manifest_digest,
        recipe_digest=PINNED_RECIPE_DIGEST,
        toolchain_digest=PINNED_TOOLCHAIN_DIGEST,
        capability_manifest_digest=PINNED_CAPABILITY_DIGEST,
        resource_limits_digest=PINNED_RESOURCE_LIMITS_DIGEST,
        expected_outputs_digest=EXPECTED_OUTPUTS_DIGEST,
        request_signature_digest=DIGEST,
        worker_id=PRECISION_WORKER_ID,
        isolation_class="trusted-local",
        admission_state="admitted",
        admitted_at="2026-08-10T00:00:00Z",
    )
    state = CoordinatorState(
        attempt_id=attempt.attempt_id,
        state="running",
        generation=2,
        fence=5,
        lease_id="lease_one",
        lease_expires_at="2026-08-10T01:00:00Z",
        updated_at="2026-08-10T00:00:01Z",
    )
    custody = object.__new__(BuildAttemptCoordinator)
    custody.get_execution_bindings = lambda project_id, attempt_id: (attempt, state)
    worker_custody = PitonApplicationService.open(
        tmp_path,
        precision_inputs=lambda project_id, revision_id, manifest_digest: inputs,
        precision_clock=lambda: datetime(2026, 8, 10, 0, 30, tzinfo=UTC),
    )
    setattr(worker_custody, "_PitonApplicationService__build_attempt_coordinator", custody)
    request = worker_custody.issue_precision_worker_request("project_one", "attempt_one")
    return inputs, attempt, state, request, worker_custody


def test_worker_closes_exact_outputs_and_result_is_deeply_immutable(tmp_path: Path) -> None:
    inputs, attempt, state, request, dispatcher = context(tmp_path)
    output = tmp_path / ".piton" / "build-attempts" / "project_one" / "attempt_one"

    result = dispatcher.run_precision_worker(request)
    verified = verify_precision_worker_result(request, result, output)
    rebuilt = PrecisionWorkerResult.from_manifest(json.loads(result.canonical_bytes))

    assert verified is result
    assert rebuilt == result
    assert result.status == "succeeded"
    assert result.request_digest == request.request_digest
    assert result.project_id == attempt.project_id
    assert result.revision_id == attempt.revision_id
    assert result.generation == state.generation
    assert result.fence == state.fence
    assert result.lease_id == state.lease_id
    assert result.isolation_class == "trusted-local"
    assert result.authenticated is False
    assert result.result_signature_ref is None
    assert result.environment["network_isolation_proven"] is False
    assert result.environment["credential_isolation_proven"] is False
    forged = replace(
        result,
        environment={
            **result.environment,
            "network_isolation_proven": True,
        },
    )
    with pytest.raises(ValueError, match="overclaims network isolation"):
        verify_precision_worker_result(request, forged, output)
    assert set(result.artifacts) == {
        "exact_brep",
        "inspection_receipt",
        "review_glb",
        "review_glb_receipt",
        "review_selection_map",
        "review_selection_map_receipt",
        "step",
    }
    assert result.expected_output_closure is True
    assert result.artifacts["review_glb"].claim_scope == "review-only"
    assert (
        result.artifacts["review_selection_map"].claim_scope
        == "artifact-local-review-selection-only"
    )
    assert result.truth["review_state"] == "needs_human_review"
    assert result.truth["fabrication_release"] is False
    assert result.truth["machine_actuation"] is False
    with pytest.raises(FrozenInstanceError):
        result.status = "failed"  # type: ignore[misc]
    with pytest.raises(TypeError):
        result.artifacts["extra"] = result.artifacts["step"]  # type: ignore[index]
    with pytest.raises(TypeError):
        result.environment["network_isolation"] = True  # type: ignore[index]


def test_direct_worker_cannot_mint_network_isolation_from_ambient_state(
    monkeypatch, tmp_path: Path
) -> None:
    inputs, attempt, state, request, dispatcher = context(tmp_path)
    monkeypatch.setenv("PITON_SANDBOX_NETWORK", "unshared")

    result = execute_precision_worker(
        request, inputs.revision, inputs, tmp_path / ".piton"
    )

    assert result.status == "succeeded"
    assert result.environment["network_isolation_proven"] is False
    assert "isolation_evidence_source" not in result.environment
    verify_precision_worker_result(
        request,
        result,
        tmp_path / ".piton" / "build-attempts" / "project_one" / "attempt_one",
    )


def test_stale_or_cross_attempt_request_is_rejected_before_geometry(tmp_path: Path) -> None:
    inputs, attempt, state, request, dispatcher = context(tmp_path)
    for stale_state in (
        replace(state, fence=state.fence + 1),
        replace(state, generation=state.generation + 1),
        replace(state, lease_id="lease_two"),
    ):
        output = tmp_path / ".piton" / "build-attempts" / "project_one" / "attempt_one"
        stale_coordinator = object.__new__(BuildAttemptCoordinator)
        stale_coordinator.get_execution_bindings = (
            lambda project_id, attempt_id, stale_state=stale_state: (attempt, stale_state)
        )
        stale_custody = PitonApplicationService.open(
            tmp_path,
            precision_inputs=lambda project_id, revision_id, manifest_digest: inputs,
            precision_clock=lambda: datetime(2026, 8, 10, 0, 30, tzinfo=UTC),
        )
        setattr(
            stale_custody,
            "_PitonApplicationService__build_attempt_coordinator",
            stale_coordinator,
        )
        with pytest.raises(ValueError, match="request"):
            stale_custody.run_precision_worker(request)
        assert not output.exists()


def test_existing_output_is_blocked_without_overwrite(tmp_path: Path) -> None:
    inputs, attempt, state, request, dispatcher = context(tmp_path)
    output = tmp_path / ".piton" / "build-attempts" / "project_one" / "attempt_one"
    output.mkdir(parents=True)
    marker = output / "keep.txt"
    marker.write_text("unchanged", encoding="utf-8")

    result = dispatcher.run_precision_worker(request)

    assert result.status == "blocked"
    assert result.artifacts == {}
    assert result.expected_output_closure is False
    assert result.diagnostics == ("attempt output already exists",)
    assert marker.read_text(encoding="utf-8") == "unchanged"


def test_tampered_artifact_and_result_fail_verification(tmp_path: Path) -> None:
    inputs, attempt, state, request, dispatcher = context(tmp_path)
    output = tmp_path / ".piton" / "build-attempts" / "project_one" / "attempt_one"
    result = dispatcher.run_precision_worker(request)

    (output / "part.step").write_bytes(b"tampered")
    with pytest.raises(ValueError, match="digest"):
        verify_precision_worker_result(request, result, output)

    with pytest.raises(ValueError, match="request"):
        verify_precision_worker_result(replace(request, fence=request.fence + 1), result, output)

    manifest = json.loads(result.canonical_bytes)
    manifest["fence"] += 1
    with pytest.raises(ValueError, match="result_digest"):
        PrecisionWorkerResult.from_manifest(manifest)


def test_review_artifacts_are_independently_receipted_from_verified_exact_bytes(
    tmp_path: Path,
) -> None:
    inputs, attempt, state, request, dispatcher = context(tmp_path)
    output = tmp_path / ".piton" / "build-attempts" / "project_one" / "attempt_one"

    result = dispatcher.run_precision_worker(request)
    glb_receipt = json.loads((output / "review" / "glb.receipt.json").read_bytes())
    selection_receipt = json.loads(
        (output / "review" / "selection-map.receipt.json").read_bytes()
    )

    assert glb_receipt["source_build_attempt_scope"] == attempt.attempt_id
    assert glb_receipt["source_exact_brep_digest"] == result.artifacts["exact_brep"].digest
    assert glb_receipt["source_exact_receipt_digest"] == result.artifacts["inspection_receipt"].digest
    assert glb_receipt["claim_scope"] == "review-only"
    assert glb_receipt["selection_map_digest"] == result.artifacts["review_selection_map"].digest
    assert selection_receipt["source_exact_brep_digest"] == result.artifacts["exact_brep"].digest
    assert selection_receipt["claim_scope"] == "artifact-local-review-selection-only"
    assert glb_receipt["fabrication_release"] is False
    assert selection_receipt["machine_actuation"] is False

    (output / result.artifacts["review_glb"].relative_path).write_bytes(b"tampered")
    with pytest.raises(ValueError, match="digest"):
        verify_precision_worker_result(request, result, output)


def test_result_copies_caller_owned_nested_values(tmp_path: Path) -> None:
    inputs, attempt, state, request, dispatcher = context(tmp_path)
    produced = dispatcher.run_precision_worker(request)
    toolchain = dict(produced.toolchain)
    environment = dict(produced.environment)
    artifacts = dict(produced.artifacts)
    diagnostics = list(produced.diagnostics)
    copied = PrecisionWorkerResult(
        **{
            name: getattr(produced, name)
            for name in (
                "project_id",
                "revision_id",
                "attempt_id",
                "generation",
                "fence",
                "lease_id",
                "request_digest",
                "status",
                "worker_id",
                "worker_pin",
                "toolchain_digest",
                "isolation_class",
                "authenticated",
                "result_signature_ref",
                "expected_output_closure",
                "truth",
            )
        },
        toolchain=toolchain,
        environment=environment,
        artifacts=artifacts,
        diagnostics=diagnostics,
    )
    canonical = copied.canonical_bytes
    toolchain["python"] = "changed"
    environment["network_isolation_proven"] = True
    artifacts.clear()
    diagnostics.append("changed")
    assert copied.canonical_bytes == canonical


def test_toolchain_mismatch_fails_before_creating_output(monkeypatch, tmp_path: Path) -> None:
    inputs, attempt, state, request, dispatcher = context(tmp_path)
    monkeypatch.setattr(
        "piton.realization.importlib.metadata.version",
        lambda package: "0.0.0" if package == "build123d" else "7.9.3.1",
    )
    output = tmp_path / ".piton" / "build-attempts" / "project_one" / "attempt_one"

    result = execute_precision_worker(
        request, inputs.revision, inputs, tmp_path / ".piton"
    )

    assert result.status == "failed"
    assert result.artifacts == {}
    assert result.expected_output_closure is False
    assert result.diagnostics == ("exact realization blocked by toolchain mismatch",)
    assert not output.exists()
    with pytest.raises(ValueError, match="overclaims network isolation"):
        verify_precision_worker_result(
            request,
            replace(result, environment={"network_isolation_proven": True}),
            output,
        )


def test_symlinked_project_output_ancestor_fails_before_any_external_write(
    tmp_path: Path,
) -> None:
    inputs, attempt, state, request, dispatcher = context(tmp_path)
    outside = tmp_path / "outside-worker-custody"
    outside.mkdir()
    build_attempts = tmp_path / ".piton" / "build-attempts"
    build_attempts.mkdir()
    (build_attempts / "project_one").symlink_to(outside, target_is_directory=True)

    result = dispatcher.run_precision_worker(request)

    assert result.status == "blocked"
    assert result.artifacts == {}
    assert result.expected_output_closure is False
    assert result.diagnostics == ("attempt output custody is unsafe",)
    assert list(outside.iterdir()) == []
    with pytest.raises(ValueError, match="overclaims credential isolation"):
        verify_precision_worker_result(
            request,
            replace(result, environment={"credential_isolation_proven": True}),
            outside,
        )
