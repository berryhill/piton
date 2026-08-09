"""Confined, transient source-tree drafts.

Draft scopes are deliberately outside immutable object custody. A restart does
not recover authored state from these bytes; it removes the residue.
"""

from __future__ import annotations

import json
import os
import re
import stat
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path, PurePosixPath
from typing import Any

from ..source_tree import SourceTree, SourceTreeFile

_DRAFT_ID = re.compile(r"^[0-9a-f]{32}$")
_REVISION_ID = re.compile(r"^rev_[0-9a-f]{64}$")
_METADATA = "draft.json"
_MAX_DRAFT_BYTES = 16 * 1024 * 1024


class DraftError(RuntimeError):
    """A transient draft failed closed."""


class DraftNotFoundError(DraftError):
    """No live in-process draft owns the supplied identity."""


class DraftExpiredError(DraftError):
    """The draft expired and its confined bytes were removed."""


class DraftConfinementError(DraftError):
    """Draft storage is not an exact no-follow confined scope."""


@dataclass(frozen=True, slots=True)
class DraftRecord:
    draft_id: str
    project_id: str
    base_revision_id: str
    base_generation: int
    content_digest: str
    expires_at: str
    scope: Path
    persisted_revision_id: None = None
    fabrication_release: bool = False
    machine_actuation: bool = False
    review_state: str = "needs_human_review"


