"""Authority-bound acceptance coverage for precision-worker custody."""
from __future__ import annotations

from datetime import UTC, datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess

import pytest

from piton.parts.l_bracket import DEFAULT_PARAMETERS
from piton.realization import RealizationInputs
from piton.service.application import PitonApplicationService
from piton.storage.build_attempts import BuildAttemptCoordinator, CoordinatorState, DurableBuildAttempt

ROOT = Path(__file__).resolve().parents[2]
DIGEST = "sha256:" + "7" * 64


def _configured_context(tmp_path: Path):
    import piton.precision_worker as worker

    inputs = RealizationInputs.from_repository(ROOT, DEFAULT_PARAMETERS)
    attempt = DurableBuildAttempt(
        attempt_id="attempt_one",
        project_id="project_one",
        revision_id=inputs.revision.revision_id,
        input_manifest_digest=inputs.revision.source_manifest_digest,
        recipe_digest=worker.PINNED_RECIPE_DIGEST,
        toolchain_digest=worker.PINNED_TOOLCHAIN_DIGEST,
        capability_manifest_digest=worker.PINNED_CAPABILITY_DIGEST,
        resource_limits_digest=worker.PINNED_RESOURCE_LIMITS_DIGEST,
        expected_outputs_digest=worker.EXPECTED_OUTPUTS_DIGEST,
        request_signature_digest=DIGEST,
        worker_id=worker.PRECISION_WORKER_ID,
        isolation_class="trusted-local",
        admission_state="admitted",
        admitted_at="2026-08-10T00:00:00Z",
    )
    state = CoordinatorState(
        attempt_id="attempt_one",
        state="running",
        generation=2,
        fence=5,
        lease_id="lease_one",
        lease_expires_at="2026-08-10T01:00:00Z",
        updated_at="2026-08-10T00:00:01Z",
    )
    coordinator = object.__new__(BuildAttemptCoordinator)
    coordinator.get_execution_bindings = lambda project_id, attempt_id: (attempt, state)
    service = PitonApplicationService.open(
        tmp_path,
        precision_inputs=lambda project_id, revision_id, manifest_digest: inputs,
        precision_clock=lambda: datetime(2026, 8, 10, 0, 30, tzinfo=UTC),
    )
    setattr(service, "_PitonApplicationService__build_attempt_coordinator", coordinator)
    return service, inputs


def _configured_service(tmp_path: Path) -> PitonApplicationService:
    service, _ = _configured_context(tmp_path)
    return service


def test_current_worker_pin_admits_the_exact_staged_executable_payload(tmp_path: Path) -> None:
    from piton.launch_verification import CURRENT_PRECISION_WORKER_PIN
    from piton.precision_worker_launch import (
        remove_input_bundle,
        stage_input_bundle,
        worker_payload_digest,
    )
    from piton.worker_admission import ADMITTED_WORKER_PAYLOADS

    inputs = RealizationInputs.from_repository(ROOT, DEFAULT_PARAMETERS)
    bundle, _ = stage_input_bundle(ROOT, tmp_path / ".piton", inputs.revision)
    try:
        assert ADMITTED_WORKER_PAYLOADS[CURRENT_PRECISION_WORKER_PIN] == worker_payload_digest(bundle)
    finally:
        remove_input_bundle(bundle)


def test_worker_authority_is_owned_by_application_service(tmp_path: Path) -> None:
    import piton.precision_worker as worker

    service = _configured_service(tmp_path)
    request = service.issue_precision_worker_request("project_one", "attempt_one")
    result = service.run_precision_worker(request)

    output = tmp_path / ".piton" / "build-attempts" / "project_one" / "attempt_one"
    assert result.status == "succeeded"
    assert (output / "part.step").is_file()
    assert not hasattr(worker, "open_precision_worker_custody")
    assert not hasattr(worker, "BuildAttemptCoordinator")
    assert not hasattr(worker, "_create_precision_worker_request")
    assert not hasattr(worker, "_run_precision_worker")


