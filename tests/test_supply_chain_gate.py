from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from piton.supply_chain import SupplyChainViolation, verify_first_party_supply_chain

ROOT = Path(__file__).resolve().parents[1]


def copy_gate_inputs(tmp_path: Path) -> Path:
    root = tmp_path / "repository"
    (root / ".github" / "workflows").mkdir(parents=True)
    shutil.copy2(ROOT / "pyproject.toml", root / "pyproject.toml")
    shutil.copy2(ROOT / "uv.lock", root / "uv.lock")
    shutil.copy2(ROOT / ".github" / "workflows" / "ci.yml", root / ".github" / "workflows" / "ci.yml")
    return root


def test_repository_passes_first_party_supply_chain_gate():
    receipt = verify_first_party_supply_chain(ROOT)

    assert receipt.schema == "piton.first-party-supply-chain-gate.v1"
    assert receipt.status == "pass"
    assert receipt.policy_owner == "Piton maintainers"
    assert receipt.checked_workflows == (".github/workflows/ci.yml",)
    assert receipt.direct_dependencies == (
        "build==1.3.0",
        "build123d==0.11.1",
        "cadquery-ocp-novtk==7.9.3.1",
        "jsonschema==4.26.0",
        "pytest==8.4.2",
        "setuptools==80.9.0",
    )
    assert receipt.review_state == "needs_human_review"
    assert receipt.fabrication_release is False
    assert receipt.machine_actuation is False


def test_gate_rejects_a_mutable_github_action_reference(tmp_path: Path):
    root = copy_gate_inputs(tmp_path)
    workflow = root / ".github" / "workflows" / "ci.yml"
    workflow.write_text(
        workflow.read_text(encoding="utf-8").replace(
            "actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683",
            "actions/checkout@v4",
        ),
        encoding="utf-8",
    )

    with pytest.raises(SupplyChainViolation, match="immutable 40-hex commit"):
        verify_first_party_supply_chain(root)


def test_gate_rejects_unapproved_action_or_workflow_expansion(tmp_path: Path):
    root = copy_gate_inputs(tmp_path)
    workflow = root / ".github" / "workflows" / "ci.yml"
    workflow.write_text(
        workflow.read_text(encoding="utf-8").replace(
            "actions/setup-python@a26af69be951a213d495a4c3e4e4022e16d87065",
            "untrusted/setup-python@a26af69be951a213d495a4c3e4e4022e16d87065",
        ),
        encoding="utf-8",
    )

    with pytest.raises(SupplyChainViolation, match="action is not first-party-approved"):
        verify_first_party_supply_chain(root)


def test_gate_rejects_unpinned_direct_dependency(tmp_path: Path):
    root = copy_gate_inputs(tmp_path)
    project = root / "pyproject.toml"
    project.write_text(
        project.read_text(encoding="utf-8").replace(
            'dependencies = ["jsonschema==4.26.0"]',
            'dependencies = ["jsonschema>=4.26.0"]',
        ),
        encoding="utf-8",
    )

    with pytest.raises(SupplyChainViolation, match="exactly pinned"):
        verify_first_party_supply_chain(root)


def test_gate_rejects_a_lock_entry_without_artifact_hashes(tmp_path: Path):
    root = copy_gate_inputs(tmp_path)
    lock = root / "uv.lock"
    lock.write_text(
        lock.read_text(encoding="utf-8").replace(
            'hash = "sha256:7145f0b5061ba90a1500d60bd1b13ca0a8a4cebdd0cc16ed8adf1c0e739f43b4", ',
            "",
            1,
        ),
        encoding="utf-8",
    )

    with pytest.raises(SupplyChainViolation, match="invalid artifact hash"):
        verify_first_party_supply_chain(root)


def test_gate_rejects_a_different_immutable_action_commit(tmp_path: Path):
    root = copy_gate_inputs(tmp_path)
    workflow = root / ".github" / "workflows" / "ci.yml"
    workflow.write_text(
        workflow.read_text(encoding="utf-8").replace(
            "actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683",
            "actions/checkout@0000000000000000000000000000000000000000",
        ),
        encoding="utf-8",
    )

    with pytest.raises(SupplyChainViolation, match="approved commit"):
        verify_first_party_supply_chain(root)


