"""Sole adapter-facing custody application service.

Adapters receive typed commands and trusted principal context. They do not
receive database handles, object paths, repositories, or mutation capability.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, fields, is_dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Mapping

from ..revision import DesignRevision
from ..source_tree import SourceTree, SourceTreeFile
from ..storage.blobs import BlobStore
from ..storage.db import Database
from ..storage.revisions import (
    ChannelConflictError,
    RevisionRepository,
    _issue_server_mutation_capability,
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
from .drafts import DraftRecord, DraftStore

_PRINCIPAL_PROOF = object()


class PrincipalAuthorityError(PermissionError):
    """Caller-supplied labels cannot become an authenticated principal."""


class IdempotencyConflictError(RuntimeError):
    """An idempotency identity was reused for a non-identical admission."""


class StaleBaseConflictError(RuntimeError):
    """The command's exact authored base is no longer current."""


class StaleDraftBaseError(StaleBaseConflictError):
    """The workspace is not the exact revision and generation captured by the draft."""


class PrincipalContext:
    """Opaque context issued only by the trusted service composition root."""

    __slots__ = ("principal_id", "_proof")

    def __new__(cls, principal_id: str, proof: object = None) -> "PrincipalContext":
        if proof is not _PRINCIPAL_PROOF:
            raise PrincipalAuthorityError("principal context is server-issued only")
        if not isinstance(principal_id, str) or not principal_id:
            raise ValueError("principal_id must not be empty")
        instance = super().__new__(cls)
        instance.principal_id = principal_id
        instance._proof = proof
        return instance


def _issue_principal_context(principal_id: str) -> PrincipalContext:
    """Trusted daemon authentication seam, intentionally not service-facing."""
    return PrincipalContext(principal_id, _PRINCIPAL_PROOF)


@dataclass(frozen=True, slots=True)
class CommandReceipt:
    command_id: str
    project_id: str
    kind: str
    outcome: str = "applied"
    persisted_revision_id: str | None = None
    parent_revision_id: str | None = None
    source_manifest_digest: str | None = None
    fabrication_release: bool = False
    machine_actuation: bool = False
    review_state: str = "needs_human_review"


@dataclass(frozen=True, slots=True)
class DraftReceipt:
    command_id: str
    project_id: str
    draft_id: str
    base_revision_id: str
    content_digest: str
    expires_at: str
    persisted_revision_id: None = None
    fabrication_release: bool = False
    machine_actuation: bool = False
    review_state: str = "needs_human_review"


