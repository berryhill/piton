from __future__ import annotations

import json
import re
import subprocess
import sys
import tomllib
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PYPROJECT = ROOT / "pyproject.toml"
LOCK = ROOT / "uv.lock"
PYTHON_VERSION = ROOT / ".python-version"
CI = ROOT / ".github" / "workflows" / "ci.yml"


class ExactToolchainContractTests(unittest.TestCase):
    def test_python_and_cad_dependencies_are_directly_pinned(self) -> None:
        project = tomllib.loads(PYPROJECT.read_text(encoding="utf-8"))

        self.assertEqual(project["project"]["requires-python"], "==3.12.11")
        self.assertEqual(
            project["project"]["optional-dependencies"]["cad"],
            ["build123d==0.11.1", "cadquery-ocp-novtk==7.9.3.1"],
        )
        self.assertEqual(PYTHON_VERSION.read_text(encoding="utf-8"), "3.12.11")

    def test_selected_lock_excludes_vtk_geometry_distributions(self) -> None:
        locked = tomllib.loads(LOCK.read_text(encoding="utf-8"))
        packages = {package["name"]: package for package in locked["package"]}

        self.assertEqual(locked["requires-python"], "==3.12.11")
        self.assertIn("build123d", packages)
        self.assertIn("cadquery-ocp-novtk", packages)
        self.assertNotIn("cadquery-ocp", packages)
        self.assertNotIn("vtk", packages)

        for name, expected_version in (
            ("build123d", "0.11.1"),
            ("cadquery-ocp-novtk", "7.9.3.1"),
        ):
            package = packages[name]
            self.assertEqual(package["version"], expected_version)
            artifacts = [*package.get("wheels", []), package.get("sdist")]
            artifacts = [artifact for artifact in artifacts if artifact is not None]
            self.assertTrue(artifacts, f"{name} has no locked distributions")
            for artifact in artifacts:
                self.assertRegex(artifact["hash"], re.compile(r"^sha256:[0-9a-f]{64}$"))

    def test_ci_pins_exact_python_and_uv_and_runs_frozen(self) -> None:
        workflow = CI.read_text(encoding="utf-8")

        self.assertIn('python-version: "3.12.11"', workflow)
        self.assertIn("uv==0.11.6", workflow)
        self.assertIn("uv sync --frozen --all-extras", workflow)
        self.assertIn("uv run --frozen python scripts/doctor.py", workflow)

    def test_doctor_proves_pinned_kernel_with_safe_truth_defaults(self) -> None:
        completed = subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "doctor.py")],
            check=False,
            capture_output=True,
            text=True,
        )
        result = json.loads(completed.stdout)

        self.assertEqual(completed.returncode, 0, completed.stderr or completed.stdout)
        self.assertTrue(result["ok"])
        self.assertEqual(result["python"], "3.12.11")
        self.assertEqual(
            result["versions"],
            {"build123d": "0.11.1", "cadquery-ocp-novtk": "7.9.3.1"},
        )
        self.assertEqual(
            result["kernel_probe"],
            {"box_size_mm": [1.0, 2.0, 3.0], "volume_mm3": 6.0},
        )
        self.assertEqual(result["exact_geometry_lane"], "available")
        self.assertFalse(result["fabrication_release"])
        self.assertFalse(result["machine_actuation"])
        self.assertEqual(result["review_state"], "needs_human_review")


if __name__ == "__main__":
    unittest.main()
