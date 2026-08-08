WEIGHTS = {
    "target_job_fit": 15, "review_effort_reduction": 15,
    "escaped_change_reduction": 10, "single_authority": 10,
    "local_offline_custody": 10, "exact_brep_step": 10,
    "evidence_binding": 10, "adoption_burden": 8,
    "security_distribution": 5, "support_economics": 5,
    "reversibility": 2,
}

def weighted_total(criteria: dict[str, int | None]) -> float:
    assert set(criteria) == set(WEIGHTS)
    assert all(score is None or 0 <= score <= 5 for score in criteria.values())
    return sum(WEIGHTS[name] * (score or 0) / 5 for name, score in criteria.items())

def category(piton: float, best_alternative: float, lower_risk_alternative: bool) -> str:
    if lower_risk_alternative and piton - best_alternative < 15:
        return "pass_integrate"
    return "pass_build" if piton - best_alternative >= 15 else "narrow_generation_review"
