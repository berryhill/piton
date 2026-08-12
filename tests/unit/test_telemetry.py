from __future__ import annotations

from types import MappingProxyType

import pytest

from piton.telemetry import Telemetry, TelemetryAdmissionError


PROJECT_HASH = "sha256:" + "a" * 64
ATTEMPT_ID = "00000000-0000-4000-8000-000000000001"


def test_allowlisted_events_produce_only_bounded_local_counters() -> None:
    telemetry = Telemetry()

    telemetry.event(
        "daemon.command",
        project_id_hash=PROJECT_HASH,
        attempt_id=None,
        outcome="succeeded",
        duration_ms=12,
    )
    telemetry.event(
        "worker.execution",
        project_id_hash=PROJECT_HASH,
        attempt_id=ATTEMPT_ID,
        outcome="failed",
        duration_ms=100,
        error_code="worker_failed",
    )

    snapshot = telemetry.snapshot_metrics()
    assert isinstance(snapshot, MappingProxyType)
    assert snapshot == {
        "events_total.daemon.command.succeeded.none": 1,
        "events_total.worker.execution.failed.worker_failed": 1,
        "duration_ms_total.daemon.command": 12,
        "duration_ms_count.daemon.command": 1,
        "duration_ms_total.worker.execution": 100,
        "duration_ms_count.worker.execution": 1,
    }
    assert PROJECT_HASH not in repr(snapshot)
    assert ATTEMPT_ID not in repr(snapshot)
    assert telemetry.export_available is False


@pytest.mark.parametrize(
    ("kwargs", "message"),
    [
        ({"event_type": "custom.label", "outcome": "succeeded"}, "event_type"),
        ({"event_type": "daemon.command", "outcome": "custom"}, "outcome"),
        (
            {
                "event_type": "daemon.command",
                "outcome": "failed",
                "error_code": "raw exception text",
            },
            "error_code",
        ),
        ({"event_type": "daemon.command", "outcome": "succeeded", "duration_ms": -1}, "duration_ms"),
        (
            {"event_type": "daemon.command", "outcome": "succeeded", "duration_ms": 3_600_001},
            "duration_ms",
        ),
        (
            {"event_type": "daemon.command", "outcome": "succeeded", "project_id_hash": "project_one"},
            "project_id_hash",
        ),
        (
            {"event_type": "worker.execution", "outcome": "succeeded", "attempt_id": "attempt_one"},
            "attempt_id",
        ),
    ],
)
def test_unknown_or_unbounded_telemetry_values_fail_closed(
    kwargs: dict[str, object], message: str
) -> None:
    telemetry = Telemetry()
    baseline = {"project_id_hash": None, "attempt_id": None, "duration_ms": None, "error_code": None}

    with pytest.raises(TelemetryAdmissionError, match=message):
        telemetry.event(**(baseline | kwargs))

    assert telemetry.snapshot_metrics() == {}


def test_event_signature_rejects_arbitrary_fields() -> None:
    telemetry = Telemetry()

    with pytest.raises(TypeError):
        telemetry.event(  # type: ignore[call-arg]
            "daemon.command",
            project_id_hash=None,
            attempt_id=None,
            outcome="succeeded",
            source="def build(): pass",
        )
