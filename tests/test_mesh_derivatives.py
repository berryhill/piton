"""Acceptance tests for revision-pinned GLB, STL, and 3MF derivatives."""
from __future__ import annotations

import json
import math
import struct
import zipfile
from dataclasses import replace
from pathlib import Path

import pytest

from piton.mesh_derivatives import (
    DerivativeSource,
    TessellationPolicy,
    derive_mesh_derivatives,
    read_3mf,
    read_binary_stl,
    read_glb,
    validate_selection_map,
)
from piton.parts.l_bracket import DEFAULT_PARAMETERS
from piton.realization import RealizationInputs, realize_exact

ROOT = Path(__file__).resolve().parents[1]


def _digest(path: Path) -> str:
    import hashlib
    return "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()


def _source(tmp_path: Path) -> DerivativeSource:
    inputs = RealizationInputs.from_repository(ROOT, DEFAULT_PARAMETERS)
    attempt = tmp_path / "exact-attempt"
    receipt = realize_exact(inputs.revision, inputs, attempt)
    return DerivativeSource(
        revision_id=inputs.revision.revision_id,
        build_attempt_scope=receipt["attempt_scope"],
        exact_brep_digest=receipt["artifact_digests"]["exact_brep"],
        exact_receipt_digest=_digest(attempt / "receipt.json"),
        exact_attempt_directory=attempt,
    )


def test_derives_deterministic_independently_receipted_formats(tmp_path: Path) -> None:
    source = _source(tmp_path)
    policy = TessellationPolicy(linear_deflection_mm=0.05, angular_deflection_rad=0.1)

    first = derive_mesh_derivatives(source, policy, tmp_path / "derivatives-a")
    second = derive_mesh_derivatives(source, policy, tmp_path / "derivatives-b")

    assert first == second
    assert set(first["artifacts"]) == {"glb", "stl", "3mf", "selection_map"}
    assert first["tessellation_policy"]["digest"] == policy.digest()
    for role, relative_path in first["artifacts"].items():
        first_path = tmp_path / "derivatives-a" / relative_path
        second_path = tmp_path / "derivatives-b" / second["artifacts"][role]
        assert first_path.read_bytes() == second_path.read_bytes()
        assert first_path.parts[-3:-1] == ("sha256", first["artifact_digests"][role].removeprefix("sha256:"))
        receipt = json.loads(
            (tmp_path / "derivatives-a" / first["receipts"][role]).read_text(encoding="utf-8")
        )
        assert receipt["status"] == "succeeded"
        assert receipt["revision_id"] == source.revision_id
        assert receipt["source_build_attempt_scope"] == source.build_attempt_scope
        assert receipt["source_exact_brep_digest"] == source.exact_brep_digest
        assert receipt["source_exact_receipt_digest"] == source.exact_receipt_digest
        assert receipt["artifact_digest"] == _digest(first_path)
        assert receipt["artifact_filename"] == relative_path
        assert receipt["artifact_byte_length"] == first_path.stat().st_size
        assert receipt["tessellation_policy"]["digest"] == policy.digest()
        assert receipt["review_state"] == "needs_human_review"
        assert receipt["fabrication_release"] is False
        assert receipt["machine_actuation"] is False


def test_format_readback_and_floor_mapping_are_independent(tmp_path: Path) -> None:
    source = _source(tmp_path)
    result = derive_mesh_derivatives(source, TessellationPolicy(), tmp_path / "derived")
    root = tmp_path / "derived"

    glb = read_glb(root / result["artifacts"]["glb"])
    stl = read_binary_stl(root / result["artifacts"]["stl"])
    three_mf = read_3mf(root / result["artifacts"]["3mf"])
    selection = validate_selection_map(
        root / result["artifacts"]["selection_map"],
        glb_path=root / result["artifacts"]["glb"],
        revision_id=source.revision_id,
        build_attempt_scope=source.build_attempt_scope,
        triangle_count=glb["triangle_count"],
    )

    for decoded in (glb, stl, three_mf):
        assert decoded["triangle_count"] > 0
        assert decoded["bounding_box_mm"]["min"][2] == pytest.approx(0.0, abs=1e-7)
        assert all(math.isfinite(value) for point in decoded["vertices"] for value in point)
    assert glb["bounding_box_mm"] == stl["bounding_box_mm"] == three_mf["bounding_box_mm"]
    assert glb["triangle_count"] == stl["triangle_count"] == three_mf["triangle_count"]
    assert selection["bindings"] == [
        {"semantic_id": "part:l_bracket", "primitive": 0, "triangle_start": 0,
         "triangle_count": glb["triangle_count"]}
    ]


