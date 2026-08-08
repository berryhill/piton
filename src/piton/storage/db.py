"""Strict SQLite migrations and daemon-owned write transactions."""

from __future__ import annotations

import hashlib
import re
import sqlite3
import threading
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Iterator, Sequence


_MIGRATION_NAME = re.compile(r"^(?P<version>[0-9]{4})_[a-z0-9][a-z0-9_]*\.sql$")
_FORBIDDEN_STATEMENT = re.compile(
    r"^(?:BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE|ATTACH|DETACH|VACUUM)\b",
    re.IGNORECASE,
)
_COMMENT_PREFIX = re.compile(r"\A(?:\s+|--[^\n]*(?:\n|$)|/\*.*?\*/)*", re.DOTALL)


class MigrationError(RuntimeError):
    """The declared or applied migration chain is not trustworthy."""


class TransactionOwnershipError(RuntimeError):
    """A write transaction escaped the Database owner's transaction scope."""


@dataclass(frozen=True, slots=True)
class Migration:
    version: int
    name: str
    digest: str
    sql: str


def _default_migrations_path() -> Path:
    return Path(__file__).with_name("migrations")


def load_migrations(path: Path | None = None) -> tuple[Migration, ...]:
    """Load a positive, unique, contiguous migration chain without touching a DB."""
    migrations_path = path or _default_migrations_path()
    if not migrations_path.is_dir():
        raise MigrationError(f"migration directory does not exist: {migrations_path}")

    migrations: list[Migration] = []
    for candidate in sorted(migrations_path.iterdir(), key=lambda item: item.name):
        if not candidate.is_file():
            continue
        if candidate.suffix == ".sql":
            match = _MIGRATION_NAME.fullmatch(candidate.name)
            if match is None:
                raise MigrationError(f"invalid migration filename: {candidate.name}")
            version = int(match.group("version"))
            if version <= 0:
                raise MigrationError(f"migration version must be positive: {candidate.name}")
            raw = candidate.read_bytes()
            try:
                sql = raw.decode("utf-8", errors="strict")
            except UnicodeDecodeError as error:
                raise MigrationError(f"migration is not UTF-8: {candidate.name}") from error
            if not sql.strip():
                raise MigrationError(f"migration is empty: {candidate.name}")
            migrations.append(
                Migration(
                    version=version,
                    name=candidate.name,
                    digest=hashlib.sha256(raw).hexdigest(),
                    sql=sql,
                )
            )

    if not migrations:
        raise MigrationError("no migrations declared")
    versions = [migration.version for migration in migrations]
    expected = list(range(1, len(migrations) + 1))
    if versions != expected:
        raise MigrationError(
            f"migration versions must be unique and contiguous from 1; "
            f"declared={versions}, expected={expected}"
        )
    return tuple(migrations)


def _sql_statements(sql: str, *, migration_name: str) -> Iterator[str]:
    pending = ""
    for character in sql:
        pending += character
        if character == ";" and sqlite3.complete_statement(pending):
            statement = pending.strip()
            pending = ""
            prefix_removed = _COMMENT_PREFIX.sub("", statement)
            if not prefix_removed:
                continue
            if _FORBIDDEN_STATEMENT.match(prefix_removed):
                keyword = prefix_removed.split(None, 1)[0]
                raise MigrationError(
                    f"migration {migration_name} cannot own transaction/control statement {keyword}"
                )
            yield statement
    if pending.strip():
        raise MigrationError(f"migration {migration_name} has an incomplete SQL statement")


