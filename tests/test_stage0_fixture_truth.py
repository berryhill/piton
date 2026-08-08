from __future__ import annotations

import json
from pathlib import Path


EVIDENCE_ROOT = Path(__file__).parents[1] / "evidence" / "stage0"


def test_stage0_scaffold_records_are_explicit_non_evidence_fixtures() -> None:
    scaffold_records = []
    for path in sorted(EVIDENCE_ROOT.rglob("*.json")):
        record = json.loads(path.read_text(encoding="utf-8"))
        encoded = json.dumps(record).lower()
        if "scaffold" in encoded or "placeholder" in encoded:
            scaffold_records.append(path)
            assert record.get("synthetic") is True, path
            assert record.get("claim_scope") == "fixture-only", path
            assert record.get("external_thresholds_passed") is False, path
            assert record.get("successor_authorized") is False, path
            assert record.get("fabrication_release") is False, path
            assert record.get("machine_actuation") is False, path

    assert scaffold_records, "expected explicit Stage 0 scaffold fixtures"
