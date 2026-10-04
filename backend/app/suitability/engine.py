"""
Suitability engine orchestrator (Section 7.4).

Deterministic: no LLM. Output schema: SuitabilityResult.
"""
from __future__ import annotations

from app.market.fx import principal_in_inr
from app.schemas.analysis import MetricsBundle
from app.schemas.client import ClientProfile
from app.schemas.suitability import SuitabilityResult
from app.suitability.rules import evaluate_all_rules
from app.suitability.scoring import compute_score, compute_summary_flags
from app.suitability.tiers import compute_tier


def evaluate_suitability(
    config: object,
    profile: ClientProfile,
    metrics: MetricsBundle,
) -> SuitabilityResult:
    """
    Main entry point for the suitability engine.
    Returns a fully populated SuitabilityResult. Pure Python, no LLM.

    The amount being assessed is the product's principal, converted to INR so it
    is comparable with the client's INR net worth and income.
    """
    profile = profile.model_copy(update={"investment_amount": principal_in_inr(config)})
    tier = compute_tier(metrics)
    rules = evaluate_all_rules(config, profile, metrics, tier)

    # Verdict: any RED → NOT_SUITABLE; any AMBER → CONDITIONALLY_SUITABLE; else SUITABLE
    statuses = [r.status for r in rules]
    if "RED" in statuses:
        verdict = "NOT_SUITABLE"
    elif "AMBER" in statuses:
        verdict = "CONDITIONALLY_SUITABLE"
    else:
        verdict = "SUITABLE"

    score, score_drivers = compute_score(rules)
    summary_flags = compute_summary_flags(rules, metrics)
    mismatches = [r for r in rules if r.status in ("RED", "AMBER")]
    mismatches.sort(key=lambda r: (0 if r.status == "RED" else 1, -r.severity))

    return SuitabilityResult(
        verdict=verdict,
        score=score,
        score_drivers=score_drivers,
        rules=rules,
        tier=tier,
        mismatches=mismatches,
        summary_flags=summary_flags,
    )
