"""Daemon-owned admission mapping for executable precision-worker bytes."""

from .launch_verification import CURRENT_PRECISION_WORKER_PIN

# This daemon-only table is excluded from child executable bytes, avoiding a
# self-referential digest while binding each symbolic worker pin to reviewed code.
ADMITTED_WORKER_PAYLOADS = {
    CURRENT_PRECISION_WORKER_PIN: "sha256:23fb1aad60c0806585481f5b77fc0198682bfee4b97a1f0e62f7ba27dd744f86",
}
