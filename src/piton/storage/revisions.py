"""Daemon-owned persistence for immutable source trees, revisions, and CAS refs."""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime

from ..revision import DesignRevision
from ..source_tree import SourceTree
from .blobs import ArtifactRef, BlobStore
from .db import Database

_CHANNELS = frozenset({"workspace", "candidate", "review", "last_good"})
_CAPABILITY_PROOF = object()


class ActorAuthorityError(PermissionError):
    """An execution-only actor attempted to mutate authored state or a channel."""


class MutationCapability:
    """Opaque server-issued authority for authored-state mutations.

    Request content and actor labels must never construct this type. The local
    daemon composition root issues it once and keeps it outside worker-facing
    interfaces.
    """

    __slots__ = ("_proof",)

    def __new__(cls, proof: object = None) -> "MutationCapability":
        if proof is not _CAPABILITY_PROOF:
            raise ActorAuthorityError("mutation capability is server-issued only")
        instance = super().__new__(cls)
        instance._proof = proof
        return instance


def _issue_server_mutation_capability() -> MutationCapability:
    """Issue authority at the trusted daemon composition root, never from a request."""
    return MutationCapability(_CAPABILITY_PROOF)


class ChannelConflictError(RuntimeError):
    """A channel no longer has the exact expected head and generation."""


class PersistenceConflictError(RuntimeError):
    """An immutable identity is already bound to different metadata."""


class StartupRecoveryError(RuntimeError):
    """Publication custody cannot be proven, so startup or commit must stop."""


@dataclass(frozen=True, slots=True)
class ChannelPointer:
    project_id: str
    channel: str
    revision_id: str | None
    generation: int
    updated_at: str


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="microseconds").replace("+00:00", "Z")


def _require_mutation_capability(capability: object) -> None:
    if (
        type(capability) is not MutationCapability
        or getattr(capability, "_proof", None) is not _CAPABILITY_PROOF
    ):
        raise ActorAuthorityError("server-issued mutation capability is required")


