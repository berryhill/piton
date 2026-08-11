"""Authority-bound acceptance coverage for precision-worker custody."""
from __future__ import annotations

from datetime import UTC, datetime
import os
from pathlib import Path

from piton.parts.l_bracket import DEFAULT_PARAMETERS
from piton.realization import RealizationInputs
from piton.service.application import PitonApplicationService
from piton.storage.build_attempts import BuildAttemptCoordinator, CoordinatorState, DurableBuildAttempt

ROOT = Path(__file__).resolve().parents[2]
DIGEST = "sha256:" + "7" * 64


def _configured_service(tmp_path: Path) -> PitonApplicationService:
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
    return service


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

    service = _configured_service(tmp_path)
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
    result = service.run_precision_worker(request)

    assert result.status == "succeeded"
    assert list(outside.iterdir()) == []
    assert (build_attempts / "project_relocated" / "attempt_one" / "part.step").is_file()


def test_worker_does_not_delete_or_replace_raced_attempt_entry(
    monkeypatch, tmp_path: Path
) -> None:
    import piton.precision_worker as worker

    service = _configured_service(tmp_path)
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
    result = service.run_precision_worker(request)

    project = tmp_path / ".piton" / "build-attempts" / "project_one"
    assert result.status == "failed"
    assert (project / "attempt_one" / "attacker-owned.txt").read_bytes() == b"owned elsewhere"
    assert not (project / "attempt_one" / "part.step").exists()


def test_worker_keeps_published_inode_pinned_during_destination_swap(
    monkeypatch, tmp_path: Path
) -> None:
    import piton.realization as realization

    service = _configured_service(tmp_path)
    original = realization._rename_no_replace

    def publish_then_swap(parent_fd: int, source: str, destination: str) -> None:
        original(parent_fd, source, destination)
        os.rename(destination, "relocated_attempt", src_dir_fd=parent_fd, dst_dir_fd=parent_fd)
        os.mkdir(destination, mode=0o700, dir_fd=parent_fd)

    monkeypatch.setattr(realization, "_rename_no_replace", publish_then_swap)
    request = service.issue_precision_worker_request("project_one", "attempt_one")
    result = service.run_precision_worker(request)

    project = tmp_path / ".piton" / "build-attempts" / "project_one"
    assert result.status == "failed"
    assert result.expected_output_closure is False
    assert (project / "relocated_attempt" / "part.step").is_file()
    assert list((project / "attempt_one").iterdir()) == []
