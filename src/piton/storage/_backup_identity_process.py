"""Process-isolated backup receipt signing bootstrap.

The one-shot bootstrap is consumed while the trusted custody composition root is
imported.  It removes itself from this module before returning, so importing
callers cannot mint authority or invoke a generic signing endpoint.  The
Ed25519 private key and signing operation remain inside the helper process.
"""

from __future__ import annotations

import atexit
import hashlib
import inspect
import json
import multiprocessing
import sys
import threading
from multiprocessing.connection import Connection
from pathlib import Path
from typing import Any, Callable

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)


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


def _take_backup_identity_authority() -> tuple[
    Ed25519PublicKey,
    Callable[[Path, str], tuple[str, str]],
    Callable[[object], None],
]:
    """Consume the process authority exactly once during custody composition."""
    module = sys.modules[__name__]
    delattr(module, "_take_backup_identity_authority")

    context = multiprocessing.get_context("fork")
    parent_connection, child_connection = context.Pipe()
    process = context.Process(target=_serve, args=(child_connection,), daemon=True)
    process.start()
    child_connection.close()
    verifier = Ed25519PublicKey.from_public_bytes(parent_connection.recv_bytes())
    lock = threading.Lock()
    authorized_backup_code: object | None = None

    def authorize_backup_caller(code: object) -> None:
        """Bind the channel once to the exact custody implementation code object."""
        nonlocal authorized_backup_code
        if authorized_backup_code is not None:
            raise RuntimeError("backup caller is already authorized")
        authorized_backup_code = code

    def sign_completed_manifest(manifest_path: Path, project_id: str) -> tuple[str, str]:
        frame = inspect.currentframe()
        caller = None if frame is None else frame.f_back
        if caller is None or caller.f_code is not authorized_backup_code:
            raise PermissionError("backup signing is restricted to the custody backup operation")
        with lock:
            if not process.is_alive():
                raise RuntimeError("backup identity helper is unavailable")
            parent_connection.send((str(manifest_path), project_id))
            manifest_digest, signature, error = parent_connection.recv()
        if error is not None:
            raise RuntimeError(error)
        return manifest_digest, signature

    def shutdown() -> None:
        if process.is_alive():
            try:
                parent_connection.send(None)
            except (BrokenPipeError, EOFError, OSError):
                pass
            process.join(timeout=1)
            if process.is_alive():
                process.terminate()

    atexit.register(shutdown)
    return verifier, sign_completed_manifest, authorize_backup_caller
