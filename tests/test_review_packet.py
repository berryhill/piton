"""Acceptance tests for immutable review packets and the powerless local viewer."""
from __future__ import annotations

import json
import shutil
from dataclasses import replace
from pathlib import Path

import pytest

from piton import review_packet as review_packet_module
from piton.review_packet import ReviewPacketError, build_review_packet, validate_review_packet
from tests.integration.test_evidence_closure import prepared


EXPECTED_ROLES = {
    "exact_brep",
    "step",
    "inspection_receipt",
    "review_glb",
    "review_selection_map",
    "review_glb_receipt",
    "review_selection_map_receipt",
}


def _closed(tmp_path: Path):
    service, _, _ = prepared(tmp_path / "project")
    request = service.issue_precision_worker_request("project_one", "attempt_one")
    result = service.run_precision_worker(request)
    closure = service.close_precision_worker_evidence(request, result)
    root = tmp_path / "project" / ".piton" / "build-attempts" / "project_one" / "attempt_one"
    return service, closure, result, root


def test_packet_is_exact_deterministic_and_contains_a_local_viewer(tmp_path: Path) -> None:
    service, closure, result, root = _closed(tmp_path)

    first = service.build_precision_review_packet(
        "project_one", closure.closure_digest, result, tmp_path / "packet-a"
    )
    second = build_review_packet(closure, result, root, tmp_path / "packet-b")

    assert first.canonical_bytes == second.canonical_bytes
    assert first.packet_digest == second.packet_digest
    assert first.project_id == "project_one"
    assert first.revision_id == result.revision_id
    assert first.build_attempt_id == "attempt_one"
    assert first.worker_pin == result.worker_pin
    assert first.evidence_closure_digest == closure.closure_digest
    assert first.worker_result_digest == result.result_digest
    assert first.declaration_digest == closure.declaration_digest
    assert (first.generation, first.fence, first.lease_id) == (2, 5, "lease_one")
    assert set(first.artifacts) == EXPECTED_ROLES
    assert all(item["digest"] == result.artifacts[role].digest for role, item in first.artifacts.items())
    assert all(item["byte_length"] == result.artifacts[role].byte_length for role, item in first.artifacts.items())
    assert first.truth == {
        "review_state": "needs_human_review",
        "fabrication_release": False,
        "machine_actuation": False,
        "release_state": "unreleased",
        "channel_transition": False,
    }

    for relative in ("review-packet.json", "semantic-selection-map.json", "index.html", "viewer.js", "viewer.css", "THIRD_PARTY_NOTICES.txt"):
        assert (tmp_path / "packet-a" / relative).is_file()
    assert (tmp_path / "packet-a" / "artifacts" / "review.glb").read_bytes() == (
        root / result.artifacts["review_glb"].relative_path
    ).read_bytes()

    readback = validate_review_packet(tmp_path / "packet-a")
    assert readback.canonical_bytes == first.canonical_bytes
    semantic = json.loads((tmp_path / "packet-a" / "semantic-selection-map.json").read_bytes())
    assert semantic["glb_digest"] == result.artifacts["review_glb"].digest
    assert semantic["revision_id"] == result.revision_id
    assert semantic["build_attempt_id"] == result.attempt_id
    assert semantic["identity_scope"] == "artifact-local; no durable topology identity; no nearest fallback"
    assert semantic["bindings"][0]["source_part_id"] == "part:l_bracket"
    assert semantic["bindings"][0]["occurrence_id"] == "occurrence:l_bracket:1"
    assert semantic["bindings"][0]["zones"]


def test_packet_recomputes_bytes_and_fails_closed_without_replacing_last_good(tmp_path: Path) -> None:
    _, closure, result, root = _closed(tmp_path)
    accepted = build_review_packet(closure, result, root, tmp_path / "accepted")
    accepted_bytes = (tmp_path / "accepted" / "review-packet.json").read_bytes()

    tampered_root = tmp_path / "tampered-attempt"
    shutil.copytree(root, tampered_root)
    glb = tampered_root / result.artifacts["review_glb"].relative_path
    glb.write_bytes(glb.read_bytes() + b"tamper")
    with pytest.raises(ReviewPacketError, match="digest or byte length"):
        build_review_packet(closure, result, tampered_root, tmp_path / "rejected")

    assert not (tmp_path / "rejected").exists()
    assert (tmp_path / "accepted" / "review-packet.json").read_bytes() == accepted_bytes
    assert validate_review_packet(tmp_path / "accepted").packet_digest == accepted.packet_digest


def test_cross_identity_ambiguity_and_safety_overclaim_are_blocked(tmp_path: Path) -> None:
    service, closure, result, root = _closed(tmp_path)
    output = tmp_path / "blocked"

    with pytest.raises(LookupError):
        service.build_precision_review_packet(
            "project_other", closure.closure_digest, result, output
        )

    for changed in (
        replace(result, attempt_id="attempt_other"),
        replace(result, generation=result.generation + 1),
    ):
        with pytest.raises((ReviewPacketError, ValueError)):
            build_review_packet(closure, changed, root, output)
        assert not output.exists()
    with pytest.raises(ValueError, match="fabrication_release must remain false"):
        replace(result, truth={**dict(result.truth), "fabrication_release": True})

    packet = build_review_packet(closure, result, root, tmp_path / "packet")
    semantic_path = tmp_path / "packet" / "semantic-selection-map.json"
    semantic = json.loads(semantic_path.read_bytes())
    semantic["bindings"].append(dict(semantic["bindings"][0]))
    semantic_path.write_text(json.dumps(semantic), encoding="utf-8")
    with pytest.raises(ReviewPacketError, match="semantic|digest"):
        validate_review_packet(tmp_path / "packet")
    assert packet.fabrication_release is False


