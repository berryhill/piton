"""Process-isolated backup receipt signing.

The Ed25519 private key exists only in the helper process.  The parent side can
request a signature for bytes read back from a completed backup manifest; it
cannot obtain a key object or submit a bare digest/project pair.
"""

from __future__ import annotations

import atexit
import hashlib
import json
import multiprocessing
import threading
from multiprocessing.connection import Connection
from pathlib import Path
from typing import Any

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)

_CAPABILITY_PROOF = object()


class BackupSigningCapability:
    """Opaque daemon-issued authority to request a completed-backup receipt."""

    __slots__ = ("_proof",)

    def __new__(cls, proof: object = None) -> "BackupSigningCapability":
        if proof is not _CAPABILITY_PROOF:
            raise PermissionError("backup signing capability is server-issued only")
        instance = super().__new__(cls)
        instance._proof = proof
        return instance


def _issue_server_backup_capability() -> BackupSigningCapability:
    """Issue authority only to the trusted daemon composition root."""
    return BackupSigningCapability(_CAPABILITY_PROOF)


def _require_capability(capability: object) -> None:
    if (
        type(capability) is not BackupSigningCapability
        or getattr(capability, "_proof", None) is not _CAPABILITY_PROOF
    ):
        raise PermissionError("server-issued backup capability is required")


def _canonical(value: Any) -> bytes:
    return json.dumps(
        value, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")


def _identity_body(manifest_digest: str, project_id: str) -> bytes:
    return _canonical(
        {
            "domain": "piton.backup-identity.v1",
            "manifest_digest": manifest_digest,
            "project_id": project_id,
        }
    )


def _serve(connection: Connection) -> None:
    signer = Ed25519PrivateKey.generate()
    public_bytes = signer.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    connection.send_bytes(public_bytes)
    try:
        while True:
            request = connection.recv()
            if request is None:
                return
            manifest_path_text, expected_project_id = request
            try:
                manifest_path = Path(manifest_path_text)
                if manifest_path.name != "manifest.json" or manifest_path.is_symlink():
                    raise ValueError("manifest path is not a completed backup manifest")
                manifest_bytes = manifest_path.read_bytes()
                manifest = json.loads(manifest_bytes)
                if _canonical(manifest) != manifest_bytes:
                    raise ValueError("manifest is not canonical JSON")
                project = manifest.get("project")
                if not isinstance(project, dict) or project.get("project_id") != expected_project_id:
                    raise ValueError("manifest project identity does not match")
                if manifest.get("schema") != "piton.project-backup.v1" or manifest.get("schema_version") != 1:
                    raise ValueError("manifest schema is invalid")
                if manifest.get("safety") != {
                    "review_state": "needs_human_review",
                    "fabrication_release": False,
                    "machine_actuation": False,
                }:
                    raise ValueError("manifest safety state is invalid")
                manifest_digest = "sha256:" + hashlib.sha256(manifest_bytes).hexdigest()
                signature = signer.sign(
                    _identity_body(manifest_digest, expected_project_id)
                ).hex()
                connection.send((manifest_digest, signature, None))
            except (OSError, TypeError, ValueError, json.JSONDecodeError) as error:
                connection.send((None, None, str(error)))
    finally:
        connection.close()


_context = multiprocessing.get_context("fork")
_parent_connection, _child_connection = _context.Pipe()
_process = _context.Process(target=_serve, args=(_child_connection,), daemon=True)
_process.start()
_child_connection.close()
_public_key = Ed25519PublicKey.from_public_bytes(_parent_connection.recv_bytes())
_lock = threading.Lock()


def public_key() -> Ed25519PublicKey:
    """Return only the helper's non-signing verification key."""
    return _public_key


def _sign_completed_manifest(
    manifest_path: Path,
    project_id: str,
    *,
    capability: object,
) -> tuple[str, str]:
    """Sign bytes read independently by the helper from a completed backup."""
    _require_capability(capability)
    with _lock:
        if not _process.is_alive():
            raise RuntimeError("backup identity helper is unavailable")
        _parent_connection.send((str(manifest_path), project_id))
        manifest_digest, signature, error = _parent_connection.recv()
    if error is not None:
        raise RuntimeError(error)
    return manifest_digest, signature


def _shutdown() -> None:
    if _process.is_alive():
        try:
            _parent_connection.send(None)
        except (BrokenPipeError, EOFError, OSError):
            pass
        _process.join(timeout=1)
        if _process.is_alive():
            _process.terminate()


atexit.register(_shutdown)