class RevisionRepository:
    """Coordinate blob-first publication with immutable SQLite metadata."""

    def __init__(self, database: Database, blobs: BlobStore):
        if not isinstance(database, Database):
            raise TypeError("database must be a Database")
        if not isinstance(blobs, BlobStore):
            raise TypeError("blobs must be a BlobStore")
        self.database = database
        self.blobs = blobs
        self.recover_startup()

    def recover_startup(self) -> tuple[str, ...]:
        """Discard resumable staging and prove every metadata-visible CAS object."""
        recovered = self.blobs.recover_incomplete_staging()
        with self.database.read() as connection:
            try:
                artifacts = connection.execute(
                    "SELECT digest, byte_length, storage_relpath FROM artifacts ORDER BY digest"
                ).fetchall()
            except sqlite3.DatabaseError as error:
                raise StartupRecoveryError(
                    "startup recovery cannot read committed artifact metadata"
                ) from error
            for digest, byte_length, storage_relpath in artifacts:
                expected_relpath = self.blobs.object_path(digest).relative_to(
                    self.blobs.project_root
                ).as_posix()
                if storage_relpath != expected_relpath or not self._blob_verifies(
                    digest, byte_length
                ):
                    raise StartupRecoveryError(
                        f"committed artifact is missing, corrupt, or misaddressed: {digest}"
                    )
        return tuple(path.as_posix() for path in recovered)

    def _blob_verifies(self, digest: str, expected_size: int) -> bool:
        try:
            stream = self.blobs.open_verified(digest, expected_size=expected_size)
        except (FileNotFoundError, OSError, RuntimeError, ValueError):
            return False
        stream.close()
        return True

    def _require_refs_verified(
        self, refs: tuple[ArtifactRef, ...] | list[ArtifactRef], *, context: str
    ) -> None:
        for ref in refs:
            if not self._blob_verifies(ref.digest, ref.byte_length):
                raise StartupRecoveryError(
                    f"{context} failed final CAS readback for {ref.digest}"
                )

    def _source_manifest_refs(self, manifest_digest: str) -> tuple[ArtifactRef, ...]:
        try:
            with self.blobs.open_verified(manifest_digest) as stream:
                manifest = json.load(stream)
            files = manifest["files"]
            if not isinstance(files, list) or not files:
                raise ValueError("source manifest files are invalid")
            refs = tuple(
                ArtifactRef(
                    digest=item["digest"],
                    byte_length=item["byte_length"],
                    media_type=item["media_type"],
                    storage_relpath=self.blobs.object_path(item["digest"])
                    .relative_to(self.blobs.project_root)
                    .as_posix(),
                )
                for item in files
            )
        except (
            FileNotFoundError,
            OSError,
            RuntimeError,
            ValueError,
            KeyError,
            TypeError,
            json.JSONDecodeError,
        ) as error:
            raise StartupRecoveryError(
                "revision publication cannot recover its canonical source manifest"
            ) from error
        return refs

    def _publish_bytes(
        self,
        scope_id: str,
        role: str,
        content: bytes,
        media_type: str,
    ) -> ArtifactRef:
        staged = self.blobs.stage_stream(
            scope_id,
            role,
            (content,),
            media_type=media_type,
            max_bytes=len(content),
        )
        return self.blobs.promote_no_clobber(staged)

    @staticmethod
    def _record_artifact(connection: sqlite3.Connection, artifact: ArtifactRef, now: str) -> None:
        existing = connection.execute(
            "SELECT media_type, byte_length, storage_relpath FROM artifacts WHERE digest=?",
            (artifact.digest,),
        ).fetchone()
        claims = (artifact.media_type, artifact.byte_length, artifact.storage_relpath)
        if existing is not None:
            if tuple(existing) != claims:
                raise PersistenceConflictError("artifact digest has conflicting metadata")
            return
        connection.execute(
            "INSERT INTO artifacts(digest, media_type, byte_length, storage_relpath, "
            "created_at, verified_at) VALUES(?, ?, ?, ?, ?, ?)",
            (artifact.digest, *claims, now, now),
        )

    def publish_source_tree(
        self,
        project_id: str,
        tree: SourceTree,
        *,
        capability: MutationCapability,
    ) -> str:
        """Publish all source bytes and the canonical manifest before one metadata commit."""
        _require_mutation_capability(capability)
        if not isinstance(tree, SourceTree):
            raise TypeError("tree must be a SourceTree")
        scope = "tree-" + tree.digest[7:23]
        refs: list[ArtifactRef] = []
        for index, item in enumerate(sorted(tree.files, key=lambda candidate: candidate.path)):
            ref = self._publish_bytes(scope, f"file-{index}", item.content, item.media_type)
            if ref.digest != item.digest or ref.byte_length != item.byte_length:
                raise PersistenceConflictError("published source bytes changed identity")
            refs.append(ref)
        manifest_ref = self._publish_bytes(
            scope, "manifest", tree.canonical_bytes, "application/json"
        )
        if manifest_ref.digest != tree.digest:
            raise PersistenceConflictError("published source manifest changed identity")
        now = _now()
        by_digest = {ref.digest: ref for ref in refs}
        dependency_ref = by_digest[tree.file(tree.dependency_lock).digest]
        toolchain_ref = by_digest[tree.file(tree.toolchain_lock).digest]
        with self.database.immediate() as connection:
            if connection.execute(
                "SELECT 1 FROM projects WHERE project_id=?", (project_id,)
            ).fetchone() is None:
                raise ValueError("project does not exist")
            self._require_refs_verified(
                [*refs, manifest_ref], context="source tree publication"
            )
            for ref in (*refs, manifest_ref):
                self._record_artifact(connection, ref, now)
            existing = connection.execute(
                "SELECT project_id, entrypoint, dependency_lock_digest, toolchain_lock_digest "
                "FROM source_trees WHERE manifest_digest=?",
                (tree.digest,),
            ).fetchone()
            claims = (
                project_id,
                tree.entrypoint,
                dependency_ref.digest,
                toolchain_ref.digest,
            )
            if existing is None:
                connection.execute(
                    "INSERT INTO source_trees(manifest_digest, project_id, entrypoint, "
                    "dependency_lock_digest, toolchain_lock_digest, created_at) "
                    "VALUES(?, ?, ?, ?, ?, ?)",
                    (tree.digest, *claims, now),
                )
            elif tuple(existing) != claims:
                raise PersistenceConflictError("source tree identity has conflicting metadata")
        return tree.digest

    def persist_revision(
        self,
        project_id: str,
        revision: DesignRevision,
        *,
        capability: MutationCapability,
    ) -> str:
        """Append one authored revision after its complete source tree is durable."""
        _require_mutation_capability(capability)
        if not isinstance(revision, DesignRevision):
            raise TypeError("revision must be a DesignRevision")
        scope = "revision-" + revision.revision_id[4:20]
        manifest_ref = self._publish_bytes(
            scope, "manifest", revision.canonical_bytes, "application/json"
        )
        now = _now()
        with self.database.immediate() as connection:
            source = connection.execute(
                "SELECT project_id, entrypoint, dependency_lock_digest, toolchain_lock_digest "
                "FROM source_trees WHERE manifest_digest=?",
                (revision.source_manifest_digest,),
            ).fetchone()
            if source is None:
                raise ValueError("revision source tree is not durably published")
            if tuple(source) != (
                project_id,
                revision.entrypoint,
                revision.dependency_lock_digest,
                revision.toolchain_lock_digest,
            ):
                raise PersistenceConflictError("revision authority does not match its source tree")
            if revision.parent_revision_id is not None:
                parent = connection.execute(
                    "SELECT project_id FROM design_revisions WHERE revision_id=?",
                    (revision.parent_revision_id,),
                ).fetchone()
                if parent is None or parent[0] != project_id:
                    raise ValueError("parent revision is missing from the exact project")
            source_refs = self._source_manifest_refs(revision.source_manifest_digest)
            self._require_refs_verified(
                [*source_refs, manifest_ref], context="revision publication"
            )
            self._record_artifact(connection, manifest_ref, now)
            existing = connection.execute(
                "SELECT project_id, parent_revision_id, proposal_id, manifest_digest, "
                "source_manifest_digest, authority_profile FROM design_revisions "
                "WHERE revision_id=?",
                (revision.revision_id,),
            ).fetchone()
            claims = (
                project_id,
                revision.parent_revision_id,
                revision.proposal_id,
                manifest_ref.digest,
                revision.source_manifest_digest,
                revision.authority_profile,
            )
            if existing is None:
                connection.execute(
                    "INSERT INTO design_revisions(revision_id, project_id, parent_revision_id, "
                    "proposal_id, manifest_digest, source_manifest_digest, authority_profile, created_at) "
                    "VALUES(?, ?, ?, ?, ?, ?, ?, ?)",
                    (revision.revision_id, *claims, now),
                )
            elif tuple(existing) != claims:
                raise PersistenceConflictError("revision identity has conflicting metadata")
        return revision.revision_id

    def _commit_source_tree_revision_to_channel(
        self,
        project_id: str,
        tree: SourceTree,
        revision: DesignRevision,
        channel: str,
        *,
        expected_revision_id: str | None,
        expected_generation: int,
        capability: MutationCapability,
    ) -> ChannelPointer:
        """Publish bytes, then atomically claim tree, revision, and channel CAS."""
        _require_mutation_capability(capability)
        if not isinstance(tree, SourceTree):
            raise TypeError("tree must be a SourceTree")
        if not isinstance(revision, DesignRevision):
            raise TypeError("revision must be a DesignRevision")
        if revision.source_manifest_digest != tree.digest:
            raise PersistenceConflictError("revision does not bind the supplied source tree")
        if revision.parent_revision_id != expected_revision_id:
            raise PersistenceConflictError("revision parent must be the exact channel head")
        if channel not in _CHANNELS:
            raise ValueError("channel is not a declared Piton channel")
        if (
            isinstance(expected_generation, bool)
            or not isinstance(expected_generation, int)
            or expected_generation < 0
        ):
            raise ValueError("expected_generation must be a non-negative integer")

        scope = "commit-" + revision.revision_id[4:20]
        file_refs: list[ArtifactRef] = []
        for index, item in enumerate(sorted(tree.files, key=lambda candidate: candidate.path)):
            ref = self._publish_bytes(scope, f"file-{index}", item.content, item.media_type)
            if ref.digest != item.digest or ref.byte_length != item.byte_length:
                raise PersistenceConflictError("published source bytes changed identity")
            file_refs.append(ref)
        tree_ref = self._publish_bytes(
            scope, "source-manifest", tree.canonical_bytes, "application/json"
        )
        revision_ref = self._publish_bytes(
            scope, "revision-manifest", revision.canonical_bytes, "application/json"
        )
        if tree_ref.digest != tree.digest:
            raise PersistenceConflictError("published source manifest changed identity")

        by_digest = {ref.digest: ref for ref in file_refs}
        dependency_ref = by_digest[tree.file(tree.dependency_lock).digest]
        toolchain_ref = by_digest[tree.file(tree.toolchain_lock).digest]
        now = _now()
        with self.database.immediate() as connection:
            current = connection.execute(
                "SELECT revision_id, generation FROM channel_pointers "
                "WHERE project_id=? AND channel=?",
                (project_id, channel),
            ).fetchone()
            if current is None or tuple(current) != (
                expected_revision_id,
                expected_generation,
            ):
                raise ChannelConflictError("channel expected head or generation is stale")
            parent = connection.execute(
                "SELECT project_id FROM design_revisions WHERE revision_id=?",
                (expected_revision_id,),
            ).fetchone()
            if parent is None or parent[0] != project_id:
                raise PersistenceConflictError("exact parent revision is missing")
            self._require_refs_verified(
                [*file_refs, tree_ref, revision_ref],
                context="atomic revision publication",
            )
            for ref in (*file_refs, tree_ref, revision_ref):
                self._record_artifact(connection, ref, now)
            existing_tree = connection.execute(
                "SELECT project_id, entrypoint, dependency_lock_digest, toolchain_lock_digest "
                "FROM source_trees WHERE manifest_digest=?",
                (tree.digest,),
            ).fetchone()
            tree_claims = (
                project_id,
                tree.entrypoint,
                dependency_ref.digest,
                toolchain_ref.digest,
            )
            if existing_tree is None:
                connection.execute(
                    "INSERT INTO source_trees(manifest_digest, project_id, entrypoint, "
                    "dependency_lock_digest, toolchain_lock_digest, created_at) "
                    "VALUES(?, ?, ?, ?, ?, ?)",
                    (tree.digest, *tree_claims, now),
                )
            elif tuple(existing_tree) != tree_claims:
                raise PersistenceConflictError("source tree identity has conflicting metadata")
            connection.execute(
                "INSERT INTO design_revisions(revision_id, project_id, parent_revision_id, "
                "proposal_id, manifest_digest, source_manifest_digest, authority_profile, created_at) "
                "VALUES(?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    revision.revision_id,
                    project_id,
                    revision.parent_revision_id,
                    revision.proposal_id,
                    revision_ref.digest,
                    revision.source_manifest_digest,
                    revision.authority_profile,
                    now,
                ),
            )
            cursor = connection.execute(
                "UPDATE channel_pointers SET revision_id=?, generation=generation+1, updated_at=? "
                "WHERE project_id=? AND channel=? AND generation=? AND revision_id IS ?",
                (
                    revision.revision_id,
                    now,
                    project_id,
                    channel,
                    expected_generation,
                    expected_revision_id,
                ),
            )
            if cursor.rowcount != 1:
                raise ChannelConflictError("channel compare-and-swap lost a race")
        return ChannelPointer(
            project_id,
            channel,
            revision.revision_id,
            expected_generation + 1,
            now,
        )

    def move_channel(
        self,
        project_id: str,
        channel: str,
        revision_id: str | None,
        *,
        expected_revision_id: str | None,
        expected_generation: int,
        capability: MutationCapability,
    ) -> ChannelPointer:
        """Move one mutable ref only when both expected head and generation match."""
        _require_mutation_capability(capability)
        if channel not in _CHANNELS:
            raise ValueError("channel is not a declared Piton channel")
        if isinstance(expected_generation, bool) or not isinstance(expected_generation, int) or expected_generation < 0:
            raise ValueError("expected_generation must be a non-negative integer")
        now = _now()
        with self.database.immediate() as connection:
            if revision_id is not None:
                target = connection.execute(
                    "SELECT project_id FROM design_revisions WHERE revision_id=?", (revision_id,)
                ).fetchone()
                if target is None or target[0] != project_id:
                    raise ValueError("channel target is not a revision in the exact project")
            current = connection.execute(
                "SELECT revision_id, generation FROM channel_pointers "
                "WHERE project_id=? AND channel=?",
                (project_id, channel),
            ).fetchone()
            if current is None:
                if expected_revision_id is not None or expected_generation != 0:
                    raise ChannelConflictError("channel expected head or generation is stale")
                try:
                    connection.execute(
                        "INSERT INTO channel_pointers(project_id, channel, revision_id, generation, updated_at) "
                        "VALUES(?, ?, ?, 1, ?)",
                        (project_id, channel, revision_id, now),
                    )
                except sqlite3.IntegrityError as error:
                    raise ChannelConflictError("channel was concurrently created") from error
                generation = 1
            else:
                if tuple(current) != (expected_revision_id, expected_generation):
                    raise ChannelConflictError("channel expected head or generation is stale")
                cursor = connection.execute(
                    "UPDATE channel_pointers SET revision_id=?, generation=generation+1, updated_at=? "
                    "WHERE project_id=? AND channel=? AND generation=? "
                    "AND revision_id IS ?",
                    (
                        revision_id,
                        now,
                        project_id,
                        channel,
                        expected_generation,
                        expected_revision_id,
                    ),
                )
                if cursor.rowcount != 1:
                    raise ChannelConflictError("channel compare-and-swap lost a race")
                generation = expected_generation + 1
        return ChannelPointer(project_id, channel, revision_id, generation, now)