def test_viewer_assets_are_disconnected_csp_bound_and_keep_disclosures_visible(tmp_path: Path) -> None:
    _, closure, result, root = _closed(tmp_path)
    build_review_packet(closure, result, root, tmp_path / "packet")
    html = (tmp_path / "packet" / "index.html").read_text(encoding="utf-8")
    script = (tmp_path / "packet" / "viewer.js").read_text(encoding="utf-8")

    assert "default-src 'none'" in html
    assert "connect-src 'none'" in html
    assert "https://" not in html + script and "http://" not in html + script
    for disclosure in (
        "needs_human_review",
        "fabrication_release=false",
        "machine_actuation=false",
        "unreleased",
        "Review geometry is not exact geometry",
        "Mesh measurements are review-only",
    ):
        assert disclosure in html
    for control in ("Iso", "Front", "Top", "Fit", "Roll", "Reset", "Smart", "Face", "Component"):
        assert control in html
    for behavior in ("artifactToWorld", "selected-zone", "source-parameters", "bounding-box", "build-volume", "validation-issues"):
        assert behavior in html + script
    assert "fetch(" not in script
    assert "WebSocket" not in script


@pytest.mark.parametrize(
    ("trusted", "tampered"),
    (
        ("fabrication_release=false", "fabrication_release=true"),
        ("connect-src 'none'", "connect-src *"),
    ),
)
def test_viewer_entrypoint_tampering_is_rejected(
    tmp_path: Path, trusted: str, tampered: str
) -> None:
    _, closure, result, root = _closed(tmp_path)
    packet_root = tmp_path / "packet"
    build_review_packet(closure, result, root, packet_root)
    entrypoint = packet_root / "index.html"
    html = entrypoint.read_text(encoding="utf-8")

    assert trusted in html
    entrypoint.write_text(html.replace(trusted, tampered, 1), encoding="utf-8")

    with pytest.raises(ReviewPacketError, match="viewer entrypoint"):
        validate_review_packet(packet_root)


def test_self_consistent_viewer_asset_tampering_is_rejected(tmp_path: Path) -> None:
    _, closure, result, root = _closed(tmp_path)
    packet_root = tmp_path / "packet"
    build_review_packet(closure, result, root, packet_root)
    stylesheet = packet_root / "viewer.css"
    stylesheet.write_bytes(stylesheet.read_bytes() + b"\n.truth{display:none!important}\n")

    packet_path = packet_root / "review-packet.json"
    packet_value = json.loads(packet_path.read_bytes())
    packet_value["viewer"]["asset_digests"]["viewer.css"] = review_packet_module._digest_bytes(
        stylesheet.read_bytes()
    )
    packet_value["packet_digest"] = review_packet_module._digest_value(
        {key: value for key, value in packet_value.items() if key != "packet_digest"}
    )
    packet = review_packet_module.ReviewPacket.from_primitive(packet_value)
    packet_path.write_bytes(packet.canonical_bytes)
    semantic_bytes = (packet_root / "semantic-selection-map.json").read_bytes()
    glb_bytes = (packet_root / packet.artifacts["review_glb"]["packet_path"]).read_bytes()
    (packet_root / "index.html").write_bytes(
        review_packet_module._render_viewer_entrypoint(
            packet.canonical_bytes, semantic_bytes, glb_bytes
        )
    )

    with pytest.raises(ReviewPacketError, match="trusted viewer asset"):
        validate_review_packet(packet_root)


def test_self_consistent_viewer_entrypoint_path_rewrite_is_rejected(tmp_path: Path) -> None:
    _, closure, result, root = _closed(tmp_path)
    packet_root = tmp_path / "packet"
    build_review_packet(closure, result, root, packet_root)

    packet_path = packet_root / "review-packet.json"
    packet_value = json.loads(packet_path.read_bytes())
    packet_value["viewer"]["entrypoint"] = "trusted-entrypoint.html"
    packet_value["packet_digest"] = review_packet_module._digest_value(
        {key: value for key, value in packet_value.items() if key != "packet_digest"}
    )
    packet_bytes = review_packet_module.canonical_json_bytes(packet_value)
    packet_path.write_bytes(packet_bytes)
    semantic_bytes = (packet_root / "semantic-selection-map.json").read_bytes()
    glb_bytes = (
        packet_root / packet_value["artifacts"]["review_glb"]["packet_path"]
    ).read_bytes()
    trusted_entrypoint = review_packet_module._render_viewer_entrypoint(
        packet_bytes, semantic_bytes, glb_bytes
    )
    (packet_root / "trusted-entrypoint.html").write_bytes(trusted_entrypoint)
    index_path = packet_root / "index.html"
    index_path.write_text(
        index_path.read_text(encoding="utf-8").replace(
            "fabrication_release=false", "fabrication_release=true", 1
        ),
        encoding="utf-8",
    )

    with pytest.raises(ReviewPacketError, match="viewer metadata"):
        validate_review_packet(packet_root)
