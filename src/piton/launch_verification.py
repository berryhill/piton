"""Launch-verification sentinel for the current precision-worker closure.

This deliberately duplicates the reviewed launch contract as a drift detector.
The worker implementation remains authoritative; launch scripts must compare its
exported constants with these reviewed values rather than accepting any pin and
output list merely because they round-trip.
"""
from __future__ import annotations

import ast
from pathlib import Path

CURRENT_PRECISION_WORKER_PIN = "precision_worker_one:piton.realization-and-review.v2"
CURRENT_PRECISION_WORKER_OUTPUTS = (
    "exact_brep",
    "inspection_receipt",
    "review_glb",
    "review_glb_receipt",
    "review_selection_map",
    "review_selection_map_receipt",
    "step",
)


def validate_launch_worker_contract(worker_pin: str, outputs: tuple[str, ...]) -> None:
    """Fail closed unless launch assets cover the reviewed v2 seven-role worker."""
    if worker_pin != CURRENT_PRECISION_WORKER_PIN:
        raise ValueError("launch verification precision-worker pin is stale")
    if outputs != CURRENT_PRECISION_WORKER_OUTPUTS:
        raise ValueError("launch verification precision-worker output closure is stale")


def validate_precision_worker_source(path: Path) -> None:
    """Validate worker constants without importing optional CAD dependencies."""
    if not isinstance(path, Path):
        raise TypeError("precision-worker source path must be a Path")
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    names = {"PRECISION_WORKER_PIN", "EXPECTED_OUTPUTS"}
    binding_counts = {name: 0 for name in names}
    for node in ast.walk(tree):
        bound_names: list[str] = []
        if isinstance(node, ast.Name) and isinstance(node.ctx, (ast.Store, ast.Del)):
            bound_names.append(node.id)
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            bound_names.append(node.name)
        elif isinstance(node, ast.alias):
            if node.name == "*":
                bound_names.extend(sorted(names))
            else:
                bound_names.append(node.asname or node.name.split(".", 1)[0])
        elif isinstance(node, ast.ExceptHandler) and node.name:
            bound_names.append(node.name)
        elif isinstance(node, ast.arg):
            bound_names.append(node.arg)
        elif isinstance(node, ast.MatchAs) and node.name:
            bound_names.append(node.name)
        elif isinstance(node, ast.MatchStar) and node.name:
            bound_names.append(node.name)
        elif isinstance(node, ast.MatchMapping) and node.rest:
            bound_names.append(node.rest)
        for name in bound_names:
            if name in names:
                binding_counts[name] += 1
    invalid_bindings = sorted(name for name, count in binding_counts.items() if count != 1)
    if invalid_bindings:
        raise ValueError(
            "precision-worker launch constants must each have one module-level binding: "
            + ", ".join(invalid_bindings)
        )

    literals: dict[str, object] = {}
    for statement in tree.body:
        if isinstance(statement, ast.Assign) and len(statement.targets) == 1:
            target = statement.targets[0]
            if isinstance(target, ast.Name) and target.id in names:
                try:
                    literals[target.id] = ast.literal_eval(statement.value)
                except (TypeError, ValueError) as error:
                    raise ValueError(
                        f"precision-worker launch constant {target.id} is not a literal value"
                    ) from error
    try:
        worker_pin = literals["PRECISION_WORKER_PIN"]
        outputs = literals["EXPECTED_OUTPUTS"]
    except KeyError as error:
        raise ValueError("precision-worker launch constants are missing") from error
    if not isinstance(worker_pin, str) or not isinstance(outputs, tuple):
        raise ValueError("precision-worker launch constants are not literal values")
    validate_launch_worker_contract(worker_pin, outputs)
