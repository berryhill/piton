"""Daemon-owned admission mapping for executable precision-worker bytes."""

from .launch_verification import CURRENT_PRECISION_WORKER_PIN

# This daemon-only table is excluded from child executable bytes, avoiding a
# self-referential digest while binding each symbolic worker pin to reviewed code.
ADMITTED_WORKER_PAYLOADS = {
    CURRENT_PRECISION_WORKER_PIN: "sha256:d7084504f2a57860592f0f8728fc4bf5a813891a5db2a7f85eb63b61c2db5dbf",
}
