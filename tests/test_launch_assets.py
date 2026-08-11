from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tomllib
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

from piton.launch_verification import (
    CURRENT_PRECISION_WORKER_OUTPUTS,
    CURRENT_PRECISION_WORKER_PIN,
    validate_launch_worker_contract,
)

ROOT = Path(__file__).resolve().parents[1]
EXAMPLE = ROOT / "examples" / "minimal-project"


def run_script(name: str, *args: object) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(ROOT / "scripts" / name), *(str(arg) for arg in args)],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )


def test_review_export_is_deterministic_non_actuating_and_does_not_execute_source(tmp_path: Path):
    project = tmp_path / "project"
    shutil.copytree(EXAMPLE, project)
    marker = tmp_path / "source-executed"
    source = project / "source" / "part.py"
    source.write_text(f"from pathlib import Path\nPath({str(marker)!r}).touch()\n", encoding="utf-8")
    manifest = json.loads((project / "piton.project.json").read_text(encoding="utf-8"))
    manifest["source_files"][0]["digest"] = "sha256:" + hashlib.sha256(source.read_bytes()).hexdigest()
    (project / "piton.project.json").write_text(json.dumps(manifest), encoding="utf-8")

    first = tmp_path / "first.json"
    second = tmp_path / "second.json"
    assert run_script("review_export.py", project, "--out", first).returncode == 0
    assert run_script("review_export.py", project, "--out", second).returncode == 0
    assert first.read_bytes() == second.read_bytes()
    assert not marker.exists()
    assert run_script("review_export.py", "validate", first, "--project-dir", project).returncode == 0

    receipt = json.loads(first.read_text(encoding="utf-8"))
    Draft202012Validator(
        json.loads((ROOT / "schemas" / "review-export-receipt-v1.schema.json").read_text())
    ).validate(receipt)
    assert receipt["claim_scope"] == "review_only_reference_export"
    assert receipt["release_state"] == "unreleased"
    assert receipt["channel_transition"] is False
    assert receipt["source_executed"] is False
    assert receipt["safety"] == {
        "review_state": "needs_human_review",
        "fabrication_release": False,
        "machine_actuation": False,
    }

    receipt["project_manifest_digest"] = "sha256:" + "f" * 64
    first.write_text(json.dumps(receipt), encoding="utf-8")
    assert run_script("review_export.py", "validate", first, "--project-dir", project).returncode == 2


def test_review_export_fails_closed_before_writing_for_invalid_custody(tmp_path: Path):
    project = tmp_path / "project"
    shutil.copytree(EXAMPLE, project)
    (project / "source" / "part.py").write_text("tampered\n", encoding="utf-8")
    output = tmp_path / "receipt.json"
    result = run_script("review_export.py", project, "--out", output)
    assert result.returncode == 2
    assert "digest mismatch" in result.stderr
    assert not output.exists()


def test_restore_forward_emit_validate_is_deterministic_and_never_mutates_project(tmp_path: Path):
    project = tmp_path / "project"
    accepted_project = tmp_path / "accepted-project"
    shutil.copytree(EXAMPLE, project)
    shutil.copytree(EXAMPLE, accepted_project)
    source = project / "source" / "part.py"
    source.write_bytes(source.read_bytes() + b"\n# restore-forward candidate\n")
    manifest = json.loads((project / "piton.project.json").read_text(encoding="utf-8"))
    manifest["source_files"][0]["digest"] = "sha256:" + hashlib.sha256(source.read_bytes()).hexdigest()
    (project / "piton.project.json").write_text(json.dumps(manifest), encoding="utf-8")
    before = {path.relative_to(project): path.read_bytes() for path in project.rglob("*") if path.is_file()}
    first = tmp_path / "restore-1.json"
    second = tmp_path / "restore-2.json"

    assert run_script("restore_forward.py", "emit", project, accepted_project, "--out", first).returncode == 0
    assert run_script("restore_forward.py", "emit", project, accepted_project, "--out", second).returncode == 0
    assert first.read_bytes() == second.read_bytes()
    assert run_script("restore_forward.py", "validate", first, "--project-dir", project).returncode == 0
    after = {path.relative_to(project): path.read_bytes() for path in project.rglob("*") if path.is_file()}
    assert before == after

    packet = json.loads(first.read_text())
    Draft202012Validator(
        json.loads((ROOT / "schemas" / "restore-forward-request-v1.schema.json").read_text())
    ).validate(packet)
    assert packet["operation"] == "restore_forward_new_revision"
    assert packet["history_rewrite"] is False
    assert packet["accepted_state_mutation"] is False
    assert packet["safety"]["fabrication_release"] is False
    assert packet["safety"]["machine_actuation"] is False

    accepted_output = accepted_project / "injected-request.json"
    assert (
        run_script(
            "restore_forward.py",
            "emit",
            project,
            accepted_project,
            "--out",
            accepted_output,
        ).returncode
        == 2
    )
    assert not accepted_output.exists()

    packet["history_rewrite"] = True
    first.write_text(json.dumps(packet), encoding="utf-8")
    assert run_script("restore_forward.py", "validate", first, "--project-dir", project).returncode == 2


