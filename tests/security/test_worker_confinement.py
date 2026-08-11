from __future__ import annotations

import errno
import hashlib
import io
import os
from pathlib import Path
import stat
import zipfile

import pytest

from piton.precision_worker_launch import (
    sealed_archive_fd,
    validate_admitted_worker_payload,
    validate_execution_archive,
)


def _archive(entries: list[tuple[zipfile.ZipInfo, bytes]]) -> bytes:
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_STORED) as package:
        for info, content in entries:
            package.writestr(info, content)
    return stream.getvalue()


def _regular_info(name: str) -> zipfile.ZipInfo:
    info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
    info.create_system = 3
    info.external_attr = (stat.S_IFREG | 0o400) << 16
    return info


def _manifest_for(name: str, content: bytes) -> dict[str, object]:
    return {
        "bundle_files": [
            {
                "path": name,
                "byte_length": len(content),
                "digest": "sha256:" + hashlib.sha256(content).hexdigest(),
            }
        ]
    }


def test_executable_payload_must_match_the_digest_admitted_for_worker_pin() -> None:
    admitted = {"worker:reviewed": "sha256:" + "1" * 64}

    validate_admitted_worker_payload(
        "worker:reviewed", "sha256:" + "1" * 64, admitted
    )
    with pytest.raises(ValueError, match="admitted worker pin"):
        validate_admitted_worker_payload(
            "worker:reviewed", "sha256:" + "2" * 64, admitted
        )
    with pytest.raises(ValueError, match="admitted worker pin"):
        validate_admitted_worker_payload(
            "worker:unreviewed", "sha256:" + "1" * 64, admitted
        )


def test_sealed_execution_archive_cannot_be_mutated_by_same_uid() -> None:
    fd = sealed_archive_fd(b"reviewed executable bytes")
    try:
        with pytest.raises(OSError) as raised:
            os.pwrite(fd, b"X", 0)
        assert raised.value.errno in {errno.EPERM, errno.EBADF}
        assert os.pread(fd, 25, 0) == b"reviewed executable bytes"
    finally:
        os.close(fd)


def test_sandbox_bootstrap_validates_archive_before_importing_worker_code() -> None:
    from piton.precision_worker_launch import SANDBOX_BOOTSTRAP

    validation = SANDBOX_BOOTSTRAP.index("validate_archive()")
    extraction = SANDBOX_BOOTSTRAP.index("extract_archive(validated)")
    path_admission = SANDBOX_BOOTSTRAP.index("sys.path.insert")
    worker_import = SANDBOX_BOOTSTRAP.index("precision_worker_child")

    assert validation < extraction < path_admission < worker_import


def test_archive_validation_rejects_member_bytes_not_bound_by_bundle_manifest() -> None:
    archive = _archive([(_regular_info("src/piton/worker.py"), b"tampered")])

    with pytest.raises(ValueError, match="digest|length"):
        validate_execution_archive(
            archive, _manifest_for("src/piton/worker.py", b"reviewed")
        )


@pytest.mark.parametrize("kind", ["symlink", "directory"])
def test_archive_validation_rejects_non_regular_members(kind: str) -> None:
    info = zipfile.ZipInfo("src/piton/member", date_time=(1980, 1, 1, 0, 0, 0))
    info.create_system = 3
    content = b"target" if kind == "symlink" else b""
    info.external_attr = (
        (stat.S_IFLNK | 0o777) if kind == "symlink" else (stat.S_IFDIR | 0o700)
    ) << 16
    if kind == "directory":
        info.filename += "/"

    with pytest.raises(ValueError, match="regular|closure"):
        validate_execution_archive(
            _archive([(info, content)]), _manifest_for(info.filename, content)
        )


def test_archive_validation_rejects_unmanifested_and_duplicate_members() -> None:
    duplicate = _archive(
        [
            (_regular_info("src/piton/worker.py"), b"one"),
            (_regular_info("src/piton/worker.py"), b"two"),
        ]
    )
    with pytest.raises(ValueError, match="closure"):
        validate_execution_archive(
            duplicate, _manifest_for("src/piton/worker.py", b"one")
        )

    extra = _archive(
        [
            (_regular_info("src/piton/worker.py"), b"one"),
            (_regular_info("src/piton/extra.py"), b"extra"),
        ]
    )
    with pytest.raises(ValueError, match="closure"):
        validate_execution_archive(extra, _manifest_for("src/piton/worker.py", b"one"))


def test_canonical_build_attempt_tree_is_never_a_writable_sandbox_mount() -> None:
    from piton.precision_worker_launch import sandbox_mount_arguments

    canonical = Path("/daemon/control/build-attempts")
    isolated = Path("/daemon/control/worker-output/private")
    arguments = sandbox_mount_arguments(17, isolated, Path("/runtime"), Path("/venv"))

    writable_sources = [
        arguments[index + 1]
        for index, value in enumerate(arguments[:-2])
        if value == "--bind"
    ]
    assert str(canonical) not in writable_sources
    assert writable_sources == [str(isolated)]
