"""Repository contracts for the direct, browser-only Piton MVI path.

These checks govern entry wiring, operator launch assets, and verification wiring.
They do not launch Python from the browser path and confer no review, approval,
export, release, promotion, or machine-actuation consequence.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / "package.json"
WORKFLOW = ROOT / ".github" / "workflows" / "ci.yml"
LAUNCHER = ROOT / "launch-browser-mvi.sh"
THREAT_MODEL = ROOT / "docs" / "threat-model.md"

FORBIDDEN_BROWSER_RUNTIME_TOKENS = (
    "python",
    "uv ",
    "build123d",
    "cadquery",
    "ocp",
    "scripts/verify_repo.py",
    "pytest",
)


def test_index_uses_the_only_browser_entry_directly() -> None:
    index = (ROOT / "index.html").read_text(encoding="utf-8")

    assert 'src="/browser-src/main.tsx"' in index
    assert "/src/main.tsx" not in index
    assert not (ROOT / "src" / "main.tsx").exists()
    assert not (ROOT / "src" / "App.tsx").exists()


def test_package_exposes_one_fail_fast_browser_only_mvi_gate() -> None:
    scripts = json.loads(PACKAGE.read_text(encoding="utf-8"))["scripts"]

    assert scripts["verify:mvi"] == (
        "pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e"
    )
    assert scripts["launch:mvi"] == "./launch-browser-mvi.sh"
    normalized = scripts["verify:mvi"].lower()
    assert all(token not in normalized for token in FORBIDDEN_BROWSER_RUNTIME_TOKENS)


def test_browser_ci_uses_the_canonical_gate_and_keeps_python_separate() -> None:
    workflow = WORKFLOW.read_text(encoding="utf-8")
    browser_job, python_job = workflow.split("\n  verify:\n", maxsplit=1)

    assert "pnpm verify:mvi" in browser_job
    assert "pnpm typecheck" not in browser_job
    assert "pnpm test\n" not in browser_job
    assert "pnpm build" not in browser_job
    assert all(token not in browser_job.lower() for token in FORBIDDEN_BROWSER_RUNTIME_TOKENS)
    assert "uv sync --frozen --all-extras" in python_job
    assert "python -m pytest -q" in python_job


def test_threat_model_uses_the_canonical_browser_verification_gate() -> None:
    threat_model = THREAT_MODEL.read_text(encoding="utf-8")
    validation_section = threat_model.split("## Validation evidence", maxsplit=1)[1]
    commands = re.search(r"```bash\n(.*?)\n```", validation_section, re.DOTALL)

    assert commands is not None
    command_lines = commands.group(1).splitlines()
    assert "pnpm verify:mvi" in command_lines
    assert not {
        "pnpm install --frozen-lockfile",
        "pnpm typecheck",
        "pnpm test",
        "pnpm build",
        "pnpm test:e2e",
    }.intersection(command_lines)


def _write_fake_pnpm(bin_dir: Path) -> None:
    fake = bin_dir / "pnpm"
    fake.write_text(
        "#!/bin/sh\n"
        "printf '%s|%s\\n' \"$PWD\" \"$*\" >> \"$PNPM_CALLS\"\n"
        "case \"$1\" in\n"
        "  --version) printf '%s\\n' \"${PNPM_VERSION:-11.1.3}\"; exit 0 ;;\n"
        "  install) exit \"${INSTALL_EXIT:-0}\" ;;\n"
        "  dev) exit \"${DEV_EXIT:-0}\" ;;\n"
        "  *) exit 97 ;;\n"
        "esac\n",
        encoding="utf-8",
    )
    fake.chmod(0o755)


def _run_launcher(
    tmp_path: Path,
    *,
    install_exit: int = 0,
    dev_exit: int = 0,
    pnpm_version: str = "11.1.3",
) -> tuple[subprocess.CompletedProcess[str], list[str], Path]:
    checkout = tmp_path / "checkout with spaces"
    checkout.mkdir()
    launcher = checkout / LAUNCHER.name
    shutil.copy2(LAUNCHER, launcher)
    launcher.chmod(0o755)
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _write_fake_pnpm(bin_dir)
    calls = tmp_path / "pnpm-calls"
    env = {
        **os.environ,
        "PATH": f"{bin_dir}:{os.environ.get('PATH', '')}",
        "PNPM_CALLS": str(calls),
        "INSTALL_EXIT": str(install_exit),
        "DEV_EXIT": str(dev_exit),
        "PNPM_VERSION": pnpm_version,
    }
    result = subprocess.run(
        [str(launcher)],
        cwd=tmp_path,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )
    recorded = calls.read_text(encoding="utf-8").splitlines() if calls.exists() else []
    return result, recorded, checkout


def test_launcher_installs_frozen_graph_then_executes_local_server(tmp_path: Path) -> None:
    result, calls, checkout = _run_launcher(tmp_path)

    assert result.returncode == 0
    assert calls == [
        f"{checkout}|--version",
        f"{checkout}|install --frozen-lockfile",
        f"{checkout}|dev",
    ]


def test_launcher_propagates_install_failure_without_starting_server(tmp_path: Path) -> None:
    result, calls, checkout = _run_launcher(tmp_path, install_exit=23)

    assert result.returncode == 23
    assert calls == [f"{checkout}|--version", f"{checkout}|install --frozen-lockfile"]


def test_launcher_fails_closed_on_the_wrong_package_manager_version(tmp_path: Path) -> None:
    result, calls, checkout = _run_launcher(tmp_path, pnpm_version="11.1.2")

    assert result.returncode == 2
    assert calls == [f"{checkout}|--version"]
    assert "requires pnpm 11.1.3" in result.stderr


def test_launcher_is_local_browser_only_and_docs_use_canonical_commands() -> None:
    launcher = LAUNCHER.read_text(encoding="utf-8")
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    review = (ROOT / "docs" / "human-review-launch-assets.md").read_text(encoding="utf-8")

    assert "pnpm install --frozen-lockfile" in launcher
    assert "exec pnpm dev" in launcher
    assert all(token not in launcher.lower() for token in FORBIDDEN_BROWSER_RUNTIME_TOKENS)
    for document in (readme, review):
        assert "pnpm launch:mvi" in document
        assert "pnpm verify:mvi" in document
        assert "pre-cutover" in document
        assert "Python/build123d/OCP" in document
        assert "optional external exact-CAD/reference adapter" not in document
