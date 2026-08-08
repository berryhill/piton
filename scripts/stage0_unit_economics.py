def managed_gross_margin(record: dict[str, float]) -> float:
    revenue = record["recognized_revenue_usd"]
    assert revenue > 0
    cogs = (
        record["compute_usd"] + record["storage_usd"] +
        record["support_labor_usd"] + record["amortized_onboarding_labor_usd"] +
        record["third_party_fees_usd"]
    )
    return 100.0 * (revenue - cogs) / revenue

def commercial_pass(record: dict[str, float]) -> bool:
    return managed_gross_margin(record) > 50.0 and record["support_hours_per_org_month"] <= 2.0
