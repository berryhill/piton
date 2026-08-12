"""Closed, in-memory telemetry for local operational diagnosis.

Telemetry contains bounded counters only. It has no exporter and never retains
identifiers, source, labels, paths, exception text, environment data, or bytes.
"""

from __future__ import annotations

import re
from collections import Counter
from types import MappingProxyType
from typing import Mapping


class TelemetryAdmissionError(ValueError):
    """An event does not match the source-declared telemetry vocabulary."""


_EVENT_TYPES = frozenset(
    (
        "daemon.command",
        "daemon.readiness",
        "worker.execution",
        "evidence.publication",
        "outbox.delivery",
    )
)
_OUTCOMES = frozenset(("succeeded", "failed", "blocked", "timed_out"))
_ERROR_CODES = frozenset(
    (
        "admission_denied",
        "cas_unavailable",
        "database_busy",
        "database_invalid",
        "lease_expired",
        "migration_invalid",
        "migrations_pending",
        "outbox_lagging",
        "recovery_incomplete",
        "worker_failed",
        "worker_timeout",
    )
)
_PROJECT_HASH = re.compile(r"^sha256:[0-9a-f]{64}$")
_ATTEMPT_ID = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
)
_MAX_DURATION_MS = 3_600_000


class Telemetry:
    """Store source-allowlisted process-local counters; remote export is absent."""

    __slots__ = ("__metrics",)

    export_available = False

    def __init__(self) -> None:
        self.__metrics: Counter[str] = Counter()

    def event(
        self,
        event_type: str,
        *,
        project_id_hash: str | None,
        attempt_id: str | None,
        outcome: str,
        duration_ms: int | None = None,
        error_code: str | None = None,
    ) -> None:
        """Validate one closed event and retain only aggregate bounded counters."""
        if type(event_type) is not str or event_type not in _EVENT_TYPES:
            raise TelemetryAdmissionError("event_type is not allowlisted")
        if type(outcome) is not str or outcome not in _OUTCOMES:
            raise TelemetryAdmissionError("outcome is not allowlisted")
        if project_id_hash is not None and (
            type(project_id_hash) is not str or _PROJECT_HASH.fullmatch(project_id_hash) is None
        ):
            raise TelemetryAdmissionError("project_id_hash is not a canonical hash")
        if attempt_id is not None and (
            type(attempt_id) is not str or _ATTEMPT_ID.fullmatch(attempt_id) is None
        ):
            raise TelemetryAdmissionError("attempt_id is not a canonical UUID")
        if duration_ms is not None and (
            type(duration_ms) is not int or not 0 <= duration_ms <= _MAX_DURATION_MS
        ):
            raise TelemetryAdmissionError("duration_ms is outside its declared bounds")
        if error_code is not None and (
            type(error_code) is not str or error_code not in _ERROR_CODES
        ):
            raise TelemetryAdmissionError("error_code is not allowlisted")
        if outcome == "succeeded" and error_code is not None:
            raise TelemetryAdmissionError("error_code is forbidden for a successful event")
        if outcome != "succeeded" and error_code is None:
            raise TelemetryAdmissionError("error_code is required for an unsuccessful event")

        error_bucket = error_code or "none"
        self.__metrics[f"events_total.{event_type}.{outcome}.{error_bucket}"] += 1
        if duration_ms is not None:
            self.__metrics[f"duration_ms_total.{event_type}"] += duration_ms
            self.__metrics[f"duration_ms_count.{event_type}"] += 1

    def snapshot_metrics(self) -> Mapping[str, int | float]:
        """Return an immutable sorted snapshot containing no event identifiers."""
        return MappingProxyType(dict(sorted(self.__metrics.items())))
