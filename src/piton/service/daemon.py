"""Local-daemon transport admission for typed custody commands.

The transport derives the caller from kernel-owned Unix peer credentials and a
composition-root-owned UID mapping. Untrusted command content is data only: it
has a closed schema and cannot carry identity, credentials, grants, policy,
approval, release, or machine-actuation claims.
"""

from __future__ import annotations

import socket
import struct
from pathlib import Path
from types import MappingProxyType
from typing import Any, Mapping

from ..health import HealthDetail, LocalHealthService
from ..source_tree import SourceTree, SourceTreeFile
from ..storage.blobs import BlobStore
from ..storage.db import Database
from .application import (
    CommandReceipt,
    DraftReceipt,
    PitonApplicationService,
    _issue_principal_context,
)
from .commands import (
    BeginDraft,
    CommitDraft,
    CreateProject,
    DiscardDraft,
    ImportSourceBase,
    RestoreForward,
    UpdateDraft,
)


class CommandAdmissionError(ValueError):
    """Untrusted command content does not match the closed transport schema."""


def _peer_uid(connection: socket.socket) -> int:
    """Read identity from kernel-owned credentials on a connected local socket."""
    if type(connection) is not socket.socket or connection.family != socket.AF_UNIX:
        raise TypeError("trusted connected AF_UNIX socket is required")
    try:
        credentials = connection.getsockopt(
            socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize("3i")
        )
        _pid, uid, _gid = struct.unpack("3i", credentials)
    except (AttributeError, OSError, struct.error) as error:
        raise PermissionError("kernel peer credentials are unavailable") from error
    return uid


class LocalDaemonHealthAdapter:
    """Closed local routing for liveness, readiness, and authorized detail."""

    __slots__ = ("__health", "__detail_principal_ids_by_uid")

    def __init__(
        self,
        health: LocalHealthService,
        *,
        detail_principal_ids_by_uid: Mapping[int, str],
    ) -> None:
        if not isinstance(health, LocalHealthService):
            raise TypeError("trusted LocalHealthService is required")
        if not isinstance(detail_principal_ids_by_uid, Mapping):
            raise TypeError(
                "detail_principal_ids_by_uid must be a server-owned mapping"
            )
        copied = dict(detail_principal_ids_by_uid)
        if not all(
            isinstance(uid, int) and not isinstance(uid, bool) and uid >= 0
            for uid in copied
        ):
            raise ValueError("mapped peer UIDs must be non-negative integers")
        if not all(
            isinstance(principal_id, str) and principal_id
            for principal_id in copied.values()
        ):
            raise ValueError("mapped principal IDs must be non-empty strings")
        self.__health = health
        self.__detail_principal_ids_by_uid = MappingProxyType(copied)

    @classmethod
    def open(
        cls,
        project_root: str | Path,
        *,
        detail_principal_ids_by_uid: Mapping[int, str],
    ) -> "LocalDaemonHealthAdapter":
        root = Path(project_root)
        database = Database(root / ".piton" / "piton.sqlite3")
        return cls(
            LocalHealthService(database, BlobStore(root)),
            detail_principal_ids_by_uid=detail_principal_ids_by_uid,
        )

    def handle(
        self, connection: socket.socket, path: str
    ) -> Mapping[str, str] | HealthDetail:
        uid = _peer_uid(connection)
        if path == "/health/live":
            return self.__health.live()
        if path == "/health/ready":
            return self.__health.ready()
        if path == "/health/detail":
            if uid not in self.__detail_principal_ids_by_uid:
                raise PermissionError(
                    "kernel peer UID is not authorized for health detail"
                )
            return self.__health._evaluate()
        raise CommandAdmissionError("unsupported local health path")


_COMMAND_FIELDS = MappingProxyType(
    {
        "create_project": frozenset(("command_id", "project_id", "display_name")),
        "import_source_base": frozenset(
            ("command_id", "project_id", "source_tree", "parameter_values")
        ),
        "begin_draft": frozenset(
            ("command_id", "project_id", "base_revision_id", "expected_generation")
        ),
        "update_draft": frozenset(
            ("command_id", "project_id", "draft_id", "source_tree")
        ),
        "commit_draft": frozenset(
            (
                "command_id",
                "project_id",
                "draft_id",
                "expected_revision_id",
                "expected_generation",
                "parameter_values",
            )
        ),
        "discard_draft": frozenset(("command_id", "project_id", "draft_id")),
        "restore_forward": frozenset(
            (
                "command_id",
                "project_id",
                "target_revision_id",
                "expected_revision_id",
                "expected_generation",
            )
        ),
    }
)
_SOURCE_TREE_FIELDS = frozenset(
    ("files", "entrypoint", "dependency_lock", "toolchain_lock")
)
_SOURCE_FILE_FIELDS = frozenset(("path", "content", "media_type"))
_ENVELOPE_FIELDS = frozenset(("command_type", "payload"))


def _closed_mapping(
    value: object, expected: frozenset[str], name: str
) -> Mapping[str, Any]:
    if not isinstance(value, Mapping) or set(value) != expected:
        raise CommandAdmissionError(f"{name} does not match the closed schema")
    return value