def test_gate_rejects_job_level_permission_escalation(tmp_path: Path):
    root = copy_gate_inputs(tmp_path)
    workflow = root / ".github" / "workflows" / "ci.yml"
    workflow.write_text(
        workflow.read_text(encoding="utf-8").replace(
            "  verify:\n",
            "  verify:\n    permissions:\n      contents: write\n",
        ),
        encoding="utf-8",
    )

    with pytest.raises(SupplyChainViolation, match="one repository-level permissions block"):
        verify_first_party_supply_chain(root)


def test_gate_rejects_an_unapproved_editable_lock_source(tmp_path: Path):
    root = copy_gate_inputs(tmp_path)
    lock = root / "uv.lock"
    lock.write_text(
        lock.read_text(encoding="utf-8").replace(
            'source = { editable = "." }',
            'source = { editable = "../other-project" }',
            1,
        ),
        encoding="utf-8",
    )

    with pytest.raises(SupplyChainViolation, match="unapproved editable lock source"):
        verify_first_party_supply_chain(root)


@pytest.mark.parametrize(
    "relative_path",
    ("pyproject.toml", "uv.lock", ".github/workflows/ci.yml"),
)
def test_gate_rejects_symlinked_policy_inputs(tmp_path: Path, relative_path: str):
    root = copy_gate_inputs(tmp_path)
    policy_input = root / relative_path
    external_input = tmp_path / (policy_input.name + ".external")
    shutil.copy2(policy_input, external_input)
    policy_input.unlink()
    policy_input.symlink_to(external_input)

    with pytest.raises(SupplyChainViolation, match="regular non-symlink repository file"):
        verify_first_party_supply_chain(root)


def test_gate_rejects_unapproved_install_in_multiline_run_block(tmp_path: Path):
    root = copy_gate_inputs(tmp_path)
    workflow = root / ".github" / "workflows" / "ci.yml"
    workflow.write_text(
        workflow.read_text(encoding="utf-8").replace(
            "      - name: Unit and contract tests\n",
            "      - name: Unapproved ambient install\n"
            "        run: |\n"
            "          python3 -m pip install requests\n"
            "          python3 -c \"print('installed')\"\n"
            "      - name: Unit and contract tests\n",
        ),
        encoding="utf-8",
    )

    with pytest.raises(SupplyChainViolation, match="install command inventory changed"):
        verify_first_party_supply_chain(root)


@pytest.mark.parametrize(
    "unapproved_step",
    (
        "      - name: Unapproved pip3 install\n"
        "        run: pip3 install requests\n",
        "      - name: Unapproved continued install\n"
        "        run: |\n"
        "          python3 -m pip \\\n"
        "            install requests\n",
    ),
)
def test_gate_rejects_install_command_variants_that_use_ambient_dependencies(
    tmp_path: Path,
    unapproved_step: str,
):
    root = copy_gate_inputs(tmp_path)
    workflow = root / ".github" / "workflows" / "ci.yml"
    workflow.write_text(
        workflow.read_text(encoding="utf-8").replace(
            "      - name: Unit and contract tests\n",
            unapproved_step + "      - name: Unit and contract tests\n",
        ),
        encoding="utf-8",
    )

    with pytest.raises(SupplyChainViolation, match="install command inventory changed"):
        verify_first_party_supply_chain(root)


def test_threat_model_closes_required_scope_and_invalidation_contract():
    threat_model = (ROOT / "docs" / "threat-model.md").read_text(encoding="utf-8")

    for heading in (
        "## Assets",
        "## Trust boundaries",
        "## Actors",
        "## Entry points",
        "## Threat register",
        "## Validation evidence",
        "## Residual risks",
        "## Owners",
        "## Invalidation conditions",
    ):
        assert heading in threat_model
    for scope in (
        "source-native Python",
        "immutable project inputs",
        "local custody",
        "CI and build dependencies",
        "precision workers",
        "review packets",
        "schemas and templates",
        "operator and human-review boundary",
    ):
        assert scope in threat_model
    for threat_id in ("TM-01", "TM-02", "TM-03", "TM-04", "TM-05", "TM-06", "TM-07", "TM-08", "TM-09", "TM-10"):
        assert threat_id in threat_model
    assert "fabrication_release=false" in threat_model
    assert "machine_actuation=false" in threat_model
    assert "review_state=needs_human_review" in threat_model
