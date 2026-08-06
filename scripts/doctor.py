#!/usr/bin/env python3
from __future__ import annotations

import importlib.metadata
import importlib.util
import json
import platform
import sys

modules = {name: bool(importlib.util.find_spec(name)) for name in ("build123d", "OCP")}
expected = {"build123d": "0.11.1", "cadquery-ocp": "7.9.3.1"}
versions = {
    distribution: importlib.metadata.version(distribution) if modules[module] else None
    for distribution, module in (("build123d", "build123d"), ("cadquery-ocp", "OCP"))
}
ok = all(modules.values()) and versions == expected
result = {
    "ok": ok,
    "python": sys.version.split()[0],
    "platform": platform.platform(),
    "modules": modules,
    "versions": versions,
    "expected_versions": expected,
    "exact_geometry_lane": "available" if ok else "blocked_dependency_mismatch",
    "fabrication_release": False,
    "machine_actuation": False,
}
print(json.dumps(result, sort_keys=True))
raise SystemExit(0 if ok else 2)
