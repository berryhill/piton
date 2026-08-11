"""Daemon-owned admission mapping for executable precision-worker bytes."""

from .launch_verification import CURRENT_PRECISION_WORKER_PIN

# This daemon-only table is excluded from child executable bytes, avoiding a
# self-referential digest while binding each symbolic worker pin to reviewed code.
ADMITTED_WORKER_PAYLOADS = {
    CURRENT_PRECISION_WORKER_PIN: "sha256:b416c8c5418c2abaf6e4a8848b791fc396274db326719856790d6276da661f0b",
}