class DraftStore:
    """Own ephemeral draft directories beneath one project-local staging root."""

    def __init__(
        self,
        project_root: str | Path,
        *,
        default_ttl_seconds: int = 3600,
        max_draft_bytes: int = _MAX_DRAFT_BYTES,
    ) -> None:
        if isinstance(default_ttl_seconds, bool) or not isinstance(default_ttl_seconds, int):
            raise ValueError("default_ttl_seconds must be an integer")
        if not 1 <= default_ttl_seconds <= 86400:
            raise ValueError("default_ttl_seconds must be between 1 and 86400")
        if isinstance(max_draft_bytes, bool) or not isinstance(max_draft_bytes, int) or max_draft_bytes < 1:
            raise ValueError("max_draft_bytes must be a positive integer")
        root = Path(project_root)
        root.mkdir(parents=True, exist_ok=True)
        if root.is_symlink():
            raise DraftConfinementError("project root must not be a symbolic link")
        self.project_root = root.resolve(strict=True)
        self.staging_root = self.project_root / ".piton" / "staging"
        self.staging_root.mkdir(mode=0o700, parents=True, exist_ok=True)
        self._require_real_directory(self.staging_root)
        self.default_ttl_seconds = default_ttl_seconds
        self.max_draft_bytes = max_draft_bytes
        self._live: dict[str, DraftRecord] = {}

    def begin(
        self,
        project_id: str,
        base_revision_id: str,
        base_generation: int,
        tree: SourceTree,
        *,
        expires_at: datetime | None = None,
    ) -> DraftRecord:
        self._validate_binding(project_id, base_revision_id, base_generation, tree)
        draft_id = uuid.uuid4().hex
        scope = self._scope(draft_id)
        deadline = expires_at or datetime.now(UTC) + timedelta(seconds=self.default_ttl_seconds)
        if deadline.tzinfo is None:
            raise ValueError("expires_at must be timezone-aware")
        expires = deadline.astimezone(UTC).isoformat(timespec="microseconds").replace("+00:00", "Z")
        scope.mkdir(mode=0o700)
        try:
            self._write_tree(scope, project_id, base_revision_id, base_generation, tree, expires)
        except BaseException:
            self._remove_scope(scope)
            raise
        record = DraftRecord(
            draft_id, project_id, base_revision_id, base_generation, tree.digest, expires, scope
        )
        self._live[draft_id] = record
        return record

    def load(self, draft_id: str, *, now: datetime | None = None) -> DraftRecord:
        self._require_draft_id(draft_id)
        record = self._live.get(draft_id)
        if record is None:
            raise DraftNotFoundError("draft is not live in this daemon process")
        current = (now or datetime.now(UTC)).astimezone(UTC)
        deadline = datetime.fromisoformat(record.expires_at.replace("Z", "+00:00"))
        if current >= deadline:
            self._remove_scope(record.scope)
            self._live.pop(draft_id, None)
            raise DraftExpiredError("draft expired")
        self._require_scope(record.scope, draft_id)
        return record

    def load_tree(self, draft_id: str) -> SourceTree:
        record = self.load(draft_id)
        self._require_regular_scope_entries(record.scope)
        metadata = self._read_json_no_follow(record.scope / _METADATA)
        files: list[SourceTreeFile] = []
        total = 0
        for claim in metadata["files"]:
            relative = self._portable_path(claim["path"])
            content = self._read_bytes_no_follow(record.scope / "files" / relative)
            total += len(content)
            if total > self.max_draft_bytes:
                raise DraftConfinementError("draft exceeds configured byte bound")
            item = SourceTreeFile(relative.as_posix(), content, claim["media_type"])
            if item.digest != claim["digest"] or item.byte_length != claim["byte_length"]:
                raise DraftConfinementError("draft file claims do not match bytes")
            files.append(item)
        tree = SourceTree(
            files=tuple(files),
            entrypoint=metadata["entrypoint"],
            dependency_lock=metadata["dependency_lock"],
            toolchain_lock=metadata["toolchain_lock"],
        )
        if tree.digest != record.content_digest or tree.digest != metadata["content_digest"]:
            raise DraftConfinementError("draft source tree identity changed")
        return tree

    def update(self, draft_id: str, tree: SourceTree) -> DraftRecord:
        record = self.load(draft_id)
        if not isinstance(tree, SourceTree):
            raise TypeError("tree must be a SourceTree")
        if sum(item.byte_length for item in tree.files) > self.max_draft_bytes:
            raise DraftConfinementError("draft exceeds configured byte bound")
        self._remove_scope(record.scope)
        record.scope.mkdir(mode=0o700)
        try:
            self._write_tree(
                record.scope,
                record.project_id,
                record.base_revision_id,
                record.base_generation,
                tree,
                record.expires_at,
            )
        except BaseException:
            if record.scope.exists() and not record.scope.is_symlink():
                self._remove_scope(record.scope)
            self._live.pop(draft_id, None)
            raise
        updated = DraftRecord(
            record.draft_id,
            record.project_id,
            record.base_revision_id,
            record.base_generation,
            tree.digest,
            record.expires_at,
            record.scope,
        )
        self._live[draft_id] = updated
        return updated

    def discard(self, draft_id: str) -> DraftRecord:
        record = self.load(draft_id)
        self._remove_scope(record.scope)
        self._live.pop(draft_id, None)
        return record

    def recover_after_crash(self) -> tuple[str, ...]:
        """Remove draft residue; never infer committed work from staging bytes."""
        removed: list[str] = []
        self._require_real_directory(self.staging_root)
        for candidate in sorted(self.staging_root.iterdir(), key=lambda path: path.name):
            if candidate.name.startswith("draft_"):
                draft_id = candidate.name[6:]
                self._require_draft_id(draft_id)
                self._remove_scope(candidate)
                self._live.pop(draft_id, None)
                removed.append(draft_id)
        return tuple(removed)

    def _write_tree(
        self,
        scope: Path,
        project_id: str,
        base_revision_id: str,
        base_generation: int,
        tree: SourceTree,
        expires_at: str,
    ) -> None:
        total = sum(item.byte_length for item in tree.files)
        if total > self.max_draft_bytes:
            raise DraftConfinementError("draft exceeds configured byte bound")
        files_root = scope / "files"
        files_root.mkdir(mode=0o700)
        for item in tree.files:
            path = files_root / self._portable_path(item.path)
            path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            self._exclusive_write(path, item.content)
        metadata = {
            "schema": "piton.transient-draft.v1",
            "project_id": project_id,
            "base_revision_id": base_revision_id,
            "base_generation": base_generation,
            "content_digest": tree.digest,
            "expires_at": expires_at,
            "entrypoint": tree.entrypoint,
            "dependency_lock": tree.dependency_lock,
            "toolchain_lock": tree.toolchain_lock,
            "files": [
                {
                    "path": item.path,
                    "digest": item.digest,
                    "byte_length": item.byte_length,
                    "media_type": item.media_type,
                }
                for item in sorted(tree.files, key=lambda value: value.path)
            ],
            "persisted_revision_id": None,
            "fabrication_release": False,
            "machine_actuation": False,
            "review_state": "needs_human_review",
        }
        encoded = (json.dumps(metadata, sort_keys=True, separators=(",", ":")) + "\n").encode()
        self._exclusive_write(scope / _METADATA, encoded)

    @staticmethod
    def _exclusive_write(path: Path, content: bytes) -> None:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        try:
            view = memoryview(content)
            while view:
                written = os.write(fd, view)
                if written <= 0:
                    raise OSError("draft write made no progress")
                view = view[written:]
            os.fsync(fd)
        finally:
            os.close(fd)

    def _remove_scope(self, scope: Path) -> None:
        self._require_scope(scope, scope.name[6:])
        entries = self._require_regular_scope_entries(scope)
        for path in sorted(entries, key=lambda value: len(value.parts), reverse=True):
            path.rmdir() if path.is_dir() else path.unlink()
        scope.rmdir()

    @staticmethod
    def _require_regular_scope_entries(scope: Path) -> list[Path]:
        entries = list(scope.rglob("*"))
        for path in entries:
            metadata = os.lstat(path)
            if stat.S_ISLNK(metadata.st_mode):
                raise DraftConfinementError("symbolic link in draft scope")
            if not (stat.S_ISREG(metadata.st_mode) or stat.S_ISDIR(metadata.st_mode)):
                raise DraftConfinementError("unsupported object in draft scope")
        return entries

    def _require_scope(self, scope: Path, draft_id: str) -> None:
        self._require_draft_id(draft_id)
        if scope != self._scope(draft_id):
            raise DraftConfinementError("draft scope is outside exact staging confinement")
        self._require_real_directory(scope)

    def _scope(self, draft_id: str) -> Path:
        self._require_draft_id(draft_id)
        return self.staging_root / ("draft_" + draft_id)

    @staticmethod
    def _require_draft_id(draft_id: str) -> None:
        if not isinstance(draft_id, str) or _DRAFT_ID.fullmatch(draft_id) is None:
            raise ValueError("draft_id must be a server-derived lowercase hex identity")

    @staticmethod
    def _validate_binding(
        project_id: str, base_revision_id: str, base_generation: int, tree: SourceTree
    ) -> None:
        if not isinstance(project_id, str) or not project_id:
            raise ValueError("project_id must not be empty")
        if not isinstance(base_revision_id, str) or _REVISION_ID.fullmatch(base_revision_id) is None:
            raise ValueError("base_revision_id must be an exact derived revision identity")
        if isinstance(base_generation, bool) or not isinstance(base_generation, int) or base_generation < 0:
            raise ValueError("base_generation must be a non-negative integer")
        if not isinstance(tree, SourceTree):
            raise TypeError("tree must be a SourceTree")

    @staticmethod
    def _portable_path(value: str) -> PurePosixPath:
        path = PurePosixPath(value)
        if (
            not isinstance(value, str)
            or not value
            or value.startswith("/")
            or "\\" in value
            or path.as_posix() != value
            or any(part in ("", ".", "..") for part in path.parts)
        ):
            raise DraftConfinementError("draft source path is not portable and confined")
        return path

    @staticmethod
    def _require_real_directory(path: Path) -> None:
        metadata = os.lstat(path)
        if not stat.S_ISDIR(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode):
            raise DraftConfinementError("draft scope must be a real directory, not a symbolic link")

    @staticmethod
    def _read_bytes_no_follow(path: Path) -> bytes:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        try:
            metadata = os.fstat(fd)
            if not stat.S_ISREG(metadata.st_mode):
                raise DraftConfinementError("draft content is not a regular file")
            chunks: list[bytes] = []
            while True:
                chunk = os.read(fd, 1024 * 1024)
                if not chunk:
                    return b"".join(chunks)
                chunks.append(chunk)
        finally:
            os.close(fd)

    @classmethod
    def _read_json_no_follow(cls, path: Path) -> dict[str, Any]:
        try:
            decoded = cls._read_bytes_no_follow(path).decode("utf-8", errors="strict")
            value = json.loads(decoded)
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise DraftConfinementError("draft metadata is not canonical JSON") from error
        if not isinstance(value, dict):
            raise DraftConfinementError("draft metadata must be an object")
        return value
