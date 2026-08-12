from __future__ import annotations

import os
import socket
import sqlite3
from pathlib import Path

import pytest

from piton.health import HealthDetail, LocalHealthService
from piton.service.daemon import CommandAdmissionError, LocalDaemonHealthAdapter
from piton.storage.blobs import BlobStore
from piton.storage.db import Database


def open_health(root: Path) -> LocalHealthService:
    database = Database(root / ".piton" / "piton.sqlite3")
    database.migrate()
    return LocalHealthService(database, BlobStore(root))


def authorized_detail(health: LocalHealthService) -> HealthDetail:
    server_socket, client_socket = socket.socketpair()
    try:
        adapter = LocalDaemonHealthAdapter(
            health, detail_principal_ids_by_uid={os.getuid(): "operator_local"}
        )
        detail = adapter.handle(server_socket, "/health/detail")
        assert isinstance(detail, HealthDetail)
        return detail
    finally:
        server_socket.close()
        client_socket.close()


def test_liveness_and_readiness_are_local_sanitized_and_non_authoritative(
    tmp_path: Path,
) -> None:
    health = open_health(tmp_path)

    assert health.live() == {"status": "live"}
    assert health.ready() == {"status": "ready"}
    assert not hasattr(health, "detail")


def test_daemon_health_routes_are_closed_and_detail_uses_peer_authority(
    tmp_path: Path,
) -> None:
    open_health(tmp_path)
    server_socket, client_socket = socket.socketpair()
    try:
        adapter = LocalDaemonHealthAdapter.open(
            tmp_path, detail_principal_ids_by_uid={os.getuid(): "operator_local"}
        )

        assert adapter.handle(server_socket, "/health/live") == {"status": "live"}
        assert adapter.handle(server_socket, "/health/ready") == {"status": "ready"}
        assert adapter.handle(server_socket, "/health/detail") == HealthDetail(
            status="ready", codes=()
        )
        detail = adapter.handle(server_socket, "/health/detail")
        assert isinstance(detail, HealthDetail)
        assert detail.review_state == "needs_human_review"
        assert detail.fabrication_release is False
        assert detail.machine_actuation is False
        with pytest.raises(TypeError):
            adapter.handle(server_socket, "/health/detail", detail_authorized=True)
        with pytest.raises(CommandAdmissionError, match="unsupported"):
            adapter.handle(server_socket, "/metrics")

        denied = LocalDaemonHealthAdapter.open(tmp_path, detail_principal_ids_by_uid={})
        with pytest.raises(PermissionError, match="not authorized"):
            denied.handle(server_socket, "/health/detail")
        assert denied.handle(server_socket, "/health/live") == {"status": "live"}
    finally:
        server_socket.close()
        client_socket.close()


def test_pending_migration_and_corrupt_database_are_not_ready_with_codes_only(
    tmp_path: Path,
) -> None:
    migration_dir = tmp_path / "migrations"
    migration_dir.mkdir()
    (migration_dir / "0001_first.sql").write_text(
        "CREATE TABLE schema_migrations("
        "version INTEGER PRIMARY KEY, digest TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL"
        ") STRICT;\n"
        "CREATE TABLE example(id INTEGER PRIMARY KEY) STRICT;\n",
        encoding="utf-8",
    )
    database = Database(tmp_path / "pending.sqlite3", migrations_path=migration_dir)
    database.migrate()
    (migration_dir / "0002_second.sql").write_text(
        "CREATE TABLE second(id INTEGER PRIMARY KEY) STRICT;\n", encoding="utf-8"
    )
    health = LocalHealthService(database, BlobStore(tmp_path / "pending-root"))

    assert health.ready() == {"status": "not_ready"}
    assert authorized_detail(health).codes == ("migrations_pending",)

    corrupt_root = tmp_path / "corrupt-root"
    corrupt = open_health(corrupt_root)
    database_path = corrupt_root / ".piton" / "piton.sqlite3"
    with sqlite3.connect(database_path) as connection:
        connection.execute(
            "UPDATE schema_migrations SET digest=? WHERE version=1", ("0" * 64,)
        )

    assert corrupt.ready() == {"status": "not_ready"}
    detail = authorized_detail(corrupt)
    assert detail.status == "not_ready"
    assert detail.codes == ("migration_invalid",)
    assert str(database_path) not in repr(detail)


def test_cas_failure_and_recovery_incomplete_state_block_readiness(
    tmp_path: Path,
) -> None:
    cas_root = tmp_path / "cas-root"
    cas_health = open_health(cas_root)
    cas_health._blobs.objects_root.rmdir()
    cas_health._blobs.objects_root.write_text("not a directory", encoding="utf-8")

    assert authorized_detail(cas_health).codes == ("cas_unavailable",)

    recovery_root = tmp_path / "recovery-root"
    recovery_health = open_health(recovery_root)
    staged = recovery_health._blobs.staging_root / "unfinished"
    staged.mkdir()
    (staged / "artifact.bin").write_bytes(b"incomplete")

    assert recovery_health.ready() == {"status": "not_ready"}
    assert authorized_detail(recovery_health).codes == ("recovery_incomplete",)
