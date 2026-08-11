"""Daemon-owned admission mapping for executable precision-worker bytes."""

from .launch_verification import CURRENT_PRECISION_WORKER_PIN

# This daemon-only table is excluded from child executable bytes, avoiding a
# self-referential digest while binding each symbolic worker pin to reviewed code.
ADMITTED_WORKER_PAYLOADS = {
    CURRENT_PRECISION_WORKER_PIN: "sha256:6ede0d402a84af0de2e4927d86db59aa96778eaff98ba89d863aa3fe7883fc15",
}
