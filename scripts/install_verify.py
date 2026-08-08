#!/usr/bin/env python3
from __future__ import annotations
import json
from piton.implementation_loop import PITON_IMPLEMENTATION_LOOP
from piton.model import TruthBoundary
from piton.portfolio.partner_scaffold_t001 import (
    PartnerScaffoldT001Receipt,
    validate_partner_scaffold_t001,
)

PITON_IMPLEMENTATION_LOOP.validate()
TruthBoundary().assert_safe()
receipt = PartnerScaffoldT001Receipt()
if not validate_partner_scaffold_t001(receipt):
    raise SystemExit("installed T001 scaffold failed zero-claim validation")
print(
    json.dumps(
        {
            "fabrication_release": receipt.fabrication_release,
            "flow_id": PITON_IMPLEMENTATION_LOOP.flow_id,
            "machine_actuation": receipt.machine_actuation,
            "ok": True,
            "review_state": receipt.review_state,
            "steps": len(PITON_IMPLEMENTATION_LOOP.steps),
            "t001_zero_claim": True,
        },
        sort_keys=True,
    )
)