class PitonApplicationService:
    """Own every Stage-1 authored-state effect behind one typed boundary."""

    def __init__(self, database: Database, blobs: BlobStore, drafts: DraftStore) -> None:
        if not isinstance(database, Database) or not isinstance(blobs, BlobStore):
            raise TypeError("trusted Database and BlobStore are required")
        if not isinstance(drafts, DraftStore):
            raise TypeError("trusted DraftStore is required")
        self.__database = database
        self.__blobs = blobs
        self.__drafts = drafts
        self.__repository = RevisionRepository(database, blobs)
        self.__mutation_capability = _issue_server_mutation_capability()

    @classmethod
    def open(cls, project_root: str | Path) -> "PitonApplicationService":
        root = Path(project_root)
        blobs = BlobStore(root)
        database = Database(root / ".piton" / "piton.sqlite3")
        database.migrate()
        drafts = DraftStore(root)
        drafts.recover_after_crash()
        return cls(database, blobs, drafts)

    def execute(
        self, command: object, ctx: PrincipalContext
    ) -> CommandReceipt | DraftReceipt:
        """Admit every adapter through one typed, idempotent command path."""
        routes = {
            CreateProject: ("create_project", self._create_project),
            ImportSourceBase: ("import_source_base", self._import_source_base),
            BeginDraft: ("begin_draft", self._begin_draft),
            UpdateDraft: ("update_draft", self._update_draft),
            CommitDraft: ("commit_draft", self._commit_draft),
            DiscardDraft: ("discard_draft", self._discard_draft),
            RestoreForward: ("restore_forward", self._restore_forward),
        }
        route = routes.get(type(command))
        if route is None:
            raise TypeError("command must be a supported Piton command")
        operation, handler = route
        self._require(command, type(command), ctx)
        request_digest = self._request_digest(command)
        replay = self._replay(command, ctx, operation, request_digest)
        if replay is not None:
            return replay
        receipt = handler(command, ctx)
        self._store_receipt(command, ctx, operation, request_digest, receipt)
        return receipt

    def create_project(self, cmd: CreateProject, ctx: PrincipalContext) -> CommandReceipt:
        receipt = self.execute(cmd, ctx)
        if not isinstance(receipt, CommandReceipt):
            raise TypeError("create_project returned a non-command receipt")
        return receipt

    def _create_project(self, cmd: CreateProject, ctx: PrincipalContext) -> CommandReceipt:
        self._require(cmd, CreateProject, ctx)
        now = self._now()
        with self.__database.immediate() as connection:
            connection.execute(
                "INSERT INTO projects(project_id, display_name, format_version, state, created_at) "
                "VALUES(?, ?, 1, 'active', ?)",
                (cmd.project_id, cmd.display_name, now),
            )
        return CommandReceipt(cmd.command_id, cmd.project_id, "create_project")

    def import_source_base(
        self, cmd: ImportSourceBase, ctx: PrincipalContext
    ) -> CommandReceipt:
        receipt = self.execute(cmd, ctx)
        if not isinstance(receipt, CommandReceipt):
            raise TypeError("import_source_base returned a non-command receipt")
        return receipt

    def _import_source_base(
        self, cmd: ImportSourceBase, ctx: PrincipalContext
    ) -> CommandReceipt:
        self._require(cmd, ImportSourceBase, ctx)
        with self.__database.read() as connection:
            existing = connection.execute(
                "SELECT revision_id, generation FROM channel_pointers "
                "WHERE project_id=? AND channel='workspace'",
                (cmd.project_id,),
            ).fetchone()
        if existing is not None:
            raise StaleDraftBaseError("workspace already has an imported source base")
        self.__repository.publish_source_tree(
            cmd.project_id, cmd.source_tree, capability=self.__mutation_capability
        )
        revision = self._revision(None, cmd.source_tree, cmd.parameter_values)
        self.__repository.persist_revision(
            cmd.project_id, revision, capability=self.__mutation_capability
        )
        self.__repository.move_channel(
            cmd.project_id,
            "workspace",
            revision.revision_id,
            expected_revision_id=None,
            expected_generation=0,
            capability=self.__mutation_capability,
        )
        return self._command_receipt(cmd.command_id, cmd.project_id, "import_source_base", revision)

    def begin_draft(self, cmd: BeginDraft, ctx: PrincipalContext) -> DraftReceipt:
        receipt = self.execute(cmd, ctx)
        if not isinstance(receipt, DraftReceipt):
            raise TypeError("begin_draft returned a non-draft receipt")
        return receipt

    def _begin_draft(self, cmd: BeginDraft, ctx: PrincipalContext) -> DraftReceipt:
        self._require(cmd, BeginDraft, ctx)
        self._require_workspace(
            cmd.project_id, cmd.base_revision_id, cmd.expected_generation
        )
        source = self._load_source_tree(cmd.project_id, cmd.base_revision_id)
        record = self.__drafts.begin(
            cmd.project_id,
            cmd.base_revision_id,
            cmd.expected_generation,
            source,
        )
        return self._draft_receipt(cmd.command_id, record)

    def update_draft(self, cmd: UpdateDraft, ctx: PrincipalContext) -> DraftReceipt:
        receipt = self.execute(cmd, ctx)
        if not isinstance(receipt, DraftReceipt):
            raise TypeError("update_draft returned a non-draft receipt")
        return receipt

    def _update_draft(self, cmd: UpdateDraft, ctx: PrincipalContext) -> DraftReceipt:
        self._require(cmd, UpdateDraft, ctx)
        current = self.__drafts.load(cmd.draft_id)
        if current.project_id != cmd.project_id:
            raise ValueError("draft does not belong to the exact project")
        updated = self.__drafts.update(cmd.draft_id, cmd.source_tree)
        return self._draft_receipt(cmd.command_id, updated)

    def commit_draft(self, cmd: CommitDraft, ctx: PrincipalContext) -> CommandReceipt:
        receipt = self.execute(cmd, ctx)
        if not isinstance(receipt, CommandReceipt):
            raise TypeError("commit_draft returned a non-command receipt")
        return receipt

    def _commit_draft(self, cmd: CommitDraft, ctx: PrincipalContext) -> CommandReceipt:
        self._require(cmd, CommitDraft, ctx)
        draft = self.__drafts.load(cmd.draft_id)
        if draft.project_id != cmd.project_id:
            raise ValueError("draft does not belong to the exact project")
        if (
            draft.base_revision_id != cmd.expected_revision_id
            or draft.base_generation != cmd.expected_generation
        ):
            raise StaleDraftBaseError("command does not match the draft's exact base")
        self._require_workspace(
            cmd.project_id, cmd.expected_revision_id, cmd.expected_generation
        )
        source = self.__drafts.load_tree(cmd.draft_id)
        revision = self._revision(cmd.expected_revision_id, source, cmd.parameter_values)
        try:
            self.__repository._commit_source_tree_revision_to_channel(
                cmd.project_id,
                source,
                revision,
                "workspace",
                expected_revision_id=cmd.expected_revision_id,
                expected_generation=cmd.expected_generation,
                capability=self.__mutation_capability,
            )
        except ChannelConflictError as error:
            raise StaleDraftBaseError("workspace changed before commit") from error
        self.__drafts.discard(cmd.draft_id)
        return self._command_receipt(cmd.command_id, cmd.project_id, "commit_draft", revision)

    def discard_draft(self, cmd: DiscardDraft, ctx: PrincipalContext) -> DraftReceipt:
        receipt = self.execute(cmd, ctx)
        if not isinstance(receipt, DraftReceipt):
            raise TypeError("discard_draft returned a non-draft receipt")
        return receipt

    def _discard_draft(self, cmd: DiscardDraft, ctx: PrincipalContext) -> DraftReceipt:
        self._require(cmd, DiscardDraft, ctx)
        record = self.__drafts.load(cmd.draft_id)
        if record.project_id != cmd.project_id:
            raise ValueError("draft does not belong to the exact project")
        discarded = self.__drafts.discard(cmd.draft_id)
        return self._draft_receipt(cmd.command_id, discarded)

    def restore_forward(self, cmd: RestoreForward, ctx: PrincipalContext) -> CommandReceipt:
        receipt = self.execute(cmd, ctx)
        if not isinstance(receipt, CommandReceipt):
            raise TypeError("restore_forward returned a non-command receipt")
        return receipt

    def _restore_forward(self, cmd: RestoreForward, ctx: PrincipalContext) -> CommandReceipt:
        self._require(cmd, RestoreForward, ctx)
        self._require_workspace(
            cmd.project_id, cmd.expected_revision_id, cmd.expected_generation
        )
        source = self._load_source_tree(cmd.project_id, cmd.target_revision_id)
        target = self._load_revision(cmd.project_id, cmd.target_revision_id)
        revision = self._revision(
            cmd.expected_revision_id, source, target.parameter_values
        )
        try:
            self.__repository._commit_source_tree_revision_to_channel(
                cmd.project_id,
                source,
                revision,
                "workspace",
                expected_revision_id=cmd.expected_revision_id,
                expected_generation=cmd.expected_generation,
                capability=self.__mutation_capability,
            )
        except ChannelConflictError as error:
            raise StaleDraftBaseError("workspace changed before restore-forward") from error
        return self._command_receipt(cmd.command_id, cmd.project_id, "restore_forward", revision)

    def expire_drafts(self) -> tuple[str, ...]:
        """Crash/maintenance cleanup creates no committed-work claim."""
        return self.__drafts.recover_after_crash()

    def _require_workspace(
        self, project_id: str, expected_revision_id: str, expected_generation: int
    ) -> None:
        with self.__database.read() as connection:
            current = connection.execute(
                "SELECT revision_id, generation FROM channel_pointers "
                "WHERE project_id=? AND channel='workspace'",
                (project_id,),
            ).fetchone()
        if current is None or tuple(current) != (expected_revision_id, expected_generation):
            raise StaleDraftBaseError("workspace expected head or generation is stale")

    def _load_source_tree(self, project_id: str, revision_id: str) -> SourceTree:
        revision = self._load_revision(project_id, revision_id)
        with self.__blobs.open_verified(revision.source_manifest_digest) as stream:
            manifest = json.load(stream)
        files: list[SourceTreeFile] = []
        for claim in manifest["files"]:
            with self.__blobs.open_verified(
                claim["digest"], expected_size=claim["byte_length"]
            ) as stream:
                content = stream.read()
            files.append(SourceTreeFile(claim["path"], content, claim["media_type"]))
        tree = SourceTree(
            files=tuple(files),
            entrypoint=manifest["entrypoint"],
            dependency_lock=manifest["dependency_lock"],
            toolchain_lock=manifest["toolchain_lock"],
        )
        if tree.digest != revision.source_manifest_digest:
            raise ValueError("immutable source tree failed canonical readback")
        return tree

    def _load_revision(self, project_id: str, revision_id: str) -> DesignRevision:
        with self.__database.read() as connection:
            row = connection.execute(
                "SELECT manifest_digest FROM design_revisions "
                "WHERE project_id=? AND revision_id=?",
                (project_id, revision_id),
            ).fetchone()
        if row is None:
            raise ValueError("revision is not in the exact project")
        with self.__blobs.open_verified(row[0]) as stream:
            manifest = json.load(stream)
        return DesignRevision.from_manifest(manifest)

    @staticmethod
    def _revision(
        parent_revision_id: str | None,
        tree: SourceTree,
        parameters: Mapping[str, str],
    ) -> DesignRevision:
        by_path = {item.path: item for item in tree.files}
        return DesignRevision(
            parent_revision_id=parent_revision_id,
            source_manifest_digest=tree.digest,
            entrypoint=tree.entrypoint,
            dependency_lock_digest=by_path[tree.dependency_lock].digest,
            toolchain_lock_digest=by_path[tree.toolchain_lock].digest,
            parameter_values=parameters,
        )

    @staticmethod
    def _canonical_value(value: object) -> object:
        if isinstance(value, SourceTree):
            return {"source_tree_digest": value.digest}
        if isinstance(value, Mapping):
            return {
                key: PitonApplicationService._canonical_value(value[key])
                for key in sorted(value)
            }
        if isinstance(value, tuple):
            return [PitonApplicationService._canonical_value(item) for item in value]
        if is_dataclass(value) and not isinstance(value, type):
            return {
                field.name: PitonApplicationService._canonical_value(
                    getattr(value, field.name)
                )
                for field in fields(value)
            }
        if value is None or isinstance(value, (str, int, bool)):
            return value
        raise TypeError(f"unsupported canonical command value: {type(value).__name__}")

    @classmethod
    def _request_digest(cls, command: object) -> str:
        payload = {
            "command_type": type(command).__name__,
            "command": cls._canonical_value(command),
        }
        encoded = json.dumps(
            payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False
        ).encode("utf-8")
        return "sha256:" + hashlib.sha256(encoded).hexdigest()

    def _replay(
        self,
        command: object,
        ctx: PrincipalContext,
        operation: str,
        request_digest: str,
    ) -> CommandReceipt | DraftReceipt | None:
        command_id = getattr(command, "command_id")
        project_id = getattr(command, "project_id")
        with self.__database.read() as connection:
            row = connection.execute(
                "SELECT r.project_id, r.actor_id, r.kind, r.request_digest, "
                "r.receipt_json, k.operation, k.idempotency_key "
                "FROM command_receipts AS r "
                "JOIN idempotency_keys AS k ON k.receipt_id=r.receipt_id "
                "WHERE r.command_id=?",
                (command_id,),
            ).fetchone()
        if row is None:
            return None
        identity = (
            row[0] == project_id
            and row[1] == ctx.principal_id
            and row[3] == request_digest
            and row[2] == operation
            and row[5] == operation
            and row[6] == command_id
        )
        if not identity:
            raise IdempotencyConflictError(
                "idempotency identity is already bound to a different canonical admission"
            )
        payload = json.loads(row[4])
        receipt_type = payload.pop("receipt_type", None)
        if receipt_type == "CommandReceipt":
            receipt: CommandReceipt | DraftReceipt = CommandReceipt(**payload)
        elif receipt_type == "DraftReceipt":
            receipt = DraftReceipt(**payload)
        else:
            raise RuntimeError("stored command receipt has an unsupported type")
        return receipt

    def _store_receipt(
        self,
        command: object,
        ctx: PrincipalContext,
        operation: str,
        request_digest: str,
        receipt: CommandReceipt | DraftReceipt,
    ) -> None:
        command_id = getattr(command, "command_id")
        project_id = getattr(command, "project_id")
        kind = receipt.kind if isinstance(receipt, CommandReceipt) else operation
        payload = asdict(receipt)
        payload["receipt_type"] = type(receipt).__name__
        receipt_json = json.dumps(
            payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False
        ).encode("utf-8")
        identity = f"{command_id}\0{project_id}\0{ctx.principal_id}".encode("utf-8")
        receipt_id = "receipt_" + hashlib.sha256(identity).hexdigest()
        now = self._now()
        with self.__database.immediate() as connection:
            connection.execute(
                "INSERT INTO command_receipts(receipt_id, command_id, project_id, actor_id, "
                "kind, request_digest, outcome, receipt_json, committed_at) "
                "VALUES(?, ?, ?, ?, ?, ?, 'applied', ?, ?)",
                (
                    receipt_id,
                    command_id,
                    project_id,
                    ctx.principal_id,
                    kind,
                    request_digest,
                    receipt_json,
                    now,
                ),
            )
            connection.execute(
                "INSERT INTO idempotency_keys(project_id, actor_id, operation, "
                "idempotency_key, request_digest, receipt_id, created_at) "
                "VALUES(?, ?, ?, ?, ?, ?, ?)",
                (
                    project_id,
                    ctx.principal_id,
                    operation,
                    command_id,
                    request_digest,
                    receipt_id,
                    now,
                ),
            )

    @staticmethod
    def _require(command: object, expected_type: type, ctx: PrincipalContext) -> None:
        if not isinstance(command, expected_type):
            raise TypeError(f"command must be {expected_type.__name__}")
        if (
            type(ctx) is not PrincipalContext
            or getattr(ctx, "_proof", None) is not _PRINCIPAL_PROOF
        ):
            raise TypeError("trusted PrincipalContext is required")

    @staticmethod
    def _draft_receipt(command_id: str, record: DraftRecord) -> DraftReceipt:
        return DraftReceipt(
            command_id,
            record.project_id,
            record.draft_id,
            record.base_revision_id,
            record.content_digest,
            record.expires_at,
        )

    @staticmethod
    def _command_receipt(
        command_id: str, project_id: str, kind: str, revision: DesignRevision
    ) -> CommandReceipt:
        return CommandReceipt(
            command_id,
            project_id,
            kind,
            persisted_revision_id=revision.revision_id,
            parent_revision_id=revision.parent_revision_id,
            source_manifest_digest=revision.source_manifest_digest,
        )

    @staticmethod
    def _now() -> str:
        return datetime.now(UTC).isoformat(timespec="microseconds").replace("+00:00", "Z")
