"""Canonical, immutable, fail-closed Piton local project manifests.

``piton.project.json`` and the referenced source-native files are portable
authority. Generated artifacts, viewer state, SQLite pages, and mutable sidecars
are deliberately outside this contract.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from types import MappingProxyType
from typing import Any, Mapping

SCHEMA_ID = "piton.project.v1"
CANONICALIZATION_ID = "piton.canonical-json.v1"
_DIGEST_PATTERN = re.compile(r"^sha256:[0-9a-f]{64}$")
_IDENTIFIER_PATTERN = re.compile(r"^[A-Za-z][A-Za-z0-9_.:-]{0,127}$")
_REQUIRED_ROOT_FIELDS = {
    "schema",
    "canonicalization",
    "project_id",
    "units",
    "authority",
    "source_files",
    "records",
    "safety",
}


class ProjectFormatError(ValueError):
    """A project cannot be admitted as canonical portable authority."""


def _freeze(value: Any) -> Any:
    if isinstance(value, Mapping):
        return MappingProxyType({key: _freeze(item) for key, item in value.items()})
    if isinstance(value, list | tuple):
        return tuple(_freeze(item) for item in value)
    return value


def _thaw(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {key: _thaw(item) for key, item in value.items()}
    if isinstance(value, tuple):
        return [_thaw(item) for item in value]
    return value


def _require_mapping(name: str, value: Any, fields: set[str]) -> Mapping[str, Any]:
    if not isinstance(value, dict):
        raise ProjectFormatError(f"{name} must be a JSON object")
    if set(value) != fields:
        raise ProjectFormatError(f"{name} fields do not match piton.project.v1")
    return value


def _require_identifier(name: str, value: Any) -> str:
    if not isinstance(value, str) or not _IDENTIFIER_PATTERN.fullmatch(value):
        raise ProjectFormatError(f"{name} must be a shaped identifier")
    _require_nfc(name, value)
    return value


def _require_nfc(name: str, value: str) -> None:
    if unicodedata.normalize("NFC", value) != value:
        raise ProjectFormatError(f"{name} must use Unicode NFC normalization")
    if any(ord(character) < 0x20 for character in value):
        raise ProjectFormatError(f"{name} must not contain control characters")


def _validate_json_strings(value: Any, location: str = "project") -> None:
    if isinstance(value, str):
        _require_nfc(location, value)
    elif isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str):
                raise ProjectFormatError(f"{location} contains a non-string object key")
            _require_nfc(f"{location} key", key)
            _validate_json_strings(item, f"{location}.{key}")
    elif isinstance(value, list):
        for index, item in enumerate(value):
            _validate_json_strings(item, f"{location}[{index}]")
    elif isinstance(value, float) and not math.isfinite(value):
        raise ProjectFormatError(f"{location} contains a non-finite number")
    elif value is not None and not isinstance(value, bool | int | float):
        raise ProjectFormatError(f"{location} contains an unsupported JSON value")


def _portable_path(name: str, value: Any) -> str:
    if not isinstance(value, str):
        raise ProjectFormatError(f"{name} must be a portable relative POSIX path")
    _require_nfc(name, value)
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
        raise ProjectFormatError(f"{name} must be a portable relative POSIX path")
    return value


def _digest(name: str, value: Any) -> str:
    if not isinstance(value, str) or not _DIGEST_PATTERN.fullmatch(value):
        raise ProjectFormatError(f"{name} must be a sha256:<64 lowercase hex> digest")
    return value


@dataclass(frozen=True)
class ProjectAuthority:
    writable: str
    entrypoint: str
    dependency_lock: str
    toolchain_lock: str


@dataclass(frozen=True)
class ProjectSafety:
    review_state: str
    fabrication_release: bool
    machine_actuation: bool


@dataclass(frozen=True)
class SourceFile:
    path: str
    digest: str
    media_type: str
    line_endings: str


@dataclass(frozen=True)
class ProjectRecord:
    record_id: str
    kind: str
    payload: Mapping[str, Any]


@dataclass(frozen=True)
class PitonProject:
    project_id: str
    units: str
    authority: ProjectAuthority
    source_files: tuple[SourceFile, ...]
    records: tuple[ProjectRecord, ...]
    safety: ProjectSafety
    schema: str = SCHEMA_ID
    canonicalization: str = CANONICALIZATION_ID

    def to_primitive(self) -> dict[str, Any]:
        """Return a detached primitive map in canonical record order."""
        return {
            "schema": self.schema,
            "canonicalization": self.canonicalization,
            "project_id": self.project_id,
            "units": self.units,
            "authority": {
                "writable": self.authority.writable,
                "entrypoint": self.authority.entrypoint,
                "dependency_lock": self.authority.dependency_lock,
                "toolchain_lock": self.authority.toolchain_lock,
            },
            "source_files": [
                {
                    "path": source.path,
                    "digest": source.digest,
                    "media_type": source.media_type,
                    "line_endings": source.line_endings,
                }
                for source in sorted(self.source_files, key=lambda item: item.path)
            ],
            "records": [
                {
                    "record_id": record.record_id,
                    "kind": record.kind,
                    "payload": _thaw(record.payload),
                }
                for record in sorted(self.records, key=lambda item: item.record_id)
            ],
            "safety": {
                "review_state": self.safety.review_state,
                "fabrication_release": self.safety.fabrication_release,
                "machine_actuation": self.safety.machine_actuation,
            },
        }


def _reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ProjectFormatError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def _reject_constant(value: str) -> None:
    raise ProjectFormatError(f"non-finite number is forbidden: {value}")


def load_project_bytes(raw: bytes) -> PitonProject:
    """Strictly decode, parse, validate, and freeze a project manifest."""
    if raw.startswith(b"\xef\xbb\xbf"):
        raise ProjectFormatError("UTF-8 BOM is forbidden")
    try:
        text = raw.decode("utf-8", errors="strict")
    except UnicodeDecodeError as exc:
        raise ProjectFormatError("invalid UTF-8 in piton.project.json") from exc
    try:
        primitive = json.loads(
            text,
            object_pairs_hook=_reject_duplicate_keys,
            parse_constant=_reject_constant,
        )
    except ProjectFormatError:
        raise
    except json.JSONDecodeError as exc:
        raise ProjectFormatError(f"invalid JSON: {exc.msg}") from exc
    return project_from_primitive(primitive)


def project_from_primitive(primitive: Any) -> PitonProject:
    """Validate a decoded manifest before constructing immutable domain state."""
    root = _require_mapping("project", primitive, _REQUIRED_ROOT_FIELDS)
    _validate_json_strings(root)
    if root["schema"] != SCHEMA_ID:
        raise ProjectFormatError("schema must be piton.project.v1")
    if root["canonicalization"] != CANONICALIZATION_ID:
        raise ProjectFormatError("canonicalization must be piton.canonical-json.v1")
    project_id = _require_identifier("project_id", root["project_id"])
    if root["units"] not in ("mm", "inch"):
        raise ProjectFormatError("units must be mm or inch")

    authority_map = _require_mapping(
        "authority",
        root["authority"],
        {"writable", "entrypoint", "dependency_lock", "toolchain_lock"},
    )
    if authority_map["writable"] != "source-native-python":
        raise ProjectFormatError("authority.writable must remain source-native-python")
    authority = ProjectAuthority(
        writable="source-native-python",
        entrypoint=_portable_path("authority.entrypoint", authority_map["entrypoint"]),
        dependency_lock=_portable_path("authority.dependency_lock", authority_map["dependency_lock"]),
        toolchain_lock=_portable_path("authority.toolchain_lock", authority_map["toolchain_lock"]),
    )

    if not isinstance(root["source_files"], list) or not root["source_files"]:
        raise ProjectFormatError("source_files must be a non-empty array")
    sources: list[SourceFile] = []
    seen_paths: set[str] = set()
    allowed_media = {"text/x-python", "text/plain", "application/toml", "application/json"}
    for index, item in enumerate(root["source_files"]):
        source = _require_mapping(
            f"source_files[{index}]", item, {"path", "digest", "media_type", "line_endings"}
        )
        path = _portable_path(f"source_files[{index}].path", source["path"])
        if path in seen_paths:
            raise ProjectFormatError(f"duplicate source path: {path}")
        seen_paths.add(path)
        if source["media_type"] not in allowed_media:
            raise ProjectFormatError("source file media_type is unsupported")
        if source["line_endings"] != "lf":
            raise ProjectFormatError("source file line_endings must be lf")
        sources.append(SourceFile(path, _digest("source digest", source["digest"]), source["media_type"], "lf"))
    for name, path in (
        ("authority.entrypoint", authority.entrypoint),
        ("authority.dependency_lock", authority.dependency_lock),
        ("authority.toolchain_lock", authority.toolchain_lock),
    ):
        if path not in seen_paths:
            raise ProjectFormatError(f"{name} must name a declared source file")

    if not isinstance(root["records"], list):
        raise ProjectFormatError("records must be an array")
    records: list[ProjectRecord] = []
    seen_records: set[str] = set()
    for index, item in enumerate(root["records"]):
        record = _require_mapping(f"records[{index}]", item, {"record_id", "kind", "payload"})
        record_id = _require_identifier(f"records[{index}].record_id", record["record_id"])
        if record_id in seen_records:
            raise ProjectFormatError(f"duplicate record_id: {record_id}")
        seen_records.add(record_id)
        kind = record["kind"]
        if not isinstance(kind, str) or not kind or len(kind) > 128:
            raise ProjectFormatError("record kind must be a non-empty string of at most 128 characters")
        if not isinstance(record["payload"], dict):
            raise ProjectFormatError("record payload must be a JSON object")
        records.append(ProjectRecord(record_id, kind, _freeze(record["payload"])))

    safety_map = _require_mapping(
        "safety", root["safety"], {"review_state", "fabrication_release", "machine_actuation"}
    )
    if safety_map["review_state"] != "needs_human_review":
        raise ProjectFormatError("review_state must remain needs_human_review")
    if safety_map["fabrication_release"] is not False:
        raise ProjectFormatError("fabrication_release must remain false")
    if safety_map["machine_actuation"] is not False:
        raise ProjectFormatError("machine_actuation must remain false")

    return PitonProject(
        project_id=project_id,
        units=root["units"],
        authority=authority,
        source_files=tuple(sources),
        records=tuple(records),
        safety=ProjectSafety("needs_human_review", False, False),
    )


def canonical_project_bytes(project: PitonProject) -> bytes:
    """Serialize a validated project to canonical UTF-8 JSON with one LF."""
    return (
        json.dumps(
            project.to_primitive(),
            ensure_ascii=False,
            allow_nan=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        + "\n"
    ).encode("utf-8")


def project_digest(project: PitonProject) -> str:
    """Return the domain-separated digest of canonical project bytes."""
    payload = b"piton.project.v1\0" + canonical_project_bytes(project)
    return "sha256:" + hashlib.sha256(payload).hexdigest()


def _regular_file_without_symlinks(root: Path, relative: str) -> Path:
    current = root
    for part in PurePosixPath(relative).parts:
        current = current / part
        if current.is_symlink():
            raise ProjectFormatError(f"symlink is forbidden in authoritative path: {relative}")
    if not current.is_file():
        raise ProjectFormatError(f"authoritative path is not a regular file: {relative}")
    return current


def load_project_directory(root: str | Path) -> PitonProject:
    """Load a local project and verify source custody against declared digests."""
    directory = Path(root)
    if directory.is_symlink() or not directory.is_dir():
        raise ProjectFormatError("project root must be a regular directory, not a symlink")
    manifest_path = _regular_file_without_symlinks(directory, "piton.project.json")
    project = load_project_bytes(manifest_path.read_bytes())

    referenced = (
        project.authority.entrypoint,
        project.authority.dependency_lock,
        project.authority.toolchain_lock,
    )
    for relative in referenced:
        _regular_file_without_symlinks(directory, relative)

    for source in project.source_files:
        path = _regular_file_without_symlinks(directory, source.path)
        raw = path.read_bytes()
        if raw.startswith(b"\xef\xbb\xbf"):
            raise ProjectFormatError(f"UTF-8 BOM is forbidden in source file: {source.path}")
        try:
            raw.decode("utf-8", errors="strict")
        except UnicodeDecodeError as exc:
            raise ProjectFormatError(f"invalid UTF-8 in source file: {source.path}") from exc
        if b"\r" in raw:
            raise ProjectFormatError(f"source file does not use LF line endings: {source.path}")
        actual = "sha256:" + hashlib.sha256(raw).hexdigest()
        if actual != source.digest:
            raise ProjectFormatError(f"source digest mismatch: {source.path}")
    return project
