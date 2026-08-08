from __future__ import annotations

import json
from pathlib import Path


EVIDENCE_ROOT = Path(__file__).parents[1] / "evidence" / "stage0"
PARTNER_ALPHA_PATH = EVIDENCE_ROOT / "08-partner-alpha" / "partner-alpha.json"


def _reject_duplicate_keys(pairs: list[tuple[str, object]]) -> dict[str, object]:
    record: dict[str, object] = {}
    for key, value in pairs:
        if key in record:
            raise ValueError(f"duplicate JSON key: {key}")
        record[key] = value
    return record


def _reject_non_finite(value: str) -> None:
    raise ValueError(f"non-finite JSON value: {value}")


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


def test_t004_partner_alpha_is_a_deterministic_zero_claim_fixture() -> None:
    raw = PARTNER_ALPHA_PATH.read_text(encoding="utf-8")
    record = json.loads(
        raw,
        object_pairs_hook=_reject_duplicate_keys,
        parse_constant=_reject_non_finite,
    )

    assert raw == json.dumps(record, indent=2, sort_keys=True) + "\n"
    assert record == {
        "claim_scope": "fixture-only",
        "external_thresholds_passed": False,
        "fabrication_release": False,
        "fixture_id": "partner-alpha",
        "machine_actuation": False,
        "review_state": "needs_human_review",
        "scaffold_note": (
            "synthetic placeholder only; no external partner, validation, "
            "commitment, demand, or successor authorization is claimed"
        ),
        "schema": "piton.partner-alpha-fixture.v1",
        "successor_authorized": False,
        "synthetic": True,
        "task_ref": "T004",
    }