def test_restore_forward_rejects_unvalidated_accepted_state(tmp_path: Path):
    candidate = tmp_path / "candidate"
    accepted = tmp_path / "accepted"
    shutil.copytree(EXAMPLE, candidate)
    shutil.copytree(EXAMPLE, accepted)
    (accepted / "source" / "part.py").write_text("tampered\n", encoding="utf-8")
    output = tmp_path / "request.json"

    result = run_script("restore_forward.py", "emit", candidate, accepted, "--out", output)

    assert result.returncode == 2
    assert "digest mismatch" in result.stderr
    assert not output.exists()


def test_templates_have_explicit_scopes_and_false_safety():
    for relative in ("templates/evidence-record-v1.json", "templates/artifact-manifest-v1.json"):
        payload = json.loads((ROOT / relative).read_text(encoding="utf-8"))
        assert payload["claim_scope"]
        assert payload["claim_scope_exclusions"]
        assert payload["safety"] == {
            "review_state": "needs_human_review",
            "fabrication_release": False,
            "machine_actuation": False,
        }


def test_launch_manifest_closes_current_exact_and_review_roles_with_independent_receipts():
    payload = json.loads((ROOT / "templates/artifact-manifest-v1.json").read_text(encoding="utf-8"))

    assert payload["revision_id"].startswith("rev_")
    assert payload["build_attempt_id"].startswith("attempt_")
    assert payload["worker_pin"] == CURRENT_PRECISION_WORKER_PIN
    assert set(payload["artifact_digests"]) == set(CURRENT_PRECISION_WORKER_OUTPUTS)
    assert set(payload["artifact_byte_lengths"]) == set(CURRENT_PRECISION_WORKER_OUTPUTS)
    assert all(value is None for value in payload["artifact_byte_lengths"].values())
    assert payload["closure"]["status"] == "template_incomplete_unverified"
    assert set(payload["closure"]["exact_roles"]) == {
        "exact_brep",
        "inspection_receipt",
        "step",
    }
    assert set(payload["closure"]["review_roles"]) == {
        "review_glb",
        "review_glb_receipt",
        "review_selection_map",
        "review_selection_map_receipt",
    }
    assert payload["closure"]["review_geometry_is_exact"] is False
    assert set(payload["independent_receipts"]) == {
        "exact_inspection",
        "review_glb",
        "review_selection_map",
    }
    for receipt in payload["independent_receipts"].values():
        assert receipt["binds_revision_and_attempt"] is True
        assert receipt["receipt_role"] in payload["artifact_digests"]
        assert set(receipt["binds_artifact_roles"]) <= set(payload["artifact_digests"])
    assert payload["independent_receipts"]["review_selection_map"]["identity_scope"] == (
        "artifact-local; no durable topology identity; no nearest fallback"
    )
    assert payload["build_plane_evidence"] == {
        "exact_brep_z_min_mm": None,
        "review_glb_z_min_mm": None,
        "artifact_to_cad_translation_mm": None,
        "review_to_threejs_world_mapping": "(x,y,z)->(x,z,-y)",
        "review_z_zero_on_visible_grid": False,
        "exact_geometry_was_translated_for_review": None,
        "verification_state": "template_incomplete_unverified",
        "evidence_ref": "REPLACE_WITH_ATTEMPT_BOUND_EVIDENCE_REFERENCE",
    }


