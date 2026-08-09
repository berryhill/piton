"""Canonical immutable source-native tree manifests."""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from pathlib import PurePosixPath

SCHEMA_ID = "piton.source-tree.v1"
CANONICALIZATION_ID = "piton.canonical-json.v1"
_DIGEST_PATTERN = re.compile(r"^sha256:[0-9a-f]{64}$")
_MEDIA_TYPE_PATTERN = re.compile(
    r"^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$"
)


def _portable_path(value: str) -> str:
    if not isinstance(value, str):
        raise ValueError("source path must be a portable relative POSIX path")
    path = PurePosixPath(value)
    if (
        not value
        or "\\" in value
        or value.startswith("/")
        or "//" in value
        or value.endswith("/")
        or path.as_posix() != value
        or path.parts[0].endswith(":")
        or any(part in ("", ".", "..") for part in path.parts)
    ):
        raise ValueError("source path must be a portable relative POSIX path")
    return value


def _canonical_bytes(value: dict[str, object]) -> bytes:
    return (
        json.dumps(
            value,
            ensure_ascii=False,
            allow_nan=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        + "\n"
    ).encode("utf-8")


@dataclass(frozen=True, slots=True)
class SourceTreeFile:
    """One admitted authoritative UTF-8/LF source file."""

    path: str
    content: bytes = field(repr=False)
    media_type: str
    digest: str = field(init=False)
    byte_length: int = field(init=False)

    def __post_init__(self) -> None:
        _portable_path(self.path)
        if not isinstance(self.content, bytes):
            raise TypeError("source content must be bytes")
        if self.content.startswith(b"\xef\xbb\xbf"):
            raise ValueError("source content must not contain a UTF-8 BOM")
        try:
            self.content.decode("utf-8", errors="strict")
        except UnicodeDecodeError as error:
            raise ValueError("source content must be UTF-8") from error
        if b"\r" in self.content:
            raise ValueError("source content must use LF line endings")
        if not isinstance(self.media_type, str) or _MEDIA_TYPE_PATTERN.fullmatch(self.media_type) is None:
            raise ValueError("source media_type must be canonical type/subtype")
        object.__setattr__(self, "digest", "sha256:" + hashlib.sha256(self.content).hexdigest())
        object.__setattr__(self, "byte_length", len(self.content))


@dataclass(frozen=True, slots=True)
class SourceTree:
    """Canonical identity over every source byte and bound authority path."""

    files: tuple[SourceTreeFile, ...]
    entrypoint: str
    dependency_lock: str
    toolchain_lock: str
    canonical_bytes: bytes = field(init=False, repr=False)
    digest: str = field(init=False)

    def __post_init__(self) -> None:
        if not isinstance(self.files, tuple) or not self.files:
            raise ValueError("source tree files must be a non-empty tuple")
        if not all(isinstance(item, SourceTreeFile) for item in self.files):
            raise TypeError("source tree files must contain SourceTreeFile values")
        paths = [item.path for item in self.files]
        if len(paths) != len(set(paths)):
            raise ValueError("source tree paths must be unique")
        entrypoint_path, separator, callable_name = self.entrypoint.partition(":")
        _portable_path(entrypoint_path)
        if separator != ":" or not callable_name or ":" in callable_name:
            raise ValueError("entrypoint must be portable/path.py:callable")
        for lock in (self.dependency_lock, self.toolchain_lock):
            _portable_path(lock)
        admitted = set(paths)
        for bound in (entrypoint_path, self.dependency_lock, self.toolchain_lock):
            if bound not in admitted:
                raise ValueError("entrypoint and locks must name admitted source files")
        primitive: dict[str, object] = {
            "schema": SCHEMA_ID,
            "canonicalization": CANONICALIZATION_ID,
            "entrypoint": self.entrypoint,
            "dependency_lock": self.dependency_lock,
            "toolchain_lock": self.toolchain_lock,
            "files": [
                {
                    "path": item.path,
                    "digest": item.digest,
                    "byte_length": item.byte_length,
                    "media_type": item.media_type,
                }
                for item in sorted(self.files, key=lambda candidate: candidate.path)
            ],
        }
        canonical = _canonical_bytes(primitive)
        object.__setattr__(self, "canonical_bytes", canonical)
        object.__setattr__(self, "digest", "sha256:" + hashlib.sha256(canonical).hexdigest())

    def file(self, path: str) -> SourceTreeFile:
        """Return an exact admitted path, never a nearest match."""
        for item in self.files:
            if item.path == path:
                return item
        raise KeyError(path)
