#!/usr/bin/env python3
from __future__ import annotations
import json
from piton.implementation_loop import PITON_IMPLEMENTATION_LOOP
from piton.model import TruthBoundary
PITON_IMPLEMENTATION_LOOP.validate()
TruthBoundary().assert_safe()
print(json.dumps({"ok":True,"flow_id":PITON_IMPLEMENTATION_LOOP.flow_id,"steps":len(PITON_IMPLEMENTATION_LOOP.steps),"fabrication_release":False},sort_keys=True))