@pytest.mark.parametrize(
    ("worker_pin", "outputs"),
    [
        ("precision_worker_one:piton.realization.v1", CURRENT_PRECISION_WORKER_OUTPUTS),
        (CURRENT_PRECISION_WORKER_PIN, ("exact_brep", "inspection_receipt", "step")),
    ],
)
def test_launch_verification_rejects_stale_v1_or_three_role_assets(
    worker_pin: str, outputs: tuple[str, ...]
):
    with pytest.raises(ValueError, match="stale"):
        validate_launch_worker_contract(worker_pin, outputs)


def test_install_and_repository_verifiers_pin_current_seven_role_closure():
    install = run_script("install_verify.py")
    assert install.returncode == 0, install.stderr
    receipt = json.loads(install.stdout)
    assert receipt["precision_worker_pin"] == CURRENT_PRECISION_WORKER_PIN
    assert tuple(receipt["precision_worker_roles"]) == CURRENT_PRECISION_WORKER_OUTPUTS
    assert set(receipt["evidence_closure_custody"]) == {
        "evidence_check_declarations",
        "evidence_check_receipts",
        "evidence_closures",
        "evidence_closure_receipts",
        "evidence_closure_artifacts",
    }

    verifier = (ROOT / "scripts" / "verify_repo.py").read_text(encoding="utf-8")
    assert 'ROOT / "src/piton/mesh_derivatives.py"' in verifier
    assert 'ROOT / "tests/test_mesh_derivatives.py"' in verifier
    assert "validate_launch_worker_contract(PRECISION_WORKER_PIN, EXPECTED_OUTPUTS)" in verifier


def test_launch_manifest_and_instructions_bind_attempt_evidence_closure():
    payload = json.loads(
        (ROOT / "templates/artifact-manifest-v1.json").read_text(encoding="utf-8")
    )
    closure = payload["evidence_closure"]
    assert closure["verification_state"] == "template_incomplete_unverified"
    assert closure["project_scoped_readback_verified"] is False
    assert closure["replay_byte_identical"] is False
    assert closure["channel_transition"] is False
    assert closure["release_consequence"] == "none"
    receipts = closure["ordered_check_receipts"]
    assert [item["check_id"] for item in receipts] == [
        "exact-artifact-closure",
        "one-valid-solid",
        "review-artifact-binding",
    ]
    for item in receipts:
        assert item["status"] == "REPLACE_WITH_PASS"
        assert item["method"]
        assert item["units"]
        assert "tolerance" in item
        assert item["environment_digest"].startswith("sha256:")
        assert item["evidence_roles"]
        assert item["invalidation_conditions"]

    instructions = (ROOT / "docs/human-review-launch-assets.md").read_text(
        encoding="utf-8"
    )
    for binding in (
        "declaration digest",
        "worker-result digest",
        "closure digest",
        "generation",
        "fence",
        "lease_id",
        "project-scoped",
        "channel_transition=false",
    ):
        assert binding in instructions


def test_reference_build_cli_rejects_authority_injection_and_names_closure_digest(tmp_path: Path):
    for flag, value in (("--params-json", "{}"), ("--source-path", "elsewhere.py")):
        result = run_script("build_part.py", flag, value)
        assert result.returncode != 0
        assert "unrecognized arguments" in result.stderr

    source = (ROOT / "scripts" / "build_part.py").read_text(encoding="utf-8")
    assert "source_manifest_digest" not in source
    assert "tracked_input_closure_digest" in source
    assert '"claim_scope": "nonauthoritative_review_reference_build"' in source


