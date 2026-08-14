"""Daemon-owned admission mapping for executable precision-worker bytes."""

from .launch_verification import CURRENT_PRECISION_WORKER_PIN

# This daemon-only table is excluded from child executable bytes, avoiding a
# self-referential digest while binding each symbolic worker pin to reviewed code.
ADMITTED_WORKER_PAYLOADS = {
    CURRENT_PRECISION_WORKER_PIN: "sha256:f0ee0671b54c7416fc27a7a71af1a4c11c9e5fd1a1723df6f69a7538a5894b58",
}