def test_application_launches_geometry_in_a_credentialless_child_process(
    monkeypatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("PITON_TEST_CREDENTIAL_SENTINEL", "must-not-cross-worker-boundary")
    observed: dict[str, object] = {}
    original_run = subprocess.run

    def capture_run(command, **kwargs):
        observed["command"] = command
        observed["environment"] = kwargs["env"]
        return original_run(command, **kwargs)

    monkeypatch.setattr(subprocess, "run", capture_run)
    service = _configured_service(tmp_path)

    request = service.issue_precision_worker_request("project_one", "attempt_one")
    result = service.run_precision_worker(request)

    assert result.status == "succeeded"
    assert result.environment["worker_pid"] != os.getpid()
    assert result.environment["credential_environment_present"] is False
    assert result.environment["network_isolation_proven"] is False
    assert result.environment["credential_isolation_proven"] is False
    command = observed["command"]
    assert isinstance(command, list)
    assert "--unshare-all" in command
    assert "--clearenv" in command
    assert "PITON_SANDBOX_NETWORK" not in command
    assert "/archive.zip" in command[-1]
    assert observed["environment"] == {"PATH": os.defpath}


def test_child_execution_manifest_is_closed_canonical_and_tamper_evident(tmp_path: Path) -> None:
    from piton.precision_worker_launch import (
        bundle_file_manifest,
        execution_archive,
        execution_manifest,
        remove_input_bundle,
        stage_input_bundle,
        validate_execution_manifest,
    )

    service, inputs = _configured_context(tmp_path)
    request = service.issue_precision_worker_request("project_one", "attempt_one")
    bundle, bundle_digest = stage_input_bundle(ROOT, tmp_path / ".piton", inputs.revision)
    from piton.precision_worker_launch import worker_payload_digest
    archive_digest = "sha256:" + hashlib.sha256(execution_archive(bundle)).hexdigest()
    manifest = execution_manifest(
        request,
        inputs.revision,
        bundle_digest,
        worker_payload_digest(bundle),
        archive_digest,
        bundle_file_manifest(bundle),
    )

    assert set(manifest) == {
        "schema",
        "request",
        "revision",
        "repository_root",
        "control_root",
        "input_bundle_digest",
        "worker_payload_digest",
        "archive_digest",
        "bundle_files",
        "execution_digest",
    }
    assert manifest["request"] == request.to_manifest()
    assert manifest["revision"] == inputs.revision.to_manifest()
    assert manifest["bundle_files"]
    assert {entry["path"] for entry in manifest["bundle_files"]} == {
        path.relative_to(bundle).as_posix()
        for path in bundle.rglob("*")
        if path.is_file()
    }
    assert all(
        set(entry) == {"path", "byte_length", "digest"}
        for entry in manifest["bundle_files"]
    )
    assert manifest["request"]["truth"] == {
        "review_state": "needs_human_review",
        "fabrication_release": False,
        "machine_actuation": False,
    }

    tampered = json.loads(json.dumps(manifest))
    tampered["request"]["fence"] += 1
    with pytest.raises(ValueError, match="execution_digest"):
        validate_execution_manifest(tampered)

    extended = json.loads(json.dumps(manifest))
    extended["credential"] = "forbidden"
    with pytest.raises(ValueError, match="fields"):
        validate_execution_manifest(extended)

    assert bundle.is_dir()
    remove_input_bundle(bundle)
    assert not bundle.exists()


def test_worker_input_snapshot_is_unchanged_when_checkout_changes(tmp_path: Path) -> None:
    from piton.precision_worker_launch import (
        input_bundle_digest,
        remove_input_bundle,
        stage_input_bundle,
    )

    repository = tmp_path / "repository"
    shutil.copytree(ROOT / "src" / "piton", repository / "src" / "piton")
    shutil.copyfile(ROOT / "uv.lock", repository / "uv.lock")
    shutil.copyfile(ROOT / "pyproject.toml", repository / "pyproject.toml")
    inputs = RealizationInputs.from_repository(repository, DEFAULT_PARAMETERS)
    control_root = tmp_path / "control"
    control_root.mkdir()

    bundle, admitted_digest = stage_input_bundle(repository, control_root, inputs.revision)
    mutable_source = repository / "src" / "piton" / "parts" / "l_bracket.py"
    mutable_source.write_bytes(mutable_source.read_bytes() + b"\n# post-admission mutation\n")

    assert input_bundle_digest(bundle) == admitted_digest
    assert (bundle / "src" / "piton" / "parts" / "l_bracket.py").read_bytes() != (
        mutable_source.read_bytes()
    )
    remove_input_bundle(bundle)


def test_worker_rejects_symlinked_project_output_ancestor(tmp_path: Path) -> None:
    service = _configured_service(tmp_path)
    outside = tmp_path / "outside"
    outside.mkdir()
    build_attempts = tmp_path / ".piton" / "build-attempts"
    build_attempts.mkdir(parents=True)
    (build_attempts / "project_one").symlink_to(outside, target_is_directory=True)

    request = service.issue_precision_worker_request("project_one", "attempt_one")
    result = service.run_precision_worker(request)

    assert result.status == "blocked"
    assert result.diagnostics == ("attempt output custody is unsafe",)
    assert list(outside.iterdir()) == []
    assert not (outside / "attempt_one").exists()
    assert (build_attempts / "project_one").is_symlink()


def test_worker_keeps_realization_on_pinned_parent_during_replacement_race(
    monkeypatch, tmp_path: Path
) -> None:
    import piton.precision_worker as worker

    service, inputs = _configured_context(tmp_path)
    outside = tmp_path / "outside"
    outside.mkdir()
    build_attempts = tmp_path / ".piton" / "build-attempts"
    original = worker.realize_exact

    def replace_parent_then_realize(revision, inputs, attempt_directory, *, parent_fd=None):
        assert parent_fd is not None
        (build_attempts / "project_one").rename(build_attempts / "project_relocated")
        (build_attempts / "project_one").symlink_to(outside, target_is_directory=True)
        return original(revision, inputs, attempt_directory, parent_fd=parent_fd)

    monkeypatch.setattr(worker, "realize_exact", replace_parent_then_realize)
    request = service.issue_precision_worker_request("project_one", "attempt_one")
    result = worker.execute_precision_worker(
        request, inputs.revision, inputs, tmp_path / ".piton"
    )

    assert result.status == "succeeded"
    assert list(outside.iterdir()) == []
    assert (build_attempts / "project_relocated" / "attempt_one" / "part.step").is_file()


def test_worker_does_not_delete_or_replace_raced_attempt_entry(
    monkeypatch, tmp_path: Path
) -> None:
    import piton.precision_worker as worker

    service, inputs = _configured_context(tmp_path)
    original = worker.realize_exact

    def insert_attempt_then_realize(revision, inputs, attempt_directory, *, parent_fd=None):
        assert parent_fd is not None
        os.mkdir("attempt_one", mode=0o700, dir_fd=parent_fd)
        marker_fd = os.open(
            "attempt_one/attacker-owned.txt",
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_CLOEXEC,
            0o600,
            dir_fd=parent_fd,
        )
        os.write(marker_fd, b"owned elsewhere")
        os.close(marker_fd)
        return original(revision, inputs, attempt_directory, parent_fd=parent_fd)

    monkeypatch.setattr(worker, "realize_exact", insert_attempt_then_realize)
    request = service.issue_precision_worker_request("project_one", "attempt_one")
    result = worker.execute_precision_worker(
        request, inputs.revision, inputs, tmp_path / ".piton"
    )

    project = tmp_path / ".piton" / "build-attempts" / "project_one"
    assert result.status == "failed"
    assert (project / "attempt_one" / "attacker-owned.txt").read_bytes() == b"owned elsewhere"
    assert not (project / "attempt_one" / "part.step").exists()


def test_worker_keeps_published_inode_pinned_during_destination_swap(
    monkeypatch, tmp_path: Path
) -> None:
    import piton.precision_worker as worker
    import piton.realization as realization

    service, inputs = _configured_context(tmp_path)
    original = realization._rename_no_replace

    def publish_then_swap(parent_fd: int, source: str, destination: str) -> None:
        original(parent_fd, source, destination)
        os.rename(destination, "relocated_attempt", src_dir_fd=parent_fd, dst_dir_fd=parent_fd)
        os.mkdir(destination, mode=0o700, dir_fd=parent_fd)

    monkeypatch.setattr(realization, "_rename_no_replace", publish_then_swap)
    request = service.issue_precision_worker_request("project_one", "attempt_one")
    result = worker.execute_precision_worker(
        request, inputs.revision, inputs, tmp_path / ".piton"
    )

    project = tmp_path / ".piton" / "build-attempts" / "project_one"
    assert result.status == "failed"
    assert result.expected_output_closure is False
    assert (project / "relocated_attempt" / "part.step").is_file()
    assert list((project / "attempt_one").iterdir()) == []


def test_review_generation_stays_on_pinned_attempt_during_destination_swap(
    monkeypatch, tmp_path: Path
) -> None:
    import piton.precision_worker as worker

    service, inputs = _configured_context(tmp_path)
    original = worker.derive_review_derivatives
    outside = tmp_path / "outside-review"
    outside.mkdir()

    def swap_attempt_then_derive(source, policy, output_directory):
        project = tmp_path / ".piton" / "build-attempts" / "project_one"
        (project / "attempt_one").rename(project / "relocated_attempt")
        (project / "attempt_one").symlink_to(outside, target_is_directory=True)
        return original(source, policy, output_directory)

    monkeypatch.setattr(worker, "derive_review_derivatives", swap_attempt_then_derive)
    request = service.issue_precision_worker_request("project_one", "attempt_one")
    result = worker.execute_precision_worker(
        request, inputs.revision, inputs, tmp_path / ".piton"
    )

    project = tmp_path / ".piton" / "build-attempts" / "project_one"
    assert result.status == "failed"
    assert result.expected_output_closure is False
    assert list(outside.iterdir()) == []
    assert (project / "relocated_attempt" / "review" / "glb.receipt.json").is_file()