class Database:
    """Own configuration, migrations, and all local-daemon write transactions."""

    def __init__(
        self,
        path: Path | str,
        *,
        migrations_path: Path | None = None,
        busy_timeout_ms: int = 5_000,
    ) -> None:
        if isinstance(busy_timeout_ms, bool) or not isinstance(busy_timeout_ms, int):
            raise ValueError("busy_timeout_ms must be an integer")
        if not 1 <= busy_timeout_ms <= 60_000:
            raise ValueError("busy_timeout_ms must be between 1 and 60000")
        self.path = Path(path)
        self.migrations_path = migrations_path
        self.busy_timeout_ms = busy_timeout_ms
        self._owner_thread = threading.get_ident()
        self._transaction_active = False
        self._ownership_lock = threading.Lock()

    def _assert_owner(self) -> None:
        if threading.get_ident() != self._owner_thread:
            raise TransactionOwnershipError(
                "only the Database-creating daemon thread may own writes"
            )

    def _connect(self, *, query_only: bool = False) -> sqlite3.Connection:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(
            self.path,
            timeout=self.busy_timeout_ms / 1000,
            isolation_level=None,
        )
        try:
            connection.row_factory = sqlite3.Row
            connection.execute("PRAGMA foreign_keys=ON")
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("PRAGMA synchronous=FULL")
            connection.execute("PRAGMA trusted_schema=OFF")
            connection.execute(f"PRAGMA busy_timeout={self.busy_timeout_ms}")
            if query_only:
                connection.execute("PRAGMA query_only=ON")
            return connection
        except BaseException:
            connection.close()
            raise

    @contextmanager
    def read(self) -> Iterator[sqlite3.Connection]:
        """Open a configured query-only connection."""
        connection = self._connect(query_only=True)
        try:
            yield connection
        finally:
            connection.close()

    @contextmanager
    def immediate(self) -> Iterator[sqlite3.Connection]:
        """Own exactly one BEGIN IMMEDIATE, rolling back every failed scope."""
        self._assert_owner()
        with self._ownership_lock:
            if self._transaction_active:
                raise TransactionOwnershipError("nested write transaction is forbidden")
            self._transaction_active = True
        connection: sqlite3.Connection | None = None
        allow_transaction_control = False

        def own_transaction_control(
            action: int,
            _argument_one: str | None,
            _argument_two: str | None,
            _database_name: str | None,
            _trigger_name: str | None,
        ) -> int:
            if action in (sqlite3.SQLITE_TRANSACTION, sqlite3.SQLITE_SAVEPOINT):
                return sqlite3.SQLITE_OK if allow_transaction_control else sqlite3.SQLITE_DENY
            return sqlite3.SQLITE_OK

        try:
            connection = self._connect()
            connection.execute("BEGIN IMMEDIATE")
            connection.set_authorizer(own_transaction_control)
            try:
                yield connection
            except BaseException:
                if connection.in_transaction:
                    allow_transaction_control = True
                    connection.rollback()
                raise
            else:
                if not connection.in_transaction:
                    raise TransactionOwnershipError(
                        "transaction was ended outside Database.immediate()"
                    )
                allow_transaction_control = True
                connection.commit()
        finally:
            if connection is not None:
                if connection.in_transaction:
                    allow_transaction_control = True
                    connection.rollback()
                connection.close()
            with self._ownership_lock:
                self._transaction_active = False

    @staticmethod
    def _table_names(connection: sqlite3.Connection) -> set[str]:
        return {
            str(row[0])
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            )
        }

    @staticmethod
    def _applied_migrations(connection: sqlite3.Connection) -> tuple[tuple[int, str], ...]:
        try:
            rows = connection.execute(
                "SELECT version, digest FROM schema_migrations ORDER BY version"
            ).fetchall()
        except sqlite3.DatabaseError as error:
            raise MigrationError("schema_migrations cannot be read") from error
        applied: list[tuple[int, str]] = []
        for row in rows:
            version, digest = row
            if (
                isinstance(version, bool)
                or not isinstance(version, int)
                or version <= 0
                or not isinstance(digest, str)
                or re.fullmatch(r"[0-9a-f]{64}", digest) is None
            ):
                raise MigrationError("schema_migrations contains invalid version or digest")
            applied.append((version, digest))
        versions = [version for version, _ in applied]
        if versions != list(range(1, len(applied) + 1)):
            raise MigrationError("applied migration versions are not contiguous from 1")
        return tuple(applied)

    @staticmethod
    def _validate_applied(
        applied: Sequence[tuple[int, str]], declared: Sequence[Migration]
    ) -> None:
        if len(applied) > len(declared):
            raise MigrationError(
                "database schema is newer than this binary and is unsupported"
            )
        for index, (version, digest) in enumerate(applied):
            migration = declared[index]
            if version != migration.version:
                raise MigrationError("applied migration order does not match declarations")
            if digest != migration.digest:
                raise MigrationError(
                    f"applied migration digest mismatch at version {version}"
                )

    def migrate(self) -> int:
        """Apply every pending migration atomically, preserving a verified prefix."""
        self._assert_owner()
        declared = load_migrations(self.migrations_path)
        applied_count = 0
        while True:
            with self.immediate() as connection:
                tables = self._table_names(connection)
                if "schema_migrations" not in tables:
                    if tables:
                        raise MigrationError(
                            "non-empty database has no schema_migrations authority"
                        )
                    applied: tuple[tuple[int, str], ...] = ()
                else:
                    applied = self._applied_migrations(connection)
                self._validate_applied(applied, declared)
                if len(applied) == len(declared):
                    return applied_count

                migration = declared[len(applied)]
                for statement in _sql_statements(
                    migration.sql, migration_name=migration.name
                ):
                    connection.execute(statement)
                connection.execute(
                    "INSERT INTO schema_migrations(version, digest, applied_at) "
                    "VALUES(?, ?, ?)",
                    (
                        migration.version,
                        migration.digest,
                        datetime.now(UTC).isoformat(timespec="microseconds").replace(
                            "+00:00", "Z"
                        ),
                    ),
                )
            applied_count += 1

    def schema_version(self) -> int:
        with self.read() as connection:
            tables = self._table_names(connection)
            if "schema_migrations" not in tables:
                return 0
            applied = self._applied_migrations(connection)
        return applied[-1][0] if applied else 0

    def schema_fingerprint(self) -> str:
        """Return a deterministic diagnostic fingerprint of schema and migration rows."""
        with self.read() as connection:
            schema = connection.execute(
                "SELECT type, name, tbl_name, sql FROM sqlite_master "
                "WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name"
            ).fetchall()
            applied = (
                self._applied_migrations(connection)
                if "schema_migrations" in self._table_names(connection)
                else ()
            )
        payload = repr(([tuple(row) for row in schema], applied)).encode("utf-8")
        return hashlib.sha256(payload).hexdigest()

    def integrity_check(self) -> tuple[str, ...]:
        """Return integrity/FK problems; an empty tuple is healthy."""
        problems: list[str] = []
        with self.read() as connection:
            for row in connection.execute("PRAGMA integrity_check"):
                if row[0] != "ok":
                    problems.append(str(row[0]))
            for row in connection.execute("PRAGMA foreign_key_check"):
                problems.append("foreign_key_check:" + repr(tuple(row)))
            tables = self._table_names(connection)
            if "schema_migrations" not in tables:
                problems.append("schema_migrations is missing")
            else:
                declared = load_migrations(self.migrations_path)
                applied = self._applied_migrations(connection)
                self._validate_applied(applied, declared)
                if len(applied) != len(declared):
                    problems.append("pending migrations")
        return tuple(problems)