def test_reference_build_confines_repository_outputs_before_geometry(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    module = _load_build_script()
    geometry_called = False

    def unexpected_geometry(_params):
        nonlocal geometry_called
        geometry_called = True
        raise AssertionError("geometry must not run for a forbidden output")

    monkeypatch.setattr(module._l_bracket, "build_l_bracket", unexpected_geometry)
    for output in (
        ROOT / "src" / "piton" / "parts" / "forbidden.step",
        ROOT / "scripts" / "forbidden.step",
        ROOT / "pyproject.step",
    ):
        monkeypatch.setattr(sys, "argv", ["build_part.py", "--out", str(output)])
        with pytest.raises(ValueError, match="derived output root"):
            module.main()
        assert not output.exists()
    assert geometry_called is False


def test_reference_build_normalizes_step_header_and_manifest_is_truthful():
    module = _load_build_script()
    first = b"ISO-10303-21;\nFILE_NAME('random-a.step','2026-08-10T10:11:12',('a'),('b'),'c','d','e');\nEND-ISO-10303-21;\n"
    second = b"ISO-10303-21;\nFILE_NAME('random-b.step','2029-01-02T03:04:05',('a'),('b'),'c','d','e');\nEND-ISO-10303-21;\n"
    assert module._normalize_step_header(first) == module._normalize_step_header(second)
    assert b"1970-01-01T00:00:00" in module._normalize_step_header(first)

    manifest = module._manifest(
        out_path=Path("/review/part.step"),
        step_bytes=module._normalize_step_header(first),
        closure=[{"path": "source.py", "digest": "sha256:" + "0" * 64}],
        closure_digest="sha256:" + "1" * 64,
        params=module._l_bracket.DEFAULT_PARAMETERS,
        part=type("Part", (), {"volume": 1.0, "area": 2.0})(),
        bounding_box=type(
            "Box",
            (),
            {
                "min": type("Point", (), {"X": 0.0, "Y": 0.0, "Z": 0.0})(),
                "max": type("Point", (), {"X": 1.0, "Y": 2.0, "Z": 3.0})(),
            },
        )(),
    )
    assert manifest["schema"] == "piton.reference-build-manifest.v1"
    assert manifest["units"] == "mm"
    assert manifest["export_policy"]["step_header_timestamp"] == "1970-01-01T00:00:00"
    assert manifest["tolerance_policy"]["manufacturing_tolerance_claimed"] is False
    assert manifest["recipe"]["parameter_authority"] == "tracked_default_parameters"
    assert manifest["governed_authority"] == {
        "design_revision_id": None,
        "build_attempt_id": None,
        "authored_state_mutated": False,
    }


def test_reference_build_succeeds_is_deterministic_and_reads_back(tmp_path: Path):
    build123d = pytest.importorskip("build123d")
    first = tmp_path / "first.step"
    second = tmp_path / "second.step"

    first_result = run_script("build_part.py", "--out", first)
    second_result = run_script("build_part.py", "--out", second)
    assert first_result.returncode == 0, first_result.stderr
    assert second_result.returncode == 0, second_result.stderr
    assert first.read_bytes() == second.read_bytes()

    manifest = json.loads(first.with_name("first_manifest.json").read_text(encoding="utf-8"))
    assert manifest["step_digest"] == "sha256:" + hashlib.sha256(first.read_bytes()).hexdigest()
    assert manifest["tracked_input_closure_digest"].startswith("sha256:")
    assert manifest["runtime"]["build123d_version"] != "not-installed"
    assert manifest["fabrication_release"] is False
    assert manifest["machine_actuation"] is False
    assert build123d.import_step(str(first)).volume > 0


def _load_build_script():
    spec = importlib.util.spec_from_file_location("piton_test_build_part", ROOT / "scripts" / "build_part.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_reference_build_rejects_existing_or_symlinked_output_pair(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    module = _load_build_script()
    output = tmp_path / "part.step"
    manifest = tmp_path / "part_manifest.json"
    monkeypatch.setattr(sys, "argv", ["build_part.py", "--out", str(output)])
    for occupied in (output, manifest):
        occupied.write_bytes(b"do-not-overwrite")
        with pytest.raises(FileExistsError):
            module.main()
        assert occupied.read_bytes() == b"do-not-overwrite"
        assert not (manifest if occupied == output else output).exists()
        occupied.unlink()

    target = tmp_path / "target"
    target.write_bytes(b"target")
    for occupied in (output, manifest):
        occupied.symlink_to(target)
        with pytest.raises(FileExistsError):
            module.main()
        assert occupied.is_symlink()
        assert target.read_bytes() == b"target"
        assert not (manifest if occupied == output else output).exists()
        occupied.unlink()


def test_reference_build_rejects_unbound_module_and_mid_build_closure_change(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    module = _load_build_script()
    output = tmp_path / "part.step"
    monkeypatch.setattr(sys, "argv", ["build_part.py", "--out", str(output)])
    original_module_file = module._l_bracket.__file__
    monkeypatch.setattr(module._l_bracket, "__file__", str(tmp_path / "untracked.py"))
    with pytest.raises(RuntimeError, match="not bound"):
        module.main()
    assert not output.exists()
    monkeypatch.setattr(module._l_bracket, "__file__", original_module_file)

    module = _load_build_script()
    monkeypatch.setattr(sys, "argv", ["build_part.py", "--out", str(output)])
    real_closure = module.tracked_input_closure
    calls = 0

    def changing_closure():
        nonlocal calls
        members, digest = real_closure()
        calls += 1
        if calls == 2:
            members = [*members, {"path": "changed", "digest": "sha256:" + "0" * 64}]
        return members, digest

    monkeypatch.setattr(module, "tracked_input_closure", changing_closure)
    with pytest.raises(RuntimeError, match="changed during execution"):
        module.main()
    assert not output.exists()
    assert not output.with_name("part_manifest.json").exists()


def test_reference_build_rolls_back_first_publish_if_manifest_publish_fails(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    module = _load_build_script()
    output = tmp_path / "part.step"
    manifest = tmp_path / "part_manifest.json"
    monkeypatch.setattr(sys, "argv", ["build_part.py", "--out", str(output)])
    real_link = os.link
    calls = 0

    def fail_second_link(source: str | Path, destination: str | Path) -> None:
        nonlocal calls
        calls += 1
        if calls == 2:
            raise OSError("simulated manifest publication failure")
        real_link(source, destination)

    monkeypatch.setattr(os, "link", fail_second_link)
    with pytest.raises(OSError, match="simulated"):
        module.main()
    assert not output.exists()
    assert not manifest.exists()


def test_launch_schema_mutations_are_rejected():
    receipt_schema = json.loads((ROOT / "schemas" / "review-export-receipt-v1.schema.json").read_text())
    restore_schema = json.loads((ROOT / "schemas" / "restore-forward-request-v1.schema.json").read_text())
    Draft202012Validator.check_schema(receipt_schema)
    Draft202012Validator.check_schema(restore_schema)

    receipt = json.loads((ROOT / "templates" / "artifact-manifest-v1.json").read_text())
    assert receipt["safety"]["fabrication_release"] is False
    for schema, field in ((receipt_schema, "fabrication_release"), (restore_schema, "machine_actuation")):
        safety_property = schema["$defs"]["safety"]["properties"][field]
        assert safety_property == {"const": False}


def test_installed_launch_asset_surface_has_runtime_dependency_and_packaged_schemas():
    pyproject = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    assert "jsonschema==4.26.0" in pyproject["project"]["dependencies"]
    assert "jsonschema==4.26.0" not in pyproject["project"]["optional-dependencies"]["verification"]
    assert "schemas/*.json" in pyproject["tool"]["setuptools"]["package-data"]["piton"]

    for schema_name in (
        "review-export-receipt-v1.schema.json",
        "restore-forward-request-v1.schema.json",
    ):
        assert (ROOT / "src" / "piton" / "schemas" / schema_name).read_bytes() == (
            ROOT / "schemas" / schema_name
        ).read_bytes()

    install_smoke = (ROOT / "scripts" / "install_verify.py").read_text(encoding="utf-8")
    assert "from piton.launch_assets import build_review_export" in install_smoke
    assert '"launch_asset_package": launch_receipt["schema"]' in install_smoke

    ci = (ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
    assert "uv pip install --python /tmp/piton-wheel-venv/bin/python dist/*.whl" in ci
    assert "--no-deps dist/*.whl" not in ci
