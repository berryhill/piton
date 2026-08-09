from __future__ import annotations

import hashlib
import sqlite3
import threading
from pathlib import Path

import pytest

from piton.storage.db import (
    Database,
    MigrationError,
    TransactionOwnershipError,
    load_migrations,
)


MINIMAL_MIGRATION = b"CREATE TABLE example(id INTEGER PRIMARY KEY) STRICT;\n"


def write_migration(directory: Path, name: str, body: bytes = MINIMAL_MIGRATION) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    (directory / name).write_bytes(body)


def test_fresh_database_applies_and_records_exact_migrations(tmp_path: Path) -> None:
    database_path = tmp_path / "piton.sqlite3"
    database = Database(database_path)
    migrations = load_migrations()

    assert database.migrate() == len(migrations)
    assert database.schema_version() == migrations[-1].version

    with database.read() as connection:
        rows = connection.execute(
            "SELECT version, digest FROM schema_migrations ORDER BY version"
        ).fetchall()
    assert [tuple(row) for row in rows] == [
        (migration.version, migration.digest) for migration in migrations
    ]
    assert database.integrity_check() == ()


def test_current_database_is_idempotent(tmp_path: Path) -> None:
    database = Database(tmp_path / "piton.sqlite3")
    database.migrate()
    before = (database.schema_version(), database.schema_fingerprint())

    assert database.migrate() == 0
    assert (database.schema_version(), database.schema_fingerprint()) == before


@pytest.mark.parametrize(
    "names",
    [
        ("0001_first.sql", "0001_duplicate.sql"),
        ("0001_first.sql", "0003_gap.sql"),
        ("0000_invalid.sql",),
        ("invalid.sql",),
    ],
)
def test_invalid_migration_declarations_fail_before_database_creation(
    tmp_path: Path, names: tuple[str, ...]
) -> None:
    migration_dir = tmp_path / "migrations"
    for name in names:
        write_migration(migration_dir, name)
    database_path = tmp_path / "piton.sqlite3"

    with pytest.raises(MigrationError):
        Database(database_path, migrations_path=migration_dir).migrate()

    assert not database_path.exists()


def test_tampered_applied_digest_and_newer_database_fail_closed(tmp_path: Path) -> None:
    database_path = tmp_path / "piton.sqlite3"
    database = Database(database_path)
    database.migrate()

    with sqlite3.connect(database_path) as connection:
        connection.execute(
            "UPDATE schema_migrations SET digest = ? WHERE version = 1",
            ("0" * 64,),
        )
    with pytest.raises(MigrationError, match="digest"):
        database.migrate()

    database_path.unlink()
    database.migrate()
    future_version = load_migrations()[-1].version + 1
    with sqlite3.connect(database_path) as connection:
        connection.execute(
            "INSERT INTO schema_migrations(version, digest, applied_at) VALUES(?, ?, ?)",
            (future_version, hashlib.sha256(b"future").hexdigest(), "2026-01-01T00:00:00Z"),
        )
    with pytest.raises(MigrationError, match="newer|unsupported"):
        database.migrate()


def test_failed_migration_rolls_back_schema_and_version(tmp_path: Path) -> None:
    migration_dir = tmp_path / "migrations"
    write_migration(
        migration_dir,
        "0001_broken.sql",
        b"CREATE TABLE transient(value TEXT) STRICT;\n"
        b"INSERT INTO missing_table(value) VALUES ('no');\n",
    )
    database = Database(tmp_path / "piton.sqlite3", migrations_path=migration_dir)

    with pytest.raises(sqlite3.OperationalError):
        database.migrate()

    with database.read() as connection:
        names = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
    assert "transient" not in names
    assert "schema_migrations" not in names


def test_immediate_commits_once_and_rolls_back_every_exception(tmp_path: Path) -> None:
    database = Database(tmp_path / "piton.sqlite3")
    database.migrate()

    with database.immediate() as connection:
        connection.execute(
            "INSERT INTO projects(project_id, display_name, format_version, state, created_at) "
            "VALUES('project_one', 'One', 1, 'active', '2026-01-01T00:00:00Z')"
        )

    with pytest.raises(RuntimeError, match="abort"):
        with database.immediate() as connection:
            connection.execute(
                "INSERT INTO projects(project_id, display_name, format_version, state, created_at) "
                "VALUES('project_two', 'Two', 1, 'active', '2026-01-01T00:00:00Z')"
            )
            raise RuntimeError("abort")

    with database.read() as connection:
        ids = [row[0] for row in connection.execute("SELECT project_id FROM projects")]
    assert ids == ["project_one"]


def test_immediate_rejects_nested_and_cross_thread_ownership(tmp_path: Path) -> None:
    database = Database(tmp_path / "piton.sqlite3")
    database.migrate()

    with database.immediate():
        with pytest.raises(TransactionOwnershipError):
            with database.immediate():
                pass

    errors: list[BaseException] = []

    def use_from_other_thread() -> None:
        try:
            with database.immediate():
                pass
        except BaseException as error:
            errors.append(error)

    thread = threading.Thread(target=use_from_other_thread)
    thread.start()
    thread.join()
    assert len(errors) == 1
    assert isinstance(errors[0], TransactionOwnershipError)


def test_caller_cannot_commit_or_rollback_owned_transaction(tmp_path: Path) -> None:
    database = Database(tmp_path / "piton.sqlite3")
    database.migrate()

    for index, transaction_control in enumerate(
        ("COMMIT", "ROLLBACK", "SAVEPOINT caller_owned")
    ):
        with pytest.raises(sqlite3.DatabaseError):
            with database.immediate() as connection:
                connection.execute(
                    "INSERT INTO projects(project_id, display_name, format_version, state, created_at) "
                    "VALUES(?, 'No escape', 1, 'active', '2026-01-01T00:00:00Z')",
                    (f"project_{index}",),
                )
                connection.execute(transaction_control)

    with database.read() as connection:
        assert connection.execute("SELECT count(*) FROM projects").fetchone()[0] == 0


def test_connections_enforce_required_pragmas_and_foreign_keys(tmp_path: Path) -> None:
    database = Database(tmp_path / "piton.sqlite3", busy_timeout_ms=2345)
    database.migrate()

    with database.read() as connection:
        assert connection.execute("PRAGMA foreign_keys").fetchone()[0] == 1
        assert connection.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
        assert connection.execute("PRAGMA synchronous").fetchone()[0] == 2
        assert connection.execute("PRAGMA trusted_schema").fetchone()[0] == 0
        assert connection.execute("PRAGMA busy_timeout").fetchone()[0] == 2345
        assert connection.execute("PRAGMA query_only").fetchone()[0] == 1

    with pytest.raises(sqlite3.IntegrityError):
        with database.immediate() as connection:
            connection.execute(
                "INSERT INTO design_revisions(revision_id, project_id, manifest_digest, "
                "source_manifest_digest, authority_profile, created_at) "
                "VALUES('rev_invalid', 'missing', 'a', 'b', 'source-native/v0', 'now')"
            )
