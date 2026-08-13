from __future__ import annotations

from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
RUNTIME = ROOT / "docs" / "runtime-operations.md"
ARCHITECTURE = ROOT / "docs" / "architecture.md"
CREDENTIAL = ROOT / "docs" / "incidents" / "credential-exposure.md"
CUSTODY = ROOT / "docs" / "incidents" / "custody-corruption.md"


@pytest.mark.parametrize(
    "phrase",
    (
        "not-ready",
        "DB busy",
        "disk full",
        "timeout/escape suspicion",
        "expired lease",
        "stuck committing",
        "corrupt or missing blob",
        "migration failure",
        "outbox lag",
        "backup failure",
        "dependency revocation",
        "browser asset mismatch",
        "fabrication_release=false",
        "machine_actuation=false",
    ),
)
def test_runtime_runbook_covers_required_incidents_and_safety_truths(phrase: str) -> None:
    content = RUNTIME.read_text(encoding="utf-8")
    assert phrase.casefold() in content.casefold()
    assert "```" in content
    assert "if " in content.casefold()


def test_runtime_health_detail_uses_kernel_derived_local_authority() -> None:
    content = RUNTIME.read_text(encoding="utf-8")
    assert "LocalDaemonHealthAdapter.open(" in content
    assert "socket.socketpair()" in content
    assert "os.getuid()" in content
    assert 'adapter.handle(server, "/health/detail")' in content
    assert "detail(authorized=True)" not in content


def test_backup_restore_operations_and_architecture_match_implemented_custody() -> None:
    runtime = RUNTIME.read_text(encoding="utf-8")
    architecture = ARCHITECTURE.read_text(encoding="utf-8")

    assert "Backup/restore is not yet implemented" not in runtime
    for phrase in (
        "PitonApplicationService.backup_project",
        "PitonApplicationService.restore_project",
        "trusted_identity",
        "empty destination",
        "fabrication_release=false",
        "machine_actuation=false",
    ):
        assert phrase in runtime
    for phrase in (
        "canonical JSON metadata",
        "immutable CAS payloads",
        "authenticated `BackupIdentity`",
        "tombstone",
        "unreferenced CAS",
    ):
        assert phrase in architecture


def test_credential_exposure_runbook_never_requests_secret_rendering() -> None:
    content = CREDENTIAL.read_text(encoding="utf-8").casefold()
    for phrase in (
        "stop the affected worker",
        "rotate",
        "revoke",
        "scrub retained renderings",
        "reference-only",
        "never reproduce",
    ):
        assert phrase in content
    for forbidden in ("printenv", "env |", "cat $", "echo $"):
        assert forbidden not in content


def test_custody_corruption_runbook_fails_closed_without_rollback_mutation() -> None:
    content = CUSTODY.read_text(encoding="utf-8").casefold()
    for phrase in (
        "stop writes",
        "preserve diagnostics",
        "quarantine",
        "restore-forward",
        "never replace last-good",
        "fabrication_release=false",
        "machine_actuation=false",
    ):
        assert phrase in content
    assert "nearest" in content and "forbidden" in content
