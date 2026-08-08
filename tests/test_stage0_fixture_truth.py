from __future__ import annotations

import json
from pathlib import Path


EVIDENCE_ROOT = Path(__file__).parents[1] / "evidence" / "stage0"
PARTNER_ALPHA_PATH = EVIDENCE_ROOT / "01-partners" / "partner-alpha.json"


def test_partner_alpha_is_a_deterministic_zero_claim_fixture() -> None:
    raw = PARTNER_ALPHA_PATH.read_text(encoding="utf-8")
    record = json.loads(raw)

    assert raw == json.dumps(record, indent=2, sort_keys=True) + "\n"
    assert record["partner_id"] == "partner-alpha"
    assert record["synthetic"] is True
    assert record["claim_scope"] == "fixture-only"
    assert record["external_thresholds_passed"] is False
    assert record["successor_authorized"] is False
    assert record["fabrication_release"] is False
    assert record["machine_actuation"] is False
    assert record["review_state"] == "needs_human_review"
    assert record["committed"] is False
    assert record["paid"] is False
    assert record["real_models_supplied"] is False
    assert record["real_revisions_supplied"] is False


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
