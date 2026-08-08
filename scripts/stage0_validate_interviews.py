from pathlib import Path
import json

def validate_interviews(root: Path) -> dict[str, int]:
    rows = [json.loads(path.read_text()) for path in sorted(root.glob("int_*/coded.json"))]
    assert len(rows) >= 12
    assert len({row["segment_id"] for row in rows}) == 1
    assert all(row["consent_ref"].startswith("protected:") for row in rows)
    assert all(row["authority_fit"] in {
        "accepts_source_native", "requires_incumbent_authority", "unknown"
    } for row in rows)
    assert sum(row["jobs_per_month"] >= 2 for row in rows) >= 8
    assert max(sum(row["org_id"] == org for row in rows) for org in {r["org_id"] for r in rows}) <= 2
    return {"interviews": len(rows), "repeated_jobs": sum(r["jobs_per_month"] >= 2 for r in rows)}

if __name__ == "__main__":
    print(validate_interviews(Path("evidence/stage0/02-interviews")))
