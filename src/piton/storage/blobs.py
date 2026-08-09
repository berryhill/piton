"""Same-filesystem, immutable SHA-256 object custody.

Blob publication is deliberately separate from revision, review, approval, export,
and release state.  This module only turns independently validated bytes into an
immutable object reference; it grants no lifecycle authority.
"""

from __future__ import annotations

import errno
import hashlib
import json
import os
import re
import stat
import struct
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO, Iterable

_DIGEST_PATTERN = re.compile(r"^sha256:[0-9a-f]{64}$")
_COMPONENT_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
_MEDIA_TYPE_PATTERN = re.compile(
    r"^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$"
)
_CHUNK_SIZE = 1024 * 1024


class CustodyError(RuntimeError):
    """Base class for a fail-closed local object-custody failure."""


class BlobValidationError(CustodyError):
    """Bytes do not satisfy their independently checked custody claims."""


class BlobCollisionError(CustodyError):
    """A digest path exists but does not contain the claimed bytes."""


@dataclass(frozen=True)
class StagedBlob:
    scope_id: str
    role: str
    path: Path
    digest: str
    byte_length: int
    media_type: str


@dataclass(frozen=True)
class ArtifactRef:
    digest: str
    byte_length: int
    media_type: str
    storage_relpath: str


class BlobStore:
    """Project-local SHA-256 store with same-filesystem staging and no clobber."""

    def __init__(self, project_root: Path | str):
        root = Path(project_root)
        root.mkdir(parents=True, exist_ok=True)
        if root.is_symlink():
            raise CustodyError("project root must not be a symbolic link")
        self.project_root = root.resolve(strict=True)
        self.control_root = self.project_root / ".piton"
        self.objects_root = self.control_root / "objects" / "sha256"
        self.staging_root = self.control_root / "staging"
        self.quarantine_root = self.control_root / "quarantine"
        for directory in (
            self.control_root,
            self.objects_root,
            self.staging_root,
            self.quarantine_root,
        ):
            self._mkdir_owned(directory)
        self._require_same_filesystem()

    def stage_stream(
        self,
        scope_id: str,
        role: str,
        chunks: Iterable[bytes],
        *,
        media_type: str,
        max_bytes: int,
    ) -> StagedBlob:
        """Bound and stage a byte stream without trusting a caller filename."""
        self._require_component("scope_id", scope_id)
        self._require_component("role", role)
        self._require_media_type(media_type)
        if isinstance(max_bytes, bool) or not isinstance(max_bytes, int) or max_bytes < 0:
            raise ValueError("max_bytes must be a non-negative integer")
        self._require_same_filesystem()

        scope_dir = self.staging_root / scope_id
        filename = f"{role}-{uuid.uuid4().hex}.blob"
        directory_fd = self._open_or_create_child_directory(
            self.staging_root, scope_id
        )
        fd = -1
        path = scope_dir / filename
        digest = hashlib.sha256()
        byte_length = 0
        try:
            fd = os.open(
                filename,
                os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
                0o600,
                dir_fd=directory_fd,
            )
            for chunk in chunks:
                if not isinstance(chunk, (bytes, bytearray, memoryview)):
                    raise TypeError("stream chunks must be bytes-like")
                view = memoryview(chunk).cast("B")
                if byte_length + len(view) > max_bytes:
                    raise BlobValidationError("stream exceeds max_bytes")
                digest.update(view)
                self._write_all(fd, view)
                byte_length += len(view)
            os.fsync(fd)
            os.close(fd)
            fd = -1
            os.fsync(directory_fd)
        except BaseException:
            if fd >= 0:
                os.close(fd)
            try:
                os.unlink(filename, dir_fd=directory_fd)
            except FileNotFoundError:
                pass
            raise
        finally:
            os.close(directory_fd)

        return StagedBlob(
            scope_id=scope_id,
            role=role,
            path=path,
            digest="sha256:" + digest.hexdigest(),
            byte_length=byte_length,
            media_type=media_type,
        )

    def validate_staged(
        self,
        blob: StagedBlob,
        *,
        expected_digest: str | None = None,
        expected_size: int | None = None,
    ) -> None:
        """Reopen staged bytes without following links and verify every claim."""
        self._validate_staged_identity(blob)
        if expected_digest is not None:
            self._require_digest(expected_digest)
            if expected_digest != blob.digest:
                raise BlobValidationError("staged digest does not match expected digest")
        if expected_size is not None:
            if isinstance(expected_size, bool) or expected_size < 0:
                raise ValueError("expected_size must be a non-negative integer")
            if expected_size != blob.byte_length:
                raise BlobValidationError("staged size does not match expected size")
        fd = self._open_regular_nofollow(blob.path)
        try:
            actual_digest, actual_size = self._digest_fd(fd)
            if actual_digest != blob.digest:
                raise BlobValidationError("staged bytes do not match staged digest")
            if actual_size != blob.byte_length:
                raise BlobValidationError("staged bytes do not match staged size")
            self._validate_media_signature(fd, blob.media_type, actual_size)
        finally:
            os.close(fd)

    def promote_no_clobber(self, blob: StagedBlob) -> ArtifactRef:
        """Atomically link validated staging into its digest path, never replacing."""
        try:
            self.validate_staged(blob)
        except CustodyError:
            self._quarantine_if_present(blob.path, reason_code="staged-validation-failed")
            raise
        self._require_same_filesystem()
        destination = self.object_path(blob.digest)
        source_fd = self._open_directory(blob.path.parent)
        destination_fd = self._open_or_create_child_directory(
            self.objects_root, destination.parent.name
        )
        installed = False
        try:
            try:
                os.link(
                    blob.path.name,
                    destination.name,
                    src_dir_fd=source_fd,
                    dst_dir_fd=destination_fd,
                    follow_symlinks=False,
                )
                installed = True
            except FileExistsError:
                if not self._path_matches(destination, blob.digest, blob.byte_length):
                    self._quarantine_if_present(
                        blob.path, reason_code="digest-path-collision"
                    )
                    raise BlobCollisionError(
                        "digest destination exists with mismatching bytes"
                    )
            if installed:
                os.chmod(destination.name, 0o444, dir_fd=destination_fd, follow_symlinks=False)
                destination_check = self._open_regular_at(destination_fd, destination.name)
                try:
                    os.fsync(destination_check)
                finally:
                    os.close(destination_check)
                if not self._path_matches(destination, blob.digest, blob.byte_length):
                    raise BlobValidationError("promoted object failed readback validation")
                os.fsync(destination_fd)
            try:
                os.unlink(blob.path.name, dir_fd=source_fd)
                os.fsync(source_fd)
            except FileNotFoundError:
                if not installed:
                    raise CustodyError("staged object disappeared during promotion")
        finally:
            os.close(destination_fd)
            os.close(source_fd)
        return self._artifact_ref(blob)

    def open_verified(
        self, digest: str, *, expected_size: int | None = None
    ) -> BinaryIO:
        """Return one already-verified, no-follow object descriptor at offset zero."""
        path = self.object_path(digest)
        fd = self._open_regular_nofollow(path)
        try:
            actual_digest, actual_size = self._digest_fd(fd)
            if actual_digest != digest:
                raise BlobValidationError("object bytes do not match digest path")
            if expected_size is not None:
                if isinstance(expected_size, bool) or expected_size < 0:
                    raise ValueError("expected_size must be a non-negative integer")
                if actual_size != expected_size:
                    raise BlobValidationError("object size does not match expected size")
            os.lseek(fd, 0, os.SEEK_SET)
            stream = os.fdopen(fd, "rb", closefd=True)
            fd = -1
            return stream
        finally:
            if fd >= 0:
                os.close(fd)

    def exists_verified(self, digest: str) -> bool:
        """Return true only when the digest path exists and verifies exactly."""
        try:
            stream = self.open_verified(digest)
        except (FileNotFoundError, CustodyError, OSError):
            return False
        stream.close()
        return True

    def recover_incomplete_staging(self) -> tuple[Path, ...]:
        """Quarantine crash-left staging scopes before accepting new work.

        Promoted CAS objects are durable independently of SQLite visibility, so
        unreferenced objects are safe to retain. Staging bytes have no durable
        identity claim and must never be resumed implicitly after a restart.
        """
        recovered: list[Path] = []
        for scope in sorted(self.staging_root.iterdir(), key=lambda item: item.name):
            if scope.is_dir() and not scope.is_symlink():
                try:
                    scope.rmdir()
                except OSError:
                    recovered.append(
                        self.quarantine(
                            scope, reason_code="startup-incomplete-publication"
                        )
                    )
                else:
                    self.fsync_parent(scope)
            else:
                recovered.append(
                    self.quarantine(scope, reason_code="startup-incomplete-publication")
                )
        return tuple(recovered)

    def object_path(self, digest: str) -> Path:
        self._require_digest(digest)
        hexadecimal = digest[7:]
        return self.objects_root / hexadecimal[:2] / hexadecimal[2:]

    def quarantine(self, path: Path, *, reason_code: str) -> Path:
        """Move a store-owned path aside under a bounded operator-visible reason."""
        self._require_component("reason_code", reason_code)
        candidate = Path(path)
        try:
            candidate.relative_to(self.control_root)
        except ValueError as error:
            raise CustodyError("only store-owned paths may be quarantined") from error
        destination_dir = self.quarantine_root / reason_code
        destination_dir_fd = self._open_or_create_child_directory(
            self.quarantine_root, reason_code
        )
        os.close(destination_dir_fd)
        destination = destination_dir / f"{uuid.uuid4().hex}-{candidate.name}"
        os.replace(candidate, destination)
        self.fsync_parent(destination)
        self.fsync_parent(candidate)
        return destination

    def fsync_parent(self, path: Path) -> None:
        directory_fd = self._open_directory(Path(path).parent)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)

    def _artifact_ref(self, blob: StagedBlob) -> ArtifactRef:
        path = self.object_path(blob.digest)
        return ArtifactRef(
            digest=blob.digest,
            byte_length=blob.byte_length,
            media_type=blob.media_type,
            storage_relpath=path.relative_to(self.project_root).as_posix(),
        )

    def _validate_staged_identity(self, blob: StagedBlob) -> None:
        if not isinstance(blob, StagedBlob):
            raise TypeError("blob must be a StagedBlob")
        self._require_component("scope_id", blob.scope_id)
        self._require_component("role", blob.role)
        self._require_digest(blob.digest)
        self._require_media_type(blob.media_type)
        if isinstance(blob.byte_length, bool) or blob.byte_length < 0:
            raise ValueError("blob byte_length must be non-negative")
        expected_parent = self.staging_root / blob.scope_id
        if blob.path.parent != expected_parent or blob.path.name in ("", ".", ".."):
            raise CustodyError("staged path is outside its exact custody scope")

    def _path_matches(self, path: Path, digest: str, byte_length: int) -> bool:
        try:
            fd = self._open_regular_nofollow(path)
        except (FileNotFoundError, CustodyError, OSError):
            return False
        try:
            actual_digest, actual_size = self._digest_fd(fd)
            return actual_digest == digest and actual_size == byte_length
        finally:
            os.close(fd)

    def _quarantine_if_present(self, path: Path, *, reason_code: str) -> None:
        try:
            self.quarantine(path, reason_code=reason_code)
        except FileNotFoundError:
            pass

    def _require_same_filesystem(self) -> None:
        metadata = [
            os.stat(path, follow_symlinks=False)
            for path in (self.control_root, self.objects_root, self.staging_root)
        ]
        if not all(stat.S_ISDIR(item.st_mode) for item in metadata):
            raise CustodyError("custody roots must be real directories, not links")
        devices = {item.st_dev for item in metadata}
        if len(devices) != 1:
            raise CustodyError("staging and object directories must share one filesystem")

    @staticmethod
    def _require_component(name: str, value: str) -> None:
        if not isinstance(value, str) or _COMPONENT_PATTERN.fullmatch(value) is None:
            raise ValueError(f"{name} must be one bounded path-safe component")

    @staticmethod
    def _require_digest(digest: str) -> None:
        if not isinstance(digest, str) or _DIGEST_PATTERN.fullmatch(digest) is None:
            raise ValueError("digest must be sha256:<64 lowercase hex>")

    @staticmethod
    def _require_media_type(media_type: str) -> None:
        if not isinstance(media_type, str) or _MEDIA_TYPE_PATTERN.fullmatch(media_type) is None:
            raise ValueError("media_type must be a canonical type/subtype without parameters")

    @staticmethod
    def _write_all(fd: int, view: memoryview) -> None:
        offset = 0
        while offset < len(view):
            written = os.write(fd, view[offset:])
            if written <= 0:
                raise OSError(errno.ENOSPC, "write made no progress")
            offset += written

    @staticmethod
    def _digest_fd(fd: int) -> tuple[str, int]:
        os.lseek(fd, 0, os.SEEK_SET)
        digest = hashlib.sha256()
        byte_length = 0
        while True:
            chunk = os.read(fd, _CHUNK_SIZE)
            if not chunk:
                break
            digest.update(chunk)
            byte_length += len(chunk)
        return "sha256:" + digest.hexdigest(), byte_length

    @staticmethod
    def _validate_media_signature(fd: int, media_type: str, byte_length: int) -> None:
        os.lseek(fd, 0, os.SEEK_SET)
        header = os.read(fd, min(byte_length, 512))
        valid = True
        if media_type == "application/octet-stream":
            return
        if media_type.startswith("text/"):
            os.lseek(fd, 0, os.SEEK_SET)
            try:
                with os.fdopen(os.dup(fd), "rb") as stream:
                    stream.read().decode("utf-8")
            except UnicodeDecodeError:
                valid = False
        elif media_type == "application/json":
            os.lseek(fd, 0, os.SEEK_SET)
            try:
                with os.fdopen(os.dup(fd), "rb") as stream:
                    json.load(stream)
            except (UnicodeDecodeError, json.JSONDecodeError):
                valid = False
        elif media_type in ("model/step", "application/step"):
            valid = header.lstrip().startswith(b"ISO-10303-21;")
        elif media_type in ("model/gltf-binary", "application/gltf-buffer"):
            valid = byte_length >= 12 and header.startswith(b"glTF")
        elif media_type in ("model/3mf", "application/vnd.ms-package.3dmanufacturing-3dmodel+xml"):
            valid = header.startswith(b"PK\x03\x04")
        elif media_type in ("model/stl", "application/sla"):
            if header.lstrip().lower().startswith(b"solid"):
                valid = b"facet" in header.lower() or byte_length == 0
            elif byte_length >= 84:
                triangle_count = struct.unpack("<I", header[80:84])[0]
                valid = byte_length == 84 + triangle_count * 50
            else:
                valid = False
        else:
            raise BlobValidationError(f"unsupported media_type: {media_type}")
        if not valid:
            raise BlobValidationError(f"bytes do not match media_type {media_type}")

    @staticmethod
    def _mkdir_owned(path: Path) -> None:
        path.mkdir(mode=0o700, parents=True, exist_ok=True)
        metadata = os.stat(path, follow_symlinks=False)
        if not stat.S_ISDIR(metadata.st_mode) or path.is_symlink():
            raise CustodyError(f"custody directory is not a real directory: {path}")

    @staticmethod
    def _open_directory(path: Path) -> int:
        try:
            return os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
        except OSError as error:
            raise CustodyError(f"cannot open custody directory without following links: {path}") from error

    @classmethod
    def _open_or_create_child_directory(cls, parent: Path, name: str) -> int:
        cls._require_component("directory name", name)
        parent_fd = cls._open_directory(parent)
        try:
            try:
                os.mkdir(name, mode=0o700, dir_fd=parent_fd)
                os.fsync(parent_fd)
            except FileExistsError:
                pass
            try:
                return os.open(
                    name,
                    os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
                    dir_fd=parent_fd,
                )
            except OSError as error:
                raise CustodyError(
                    "custody child is not a no-follow directory"
                ) from error
        finally:
            os.close(parent_fd)

    @classmethod
    def _open_regular_nofollow(cls, path: Path) -> int:
        directory_fd = cls._open_directory(path.parent)
        try:
            return cls._open_regular_at(directory_fd, path.name)
        finally:
            os.close(directory_fd)

    @staticmethod
    def _open_regular_at(directory_fd: int, name: str) -> int:
        try:
            fd = os.open(
                name,
                os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC,
                dir_fd=directory_fd,
            )
        except OSError as error:
            if error.errno == errno.ENOENT:
                raise FileNotFoundError(name) from error
            raise CustodyError("object is not a no-follow readable file") from error
        metadata = os.fstat(fd)
        if not stat.S_ISREG(metadata.st_mode):
            os.close(fd)
            raise CustodyError("object is not a regular file")
        return fd
