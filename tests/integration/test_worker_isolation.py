from __future__ import annotations

from piton.precision_worker_launch import sandbox_environment_evidence


def test_network_namespace_does_not_imply_credential_isolation() -> None:
    evidence = sandbox_environment_evidence(network_namespace_unshared=True)

    assert evidence["network_isolation_proven"] is False
    assert evidence["credential_isolation_proven"] is False


def test_worker_isolation_evidence_preserves_root_safety_truth() -> None:
    evidence = sandbox_environment_evidence(network_namespace_unshared=True)

    assert evidence["truth"] == {
        "fabrication_release": False,
        "machine_actuation": False,
        "review_state": "needs_human_review",
    }