def _parameter_values(value: object) -> Mapping[str, str]:
    if not isinstance(value, Mapping):
        raise CommandAdmissionError("parameter_values does not match the closed schema")
    copied = dict(value)
    if not all(isinstance(key, str) and key for key in copied):
        raise CommandAdmissionError("parameter_values does not match the closed schema")
    if not all(isinstance(item, str) for item in copied.values()):
        raise CommandAdmissionError("parameter_values does not match the closed schema")
    return copied


def _source_tree(value: object) -> SourceTree:
    content = _closed_mapping(value, _SOURCE_TREE_FIELDS, "source_tree")
    files = content["files"]
    if not isinstance(files, list) or not files:
        raise CommandAdmissionError("source_tree files do not match the closed schema")
    admitted: list[SourceTreeFile] = []
    for candidate in files:
        item = _closed_mapping(candidate, _SOURCE_FILE_FIELDS, "source_tree file")
        text = item["content"]
        if not isinstance(text, str):
            raise CommandAdmissionError("source_tree file content must be UTF-8 text")
        try:
            admitted.append(
                SourceTreeFile(
                    path=item["path"],
                    content=text.encode("utf-8", errors="strict"),
                    media_type=item["media_type"],
                )
            )
        except (TypeError, ValueError) as error:
            raise CommandAdmissionError("source_tree file is invalid") from error
    try:
        return SourceTree(
            files=tuple(admitted),
            entrypoint=content["entrypoint"],
            dependency_lock=content["dependency_lock"],
            toolchain_lock=content["toolchain_lock"],
        )
    except (TypeError, ValueError) as error:
        raise CommandAdmissionError("source_tree is invalid") from error


def _parse_command(content: object) -> object:
    envelope = _closed_mapping(content, _ENVELOPE_FIELDS, "command envelope")
    command_type = envelope["command_type"]
    if not isinstance(command_type, str) or command_type not in _COMMAND_FIELDS:
        raise CommandAdmissionError("unsupported command type")
    payload = _closed_mapping(
        envelope["payload"], _COMMAND_FIELDS[command_type], f"{command_type} payload"
    )

    try:
        if command_type == "create_project":
            return CreateProject(**payload)
        if command_type == "import_source_base":
            return ImportSourceBase(
                command_id=payload["command_id"],
                project_id=payload["project_id"],
                source_tree=_source_tree(payload["source_tree"]),
                parameter_values=_parameter_values(payload["parameter_values"]),
            )
        if command_type == "begin_draft":
            return BeginDraft(**payload)
        if command_type == "update_draft":
            return UpdateDraft(
                command_id=payload["command_id"],
                project_id=payload["project_id"],
                draft_id=payload["draft_id"],
                source_tree=_source_tree(payload["source_tree"]),
            )
        if command_type == "commit_draft":
            return CommitDraft(
                command_id=payload["command_id"],
                project_id=payload["project_id"],
                draft_id=payload["draft_id"],
                expected_revision_id=payload["expected_revision_id"],
                expected_generation=payload["expected_generation"],
                parameter_values=_parameter_values(payload["parameter_values"]),
            )
        if command_type == "discard_draft":
            return DiscardDraft(**payload)
        return RestoreForward(**payload)
    except CommandAdmissionError:
        raise
    except (TypeError, ValueError) as error:
        raise CommandAdmissionError(f"{command_type} payload is invalid") from error


class LocalDaemonCommandAdapter:
    """Secretless AF_UNIX admission into the sole typed application service."""

    __slots__ = ("__service", "__principal_ids_by_uid")

    def __init__(
        self,
        service: PitonApplicationService,
        *,
        principal_ids_by_uid: Mapping[int, str],
    ) -> None:
        if not isinstance(service, PitonApplicationService):
            raise TypeError("trusted PitonApplicationService is required")
        if not isinstance(principal_ids_by_uid, Mapping):
            raise TypeError("principal_ids_by_uid must be a server-owned mapping")
        copied = dict(principal_ids_by_uid)
        if not all(
            isinstance(uid, int) and not isinstance(uid, bool) and uid >= 0
            for uid in copied
        ):
            raise ValueError("mapped peer UIDs must be non-negative integers")
        if not all(
            isinstance(principal_id, str) and principal_id
            for principal_id in copied.values()
        ):
            raise ValueError("mapped principal IDs must be non-empty strings")
        self.__service = service
        self.__principal_ids_by_uid = MappingProxyType(copied)

    @classmethod
    def open(
        cls,
        project_root: str | Path,
        *,
        principal_ids_by_uid: Mapping[int, str],
    ) -> "LocalDaemonCommandAdapter":
        return cls(
            PitonApplicationService.open(project_root),
            principal_ids_by_uid=principal_ids_by_uid,
        )

    @staticmethod
    def _peer_uid(connection: socket.socket) -> int:
        return _peer_uid(connection)

    def execute(
        self, connection: socket.socket, content: Mapping[str, Any]
    ) -> CommandReceipt | DraftReceipt:
        """Derive identity, parse closed content, and invoke one custody boundary."""
        uid = self._peer_uid(connection)
        principal_id = self.__principal_ids_by_uid.get(uid)
        if principal_id is None:
            raise PermissionError("kernel peer UID is not mapped to a principal")
        command = _parse_command(content)
        context = _issue_principal_context(principal_id)
        return self.__service.execute(command, context)
