"""Sanitized process-local liveness, readiness, and authorized detail checks.

Health observations are operational facts only. They cannot mutate authored
state or imply review, approval, export, release, or machine actuation.
"""

from __future__ import annotations

import os
import sqlite3
from dataclasses import dataclass
from typing import Literal

from .assurance import DEFAULT_P4_ASSURANCE_POLICY
from .storage.blobs import BlobStore
from .storage.db import Database, MigrationError

_HEALTH_CODES = frozenset(
    (
        "cas_unavailable",
        "database_busy",
        "database_invalid",
        "migration_invalid",
        "migrations_pending",
        "policy_invalid",
        "recovery_incomplete",
    )
)


@dataclass(frozen=True, slots=True)
class HealthDetail:
    status: Literal["ready", "not_ready"]
    codes: tuple[str, ...]
    review_state: Literal["needs_human_review"] = "needs_human_review"
    fabrication_release: Literal[False] = False
    machine_actuation: Literal[False] = False

    def __post_init__(self) -> None:
        if self.status not in ("ready", "not_ready"):
            raise ValueError("unsupported health status")
        if tuple(sorted(set(self.codes))) != self.codes:
            raise ValueError("health codes must be unique and sorted")
        if any(code not in _HEALTH_CODES for code in self.codes):
            raise ValueError("health code is not allowlisted")
        if (self.status == "ready") != (not self.codes):
            raise ValueError("health status and codes disagree")
        if (
            self.review_state != "needs_human_review"
            or self.fabrication_release is not False
            or self.machine_actuation is not False
        ):
            raise ValueError("health detail violates root truths")


class LocalHealthService:
    """Run bounded local checks and disclose only source-declared status codes."""

    __slots__ = ("_database", "_blobs")

    def __init__(self, database: Database, blobs: BlobStore) -> None:
        if not isinstance(database, Database) or not isinstance(blobs, BlobStore):
            raise TypeError("trusted Database and BlobStore are required")
        self._database = database
        self._blobs = blobs

    def live(self) -> dict[str, str]:
        """Report that the local health handler can execute."""
        return {"status": "live"}

    def ready(self) -> dict[str, str]:
        """Return the unprivileged readiness projection without diagnostic detail."""
        status = self._evaluate().status
        return {"status": status}

    def _evaluate(self) -> HealthDetail:
        """Evaluate sanitized detail for the trusted local transport adapter."""
        codes: set[str] = set()
        self._check_database(codes)
        self._check_cas(codes)
        self._check_policy(codes)
        self._check_recovery(codes)
        ordered = tuple(sorted(codes))
        return HealthDetail(status="not_ready" if ordered else "ready", codes=ordered)

    def _check_database(self, codes: set[str]) -> None:
        try:
            problems = self._database.integrity_check()
        except MigrationError:
            codes.add("migration_invalid")
            return
        except sqlite3.OperationalError as error:
            code = getattr(error, "sqlite_errorcode", None)
            if code in (sqlite3.SQLITE_BUSY, sqlite3.SQLITE_LOCKED):
                codes.add("database_busy")
            else:
                codes.add("database_invalid")
            return
        except (sqlite3.DatabaseError, OSError):
            codes.add("database_invalid")
            return
        for problem in problems:
            if problem == "pending migrations":
                codes.add("migrations_pending")
            else:
                codes.add("database_invalid")

    def _check_cas(self, codes: set[str]) -> None:
        flags = os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        try:
            descriptor = os.open(self._blobs.objects_root, flags)
        except OSError:
            codes.add("cas_unavailable")
            return
        os.close(descriptor)

    @staticmethod
    def _check_policy(codes: set[str]) -> None:
        policy = DEFAULT_P4_ASSURANCE_POLICY
        if (
            policy.fabrication_release is not False
            or policy.machine_actuation is not False
            or not policy.requirements
        ):
            codes.add("policy_invalid")

    def _check_recovery(self, codes: set[str]) -> None:
        try:
            if any(self._blobs.staging_root.iterdir()):
                codes.add("recovery_incomplete")
            with self._database.read() as connection:
                tables = {
                    str(row[0])
                    for row in connection.execute(
                        "SELECT name FROM sqlite_master "
                        "WHERE type='table' AND name NOT LIKE 'sqlite_%'"
                    )
                }
                if "artifact_publications" in tables:
                    pending = connection.execute(
                        "SELECT 1 FROM artifact_publications WHERE state='committing' LIMIT 1"
                    ).fetchone()
                    if pending is not None:
                        codes.add("recovery_incomplete")
        except (sqlite3.DatabaseError, OSError):
            codes.add("recovery_incomplete")
