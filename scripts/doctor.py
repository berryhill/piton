#!/usr/bin/env python3
from __future__ import annotations

import importlib.metadata
import json
import platform

EXPECTED_PYTHON = "3.12.11"
EXPECTED_VERSIONS = {"build123d": "0.11.1", "cadquery-ocp-novtk": "7.9.3.1"}


def run_probe() -> dict[str, object]:
    from build123d import Box
    import OCP  # noqa: F401 - importing the pinned kernel is part of the proof

    box = Box(1, 2, 3)
    return {"box_size_mm": [1.0, 2.0, 3.0], "volume_mm3": box.volume}


def main() -> int:
    python_version = platform.python_version()
    try:
        versions = {
            distribution: importlib.metadata.version(distribution)
            for distribution in EXPECTED_VERSIONS
        }
        kernel_probe = run_probe()
        error = None
    except Exception as exc:  # Report a blocked lane as machine-readable evidence.
        versions = {}
        kernel_probe = None
        error = f"{type(exc).__name__}: {exc}"

    ok = (
        python_version == EXPECTED_PYTHON
        and versions == EXPECTED_VERSIONS
        and kernel_probe == {"box_size_mm": [1.0, 2.0, 3.0], "volume_mm3": 6.0}
    )
    result = {
        "ok": ok,
        "python": python_version,
        "platform": platform.platform(),
        "versions": versions,
        "expected_versions": EXPECTED_VERSIONS,
        "kernel_probe": kernel_probe,
        "error": error,
        "exact_geometry_lane": "available" if ok else "blocked_toolchain_mismatch",
        "review_state": "needs_human_review",
        "fabrication_release": False,
        "machine_actuation": False,
    }
    print(json.dumps(result, sort_keys=True))
    return 0 if ok else 2


if __name__ == "__main__":
    raise SystemExit(main())
