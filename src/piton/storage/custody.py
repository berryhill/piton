"""Portable project backup, restore, retention, and tombstone custody.

The portable authority is canonical JSON metadata plus immutable CAS payloads,
never a copied SQLite file or mutable SQLite sidecar.  These operations do not
create review, approval, export, release, or machine-actuation authority.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from cryptography.exceptions import InvalidSignature

from ._backup_identity_process import (
    _issue_server_backup_capability,
    _sign_completed_manifest,
    public_key,
)
from .blobs import BlobStore
from .db import Database

_DIGEST = re.compile(r"^sha256:[0-9a-f]{64}$")
_SCHEMA = "piton.project-backup.v1"
_EXCLUSIONS = (
    "raw SQLite database, WAL, and SHM files are not portable authority",
    "cache, staging, quarantine, viewer state, and adjacent mutable sidecars are excluded",
    "backup or restore success is not review acceptance, approval, export, fabrication release, or machine actuation",
)
_SIGNATURE = re.compile(r"^[0-9a-f]{128}$")


class BackupValidationError(RuntimeError):
    """A backup or restore claim cannot be proved exactly."""


@dataclass(frozen=True, slots=True)
class BackupIdentity:
    """Durable authenticated identity for one exact backup manifest."""

    manifest_digest: str
    project_id: str
    signature: str

    def serialize(self) -> str:
        return _canonical(
            {
                "manifest_digest": self.manifest_digest,
                "project_id": self.project_id,
                "signature": self.signature,
            }
        ).decode("utf-8")

    @classmethod
    def parse(cls, value: str) -> "BackupIdentity":
        try:
            decoded = json.loads(value)
        except (TypeError, json.JSONDecodeError) as error:
            raise BackupValidationError("trusted identity cannot be decoded") from error
        if not isinstance(decoded, dict) or set(decoded) != {
            "manifest_digest", "project_id", "signature"
        }:
            raise BackupValidationError("trusted identity schema is invalid")
        return cls(decoded["manifest_digest"], decoded["project_id"], decoded["signature"])


def _identity_body(manifest_digest: str, project_id: str) -> bytes:
    return _canonical(
        {
            "domain": "piton.backup-identity.v1",
            "manifest_digest": manifest_digest,
            "project_id": project_id,
        }
    )


@dataclass(frozen=True, slots=True)
class BackupReceipt:
    project_id: str
    manifest_digest: str
    object_count: int
    destination: str
    trusted_identity: BackupIdentity
    fabrication_release: bool = False
    machine_actuation: bool = False


@dataclass(frozen=True, slots=True)
class RestoreReceipt:
    project_id: str
    manifest_digest: str
    restored_objects: int
    review_state: str = "needs_human_review"
    fabrication_release: bool = False
    machine_actuation: bool = False


@dataclass(frozen=True, slots=True)
class RetentionPolicy:
    """Stage-1 retention can remove only CAS bytes absent from metadata custody."""

    keep_unreferenced: bool = True


@dataclass(frozen=True, slots=True)
class RetentionReceipt:
    deleted_digests: tuple[str, ...]
    dry_run: bool
    fabrication_release: bool = False
    machine_actuation: bool = False


@dataclass(frozen=True, slots=True)
class DeletionReceipt:
    project_id: str
    state: str
    reason: str
    fabrication_release: bool = False
    machine_actuation: bool = False


def _canonical(value: Any) -> bytes:
    return json.dumps(
        value, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="microseconds").replace("+00:00", "Z")


def _quote(identifier: str) -> str:
    if not identifier or "\x00" in identifier:
        raise BackupValidationError("invalid SQLite identifier")
    return '"' + identifier.replace('"', '""') + '"'


def _json_value(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float)):
        return value
    if isinstance(value, bytes):
        return {"$piton_bytes_hex": value.hex()}
    raise BackupValidationError(f"unsupported SQLite value type: {type(value).__name__}")


def _sqlite_value(value: Any) -> Any:
    if isinstance(value, dict) and set(value) == {"$piton_bytes_hex"}:
        try:
            return bytes.fromhex(value["$piton_bytes_hex"])
        except (TypeError, ValueError) as error:
            raise BackupValidationError("invalid encoded SQLite bytes") from error
    if value is None or isinstance(value, (str, int, float)):
        return value
    raise BackupValidationError("invalid portable metadata value")


class ProjectCustody:
    """Daemon-side project custody without a second writable design authority."""

    __backup_identity_verifier = public_key()
    __backup_signing_capability = _issue_server_backup_capability()

    def __init__(self, database: Database, blobs: BlobStore) -> None:
        if not isinstance(database, Database) or not isinstance(blobs, BlobStore):
            raise TypeError("database and blobs must be Piton custody objects")
        self.database = database
        self.blobs = blobs

    def _require_backup_identity(self, identity: object) -> BackupIdentity:
        if isinstance(identity, str):
            if not identity.startswith("{"):
                raise TypeError("trusted_identity must be a serialized or authenticated BackupIdentity")
            identity = BackupIdentity.parse(identity)
        elif type(identity) is not BackupIdentity:
            raise TypeError("trusted_identity must be a serialized or authenticated BackupIdentity")
        if (
            not isinstance(identity.manifest_digest, str)
            or not _DIGEST.fullmatch(identity.manifest_digest)
            or not isinstance(identity.project_id, str)
            or not identity.project_id
            or not isinstance(identity.signature, str)
            or not _SIGNATURE.fullmatch(identity.signature)
        ):
            raise BackupValidationError("trusted identity signature is invalid")
        try:
            self.__backup_identity_verifier.verify(
                bytes.fromhex(identity.signature),
                _identity_body(identity.manifest_digest, identity.project_id),
            )
        except (InvalidSignature, ValueError):
            raise BackupValidationError("trusted identity signature is invalid")
        return identity

    @staticmethod
    def _tables(connection: sqlite3.Connection) -> tuple[str, ...]:
        return tuple(
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table' "
                "AND name NOT LIKE 'sqlite_%' AND name<>'schema_migrations' ORDER BY name"
            )
        )

    @staticmethod
    def _columns(connection: sqlite3.Connection, table: str) -> tuple[str, ...]:
        return tuple(row[1] for row in connection.execute(f"PRAGMA table_info({_quote(table)})"))

    def _project_rows(self, connection: sqlite3.Connection, project_id: str) -> dict[str, list[dict[str, Any]]]:
        tables = self._tables(connection)
        selected: dict[str, list[dict[str, Any]]] = {table: [] for table in tables}
        for table in tables:
            columns = self._columns(connection, table)
            if table == "projects":
                rows = connection.execute(
                    "SELECT * FROM projects WHERE project_id=?", (project_id,)
                ).fetchall()
            elif "project_id" in columns:
                rows = connection.execute(
                    f"SELECT * FROM {_quote(table)} WHERE project_id=?", (project_id,)
                ).fetchall()
            else:
                rows = ()
            selected[table] = [dict(row) for row in rows]
        if not selected.get("projects"):
            raise BackupValidationError("project does not exist")

        # Pull parent rows (principally artifacts) referenced by selected project rows.
        changed = True
        while changed:
            changed = False
            for child_table, child_rows in tuple(selected.items()):
                if not child_rows:
                    continue
                for fk in connection.execute(f"PRAGMA foreign_key_list({_quote(child_table)})"):
                    parent_table, child_column, parent_column = fk[2], fk[3], fk[4]
                    if parent_table not in selected:
                        continue
                    wanted = {row.get(child_column) for row in child_rows if row.get(child_column) is not None}
                    existing = {row.get(parent_column) for row in selected[parent_table]}
                    for value in sorted(wanted - existing, key=repr):
                        parent = connection.execute(
                            f"SELECT * FROM {_quote(parent_table)} WHERE {_quote(parent_column)}=?",
                            (value,),
                        ).fetchone()
                        if parent is None:
                            raise BackupValidationError(
                                f"metadata reference closure is missing {parent_table}.{parent_column}"
                            )
                        selected[parent_table].append(dict(parent))
                        changed = True

            # Link tables without project_id belong when all their non-null parents
            # are already in the selected closure (for example closure/artifact links).
            for table in tables:
                if selected[table] or "project_id" in self._columns(connection, table) or table == "projects":
                    continue
                foreign_keys = tuple(connection.execute(f"PRAGMA foreign_key_list({_quote(table)})"))
                if not foreign_keys:
                    continue
                for candidate in connection.execute(f"SELECT * FROM {_quote(table)}"):
                    row = dict(candidate)
                    linked = False
                    valid = True
                    for fk in foreign_keys:
                        parent_table, child_column, parent_column = fk[2], fk[3], fk[4]
                        value = row.get(child_column)
                        if value is None:
                            continue
                        linked = True
                        if not any(parent.get(parent_column) == value for parent in selected[parent_table]):
                            valid = False
                            break
                    if linked and valid:
                        selected[table].append(row)
                        changed = True

        # Canonical manifests may carry digest references inside JSON rather than
        # relational foreign keys (notably source-tree file inventories). Follow
        # those references through verified CAS bytes until closure.
        artifacts = selected.get("artifacts", [])
        known = {row["digest"] for row in artifacts}
        pending_digests = list(sorted(known))
        while pending_digests:
            digest = pending_digests.pop(0)
            artifact = next(row for row in artifacts if row["digest"] == digest)
            if artifact["media_type"] != "application/json":
                continue
            try:
                with self.blobs.open_verified(digest, expected_size=artifact["byte_length"]) as stream:
                    value = json.load(stream)
            except (OSError, RuntimeError, ValueError, json.JSONDecodeError) as error:
                raise BackupValidationError("referenced canonical JSON object is invalid") from error
            references: set[str] = set()

            def collect(candidate: Any) -> None:
                if isinstance(candidate, str) and _DIGEST.fullmatch(candidate):
                    references.add(candidate)
                elif isinstance(candidate, list):
                    for child in candidate:
                        collect(child)
                elif isinstance(candidate, dict):
                    for child in candidate.values():
                        collect(child)

            collect(value)
            for reference in sorted(references - known):
                row = connection.execute(
                    "SELECT * FROM artifacts WHERE digest=?", (reference,)
                ).fetchone()
                if row is None:
                    raise BackupValidationError(
                        f"canonical object reference closure is missing {reference}"
                    )
                artifacts.append(dict(row))
                known.add(reference)
                pending_digests.append(reference)
        return selected

    def backup(self, project_id: str, destination: Path | str, *, created_at: str | None = None) -> BackupReceipt:
        """Write a deterministic portable manifest and immutable payload closure."""
        destination = Path(destination)
        if destination.exists():
            raise BackupValidationError("backup destination already exists")
        created = created_at or _now()
        with self.database.read() as connection:
            rows = self._project_rows(connection, project_id)
            metadata = []
            for table in sorted(rows):
                table_rows = rows[table]
                if not table_rows:
                    continue
                encoded = [
                    {key: _json_value(value) for key, value in sorted(row.items())}
                    for row in table_rows
                ]
                encoded.sort(key=lambda item: _canonical(item))
                metadata.append({"table": table, "rows": encoded})

        artifact_rows = next((item["rows"] for item in metadata if item["table"] == "artifacts"), [])
        objects = []
        payloads: list[tuple[dict[str, Any], bytes]] = []
        for artifact in sorted(artifact_rows, key=lambda item: item["digest"]):
            digest = artifact["digest"]
            byte_length = artifact["byte_length"]
            if not isinstance(digest, str) or not _DIGEST.fullmatch(digest):
                raise BackupValidationError("artifact metadata has an invalid digest")
            with self.blobs.open_verified(digest, expected_size=byte_length) as stream:
                payload = stream.read()
            relative = f"objects/sha256/{digest[7:9]}/{digest[9:]}"
            object_row = {
                "byte_length": byte_length,
                "digest": digest,
                "media_type": artifact["media_type"],
                "relative_path": relative,
            }
            objects.append(object_row)
            payloads.append((object_row, payload))

        project = rows["projects"][0]
        manifest = {
            "schema": _SCHEMA,
            "schema_version": 1,
            "created_at": created,
            "project": {
                "project_id": project_id,
                "display_name": project["display_name"],
                "format_version": project["format_version"],
            },
            "safety": {
                "review_state": "needs_human_review",
                "fabrication_release": False,
                "machine_actuation": False,
            },
            "claim_scope_exclusions": list(_EXCLUSIONS),
            "metadata": metadata,
            "objects": objects,
        }
        manifest_bytes = _canonical(manifest)
        manifest_digest = "sha256:" + hashlib.sha256(manifest_bytes).hexdigest()

        try:
            destination.mkdir(parents=True, mode=0o700)
            for object_row, payload in payloads:
                path = destination / object_row["relative_path"]
                path.parent.mkdir(parents=True, exist_ok=True)
                with path.open("xb") as stream:
                    stream.write(payload)
                    stream.flush()
                    os.fsync(stream.fileno())
                path.chmod(0o444)
            manifest_path = destination / "manifest.json"
            with manifest_path.open("xb") as stream:
                stream.write(manifest_bytes)
                stream.flush()
                os.fsync(stream.fileno())
            manifest_path.chmod(0o444)
        except BaseException:
            # An incomplete destination has no receipt and restore always validates
            # the complete manifest/object closure before publishing anything.
            raise
        # Signing-key custody is isolated in a helper process. The helper reads
        # back and validates the completed canonical manifest before signing it;
        # this process retains only the public verification key.
        try:
            signed_digest, signature = _sign_completed_manifest(
                manifest_path,
                project_id,
                capability=self.__backup_signing_capability,
            )
        except RuntimeError as error:
            raise BackupValidationError("backup identity helper rejected the manifest") from error
        if signed_digest != manifest_digest:
            raise BackupValidationError("backup identity digest changed during issuance")
        trusted_identity = BackupIdentity(
            manifest_digest,
            project_id,
            signature,
        )
        if trusted_identity.manifest_digest != manifest_digest:
            raise BackupValidationError("backup identity digest changed during issuance")
        return BackupReceipt(
            project_id, manifest_digest, len(objects), str(destination), trusted_identity
        )

    def _validated_manifest(
        self, source: Path, *, trusted_identity: BackupIdentity | str
    ) -> tuple[dict[str, Any], str, list[tuple[dict[str, Any], bytes]]]:
        identity = self._require_backup_identity(trusted_identity)
        expected_manifest_digest = identity.manifest_digest
        if not _DIGEST.fullmatch(expected_manifest_digest):
            raise BackupValidationError("trusted manifest digest is invalid")
        try:
            manifest_bytes = (source / "manifest.json").read_bytes()
        except OSError as error:
            raise BackupValidationError("backup manifest cannot be read") from error
        digest = "sha256:" + hashlib.sha256(manifest_bytes).hexdigest()
        if not hmac.compare_digest(digest, expected_manifest_digest):
            raise BackupValidationError("backup does not match trusted manifest digest")
        try:
            manifest = json.loads(manifest_bytes)
        except json.JSONDecodeError as error:
            raise BackupValidationError("backup manifest cannot be read") from error
        if _canonical(manifest) != manifest_bytes:
            raise BackupValidationError("backup manifest is not canonical JSON")
        if manifest.get("schema") != _SCHEMA or manifest.get("schema_version") != 1:
            raise BackupValidationError("unsupported backup schema")
        expected_safety = {
            "review_state": "needs_human_review",
            "fabrication_release": False,
            "machine_actuation": False,
        }
        if manifest.get("safety") != expected_safety:
            raise BackupValidationError("backup safety state is invalid")
        payloads = []
        seen: set[str] = set()
        for item in manifest.get("objects", []):
            claimed = item.get("digest")
            length = item.get("byte_length")
            relative = item.get("relative_path")
            if (
                not isinstance(claimed, str)
                or not _DIGEST.fullmatch(claimed)
                or claimed in seen
                or relative != f"objects/sha256/{claimed[7:9]}/{claimed[9:]}"
                or isinstance(length, bool)
                or not isinstance(length, int)
                or length < 0
            ):
                raise BackupValidationError("backup object inventory is invalid")
            seen.add(claimed)
            try:
                payload = (source / relative).read_bytes()
            except OSError as error:
                raise BackupValidationError("backup object is missing") from error
            actual = "sha256:" + hashlib.sha256(payload).hexdigest()
            if len(payload) != length or actual != claimed:
                raise BackupValidationError("backup object digest or byte length mismatch")
            payloads.append((item, payload))
        return manifest, digest, payloads

    def restore(
        self, source: Path | str, *, trusted_identity: BackupIdentity | str
    ) -> RestoreReceipt:
        """Restore only an identity issued through the separate backup receipt."""
        source = Path(source)
        identity = self._require_backup_identity(trusted_identity)
        manifest, manifest_digest, payloads = self._validated_manifest(
            source, trusted_identity=identity
        )
        project_id = manifest.get("project", {}).get("project_id")
        if not isinstance(project_id, str) or not project_id:
            raise BackupValidationError("backup project identity is invalid")
        if not hmac.compare_digest(project_id, identity.project_id):
            raise BackupValidationError("backup does not match trusted project identity")
        metadata = manifest.get("metadata")
        if not isinstance(metadata, list):
            raise BackupValidationError("backup metadata inventory is invalid")
        by_table: dict[str, list[dict[str, Any]]] = {}
        with self.database.read() as connection:
            allowed = set(self._tables(connection))
            if connection.execute(
                "SELECT 1 FROM projects WHERE project_id=?", (project_id,)
            ).fetchone() is not None:
                raise BackupValidationError("project already exists; restore cannot replace authority")
            for item in metadata:
                if not isinstance(item, dict) or set(item) != {"table", "rows"}:
                    raise BackupValidationError("backup metadata entry is invalid")
                table, rows = item["table"], item["rows"]
                if table not in allowed or table in by_table or not isinstance(rows, list):
                    raise BackupValidationError("backup metadata table is invalid")
                columns = set(self._columns(connection, table))
                decoded = []
                for row in rows:
                    if not isinstance(row, dict) or set(row) != columns:
                        raise BackupValidationError("backup metadata row does not match current schema")
                    decoded.append({key: _sqlite_value(value) for key, value in row.items()})
                by_table[table] = decoded
        if not any(row.get("project_id") == project_id for row in by_table.get("projects", [])):
            raise BackupValidationError("backup does not contain its exact project row")
        if len(by_table.get("projects", [])) != 1:
            raise BackupValidationError("backup contains foreign project authority")
        for rows in by_table.values():
            for row in rows:
                if "project_id" in row and row["project_id"] != project_id:
                    raise BackupValidationError("backup contains foreign project authority")

        # Payload publication is content-addressed and idempotent. If the metadata
        # transaction later fails, these remain harmless unreferenced CAS objects.
        for index, (item, payload) in enumerate(payloads):
            staged = self.blobs.stage_stream(
                "restore-" + manifest_digest[7:23], f"object-{index}", (payload,),
                media_type=item["media_type"], max_bytes=item["byte_length"],
            )
            ref = self.blobs.promote_no_clobber(staged)
            if ref.digest != item["digest"] or ref.byte_length != item["byte_length"]:
                raise BackupValidationError("restored object identity changed")

        pending = [
            (table, row)
            for table in sorted(by_table)
            for row in by_table[table]
        ]
        try:
            with self.database.immediate() as connection:
                while pending:
                    progressed = False
                    for table, row in tuple(pending):
                        columns = tuple(row)
                        placeholders = ",".join("?" for _ in columns)
                        sql = (
                            f"INSERT INTO {_quote(table)}({','.join(_quote(column) for column in columns)}) "
                            f"VALUES({placeholders})"
                        )
                        try:
                            connection.execute(sql, tuple(row[column] for column in columns))
                        except sqlite3.IntegrityError:
                            continue
                        pending.remove((table, row))
                        progressed = True
                    if not progressed:
                        raise BackupValidationError(
                            "backup metadata cannot satisfy current schema reference closure"
                        )
        except sqlite3.DatabaseError as error:
            raise BackupValidationError("backup metadata restore failed") from error
        return RestoreReceipt(project_id, manifest_digest, len(payloads))

    def apply_retention(self, policy: RetentionPolicy, *, dry_run: bool = True) -> RetentionReceipt:
        """Prune only verified digest paths absent from the artifacts authority table."""
        if not isinstance(policy, RetentionPolicy):
            raise TypeError("policy must be a RetentionPolicy")
        if policy.keep_unreferenced:
            return RetentionReceipt((), dry_run)
        with self.database.read() as connection:
            referenced = {row[0] for row in connection.execute("SELECT digest FROM artifacts")}
        candidates: list[tuple[str, Path]] = []
        for shard in sorted(self.blobs.objects_root.iterdir(), key=lambda path: path.name):
            if shard.is_symlink() or not shard.is_dir() or not re.fullmatch(r"[0-9a-f]{2}", shard.name):
                continue
            for path in sorted(shard.iterdir(), key=lambda item: item.name):
                digest = "sha256:" + shard.name + path.name
                if _DIGEST.fullmatch(digest) and digest not in referenced and self.blobs.exists_verified(digest):
                    candidates.append((digest, path))
        if not dry_run:
            for _digest, path in candidates:
                path.unlink()
                self.blobs.fsync_parent(path)
        return RetentionReceipt(tuple(digest for digest, _path in candidates), dry_run)

    def delete_project(self, project_id: str, *, reason: str) -> DeletionReceipt:
        """Delete product visibility by tombstone; immutable history and CAS remain."""
        if not isinstance(reason, str) or not reason.strip():
            raise ValueError("deletion reason must be non-empty")
        with self.database.immediate() as connection:
            row = connection.execute(
                "SELECT state FROM projects WHERE project_id=?", (project_id,)
            ).fetchone()
            if row is None:
                raise BackupValidationError("project does not exist")
            connection.execute(
                "UPDATE projects SET state='tombstoned' WHERE project_id=?", (project_id,)
            )
        return DeletionReceipt(project_id, "tombstoned", reason)
