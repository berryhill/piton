from __future__ import annotations

import os
import stat
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

from piton.precision_worker_launch import preflight_precision_worker_sandbox


TRUSTED_MODE = stat.S_IFREG | 0o755


def _metadata(*, mode: int = TRUSTED_MODE, uid: int = 0) -> SimpleNamespace:
    return SimpleNamespace(st_mode=mode, st_uid=uid)


def test_runtime_and_ci_reuse_the_shared_executable_trust_definition() -> None:
    application = (Path(__file__).parents[1] / "src/piton/service/application.py").read_text(
        encoding="utf-8"
    )

    assert "sandbox = trusted_precision_worker_sandbox()" in application
    assert "sandbox_metadata.st_uid" not in application


def test_sandbox_preflight_reports_missing_executable_deterministically(tmp_path: Path) -> None:
    missing = tmp_path / "bwrap"

    with pytest.raises(RuntimeError, match="^precision worker sandbox is unavailable$"):
        preflight_precision_worker_sandbox(missing)


def test_sandbox_preflight_rejects_each_untrusted_executable_property(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    sandbox = tmp_path / "bwrap"
    sandbox.write_bytes(b"not executed")

    for metadata, executable in (
        (_metadata(mode=stat.S_IFDIR | 0o755), True),
        (_metadata(uid=1000), True),
        (_metadata(mode=stat.S_IFREG | 0o775), True),
        (_metadata(), False),
    ):
        monkeypatch.setattr(Path, "stat", lambda self, value=metadata: value)
        monkeypatch.setattr(os, "access", lambda path, mode, value=executable: value)
        with pytest.raises(
            RuntimeError, match="^precision worker sandbox executable is not trusted$"
        ):
            preflight_precision_worker_sandbox(
                sandbox,
                runner=lambda *args, **kwargs: subprocess.CompletedProcess(args[0], 0),
            )


def test_sandbox_preflight_reports_namespace_policy_rejection_deterministically(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    sandbox = tmp_path / "bwrap"
    sandbox.write_bytes(b"not executed")

    monkeypatch.setattr(Path, "stat", lambda self: _metadata())
    monkeypatch.setattr(os, "access", lambda path, mode: True)
    with pytest.raises(
        RuntimeError, match="^precision worker sandbox preflight failed: sandbox_namespace_policy_rejected$"
    ):
        preflight_precision_worker_sandbox(
            sandbox,
            runner=lambda *args, **kwargs: subprocess.CompletedProcess(args[0], 1),
        )


def test_sandbox_preflight_reports_timeout_as_namespace_policy_rejection(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    sandbox = tmp_path / "bwrap"
    sandbox.write_bytes(b"not executed")

    def timeout(command, **kwargs):
        raise subprocess.TimeoutExpired(command, kwargs["timeout"])

    monkeypatch.setattr(Path, "stat", lambda self: _metadata())
    monkeypatch.setattr(os, "access", lambda path, mode: True)
    with pytest.raises(
        RuntimeError, match="^precision worker sandbox preflight failed: sandbox_namespace_policy_rejected$"
    ):
        preflight_precision_worker_sandbox(sandbox, runner=timeout)


def test_sandbox_preflight_launch_is_bounded_and_returns_trusted_path(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    sandbox = tmp_path / "bwrap"
    sandbox.write_bytes(b"not executed")
    observed: dict[str, object] = {}

    def succeed(command, **kwargs):
        observed["command"] = command
        observed["kwargs"] = kwargs
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr(Path, "stat", lambda self: _metadata())
    monkeypatch.setattr(os, "access", lambda path, mode: True)
    result = preflight_precision_worker_sandbox(
        sandbox,
        runner=succeed,
    )

    assert result == sandbox
    assert observed["command"] == [
        str(sandbox),
        "--die-with-parent",
        "--new-session",
        "--unshare-all",
        "--ro-bind",
        "/usr",
        "/usr",
        "--ro-bind",
        "/lib",
        "/lib",
        "--ro-bind",
        "/lib64",
        "/lib64",
        "--proc",
        "/proc",
        "--dev",
        "/dev",
        "--",
        "/usr/bin/true",
    ]
    assert observed["kwargs"] == {
        "stdin": subprocess.DEVNULL,
        "stdout": subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
        "cwd": "/",
        "env": {"PATH": os.defpath},
        "close_fds": True,
        "check": False,
        "timeout": 10,
    }
