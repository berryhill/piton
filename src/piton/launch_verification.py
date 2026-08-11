"""Reviewed launch contract for the current precision-worker closure.

This dependency-free module is the single declarative source for the worker pin
and expected output roles. The precision worker consumes these constants, while
launch scripts compare its effective runtime exports back to this contract.
"""
from __future__ import annotations

CURRENT_PRECISION_WORKER_PIN = "precision_worker_one:piton.realization-and-review.v3"
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
