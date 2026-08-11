#!/usr/bin/env python3
"""Fail-closed offline verification of one serialized portfolio exit receipt.

Trusted durable human authorization issuance and verification are not
implemented in this Stage-1 slice. This command diagnoses evidence and denies
all human-authority advancement; serialized claims and caller-created review
evidence can never supply authority.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from piton.portfolio import Phase, PhaseExitReceipt, verify_successor_admission


def _load(path: pathlib.Path) -> PhaseExitReceipt:
    return PhaseExitReceipt.from_dict(json.loads(path.read_text(encoding="utf-8")))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("receipt", type=pathlib.Path)
    parser.add_argument("successor", choices=[phase.value for phase in Phase])
    parser.add_argument(
        "--predecessor",
        type=pathlib.Path,
        help="exact predecessor receipt (required when the exiting phase is not P0)",
    )
    args = parser.parse_args(argv)
    try:
        receipt = _load(args.receipt)
        predecessor = _load(args.predecessor) if args.predecessor else None
        decision = verify_successor_admission(
            receipt, successor=Phase(args.successor), predecessor=predecessor
        )
    except (OSError, json.JSONDecodeError, TypeError, ValueError) as exc:
        print(f"DENY: invalid portfolio receipt: {exc}")
        return 1
    if not decision.admitted:
        print("DENY: " + "; ".join(decision.reasons))
        return 1
    print(
        f"ADMIT: receipt {decision.receipt_id} authorizes immediate successor "
        f"{decision.successor.value}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