def test_admission_rejects_mismatched_source_bindings_before_publication(tmp_path: Path) -> None:
    source = _source(tmp_path)
    output = tmp_path / "must-not-exist"
    mismatches = (
        replace(source, revision_id="rev_" + "0" * 64),
        replace(source, build_attempt_scope="stale-attempt"),
        replace(source, exact_brep_digest="sha256:" + "0" * 64),
        replace(source, exact_receipt_digest="sha256:" + "0" * 64),
    )
    for mismatch in mismatches:
        with pytest.raises(ValueError):
            derive_mesh_derivatives(mismatch, TessellationPolicy(), output)
        assert not output.exists()


def test_validators_reject_false_success_structures(tmp_path: Path) -> None:
    source = _source(tmp_path)
    result = derive_mesh_derivatives(source, TessellationPolicy(), tmp_path / "derived")
    root = tmp_path / "derived"

    bad_glb = tmp_path / "bad.glb"
    bad_glb.write_bytes((root / result["artifacts"]["glb"]).read_bytes()[:-1])
    with pytest.raises(ValueError):
        read_glb(bad_glb)

    bad_stl = tmp_path / "bad.stl"
    stl_bytes = bytearray((root / result["artifacts"]["stl"]).read_bytes())
    stl_bytes[80:84] = (999999).to_bytes(4, "little")
    bad_stl.write_bytes(stl_bytes)
    with pytest.raises(ValueError):
        read_binary_stl(bad_stl)

    bad_3mf = tmp_path / "bad.3mf"
    bad_3mf.write_bytes((root / result["artifacts"]["3mf"]).read_bytes()[:-8])
    with pytest.raises(ValueError):
        read_3mf(bad_3mf)


def test_selection_map_is_glb_local_and_fails_closed(tmp_path: Path) -> None:
    source = _source(tmp_path)
    result = derive_mesh_derivatives(source, TessellationPolicy(), tmp_path / "derived")
    root = tmp_path / "derived"
    glb_path = root / result["artifacts"]["glb"]
    glb = read_glb(glb_path)
    mapping_path = root / result["artifacts"]["selection_map"]
    mapping = json.loads(mapping_path.read_text(encoding="utf-8"))
    mapping["bindings"][0]["triangle_count"] += 1
    bad_map = tmp_path / "bad-map.json"
    bad_map.write_text(json.dumps(mapping), encoding="utf-8")

    with pytest.raises(ValueError):
        validate_selection_map(
            bad_map,
            glb_path=glb_path,
            revision_id=source.revision_id,
            build_attempt_scope=source.build_attempt_scope,
            triangle_count=glb["triangle_count"],
        )


def test_readback_rejects_nonfinite_stl_and_bad_3mf_units_or_indices(tmp_path: Path) -> None:
    source = _source(tmp_path)
    result = derive_mesh_derivatives(source, TessellationPolicy(), tmp_path / "derived")
    root = tmp_path / "derived"

    stl_bytes = bytearray((root / result["artifacts"]["stl"]).read_bytes())
    struct.pack_into("<f", stl_bytes, 84 + 12, float("nan"))
    bad_stl = tmp_path / "nonfinite.stl"
    bad_stl.write_bytes(stl_bytes)
    with pytest.raises(ValueError, match="non-finite"):
        read_binary_stl(bad_stl)

    source_3mf = root / result["artifacts"]["3mf"]
    with zipfile.ZipFile(source_3mf, "r") as archive:
        members = {name: archive.read(name) for name in archive.namelist()}
    for label, old, new in (
        ("units", b'unit="millimeter"', b'unit="inch"'),
        ("indices", b'<triangle v1="', b'<triangle v1="999999'),
    ):
        bad_3mf = tmp_path / f"bad-{label}.3mf"
        changed = dict(members)
        changed["3D/3dmodel.model"] = changed["3D/3dmodel.model"].replace(old, new, 1)
        with zipfile.ZipFile(bad_3mf, "w") as archive:
            for name in sorted(changed):
                archive.writestr(name, changed[name])
        with pytest.raises(ValueError):
            read_3mf(bad_3mf)


def test_existing_output_is_no_clobber(tmp_path: Path) -> None:
    source = _source(tmp_path)
    output = tmp_path / "derived"
    derive_mesh_derivatives(source, TessellationPolicy(), output)
    with pytest.raises(FileExistsError):
        derive_mesh_derivatives(source, TessellationPolicy(), output)
