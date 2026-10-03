"""
Facts payload builder (Section 10.1).
Assembles the strict JSON of computed facts passed to the LLM.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from app.schemas.analysis import MetricsBundle
from app.schemas.client import ClientProfile
from app.schemas.suitability import SuitabilityResult


def build_payload(
    config: object,
    profile: Optional[ClientProfile],
    metrics: MetricsBundle,
    suitability: Optional[SuitabilityResult],
    data_source: str,
    as_of: str,
    snapshot_id: str,
    run_id: str,
) -> Dict[str, Any]:
    """Return the facts dict that the LLM may cite."""
    replay = metrics.replay
    p_loss = replay.p_loss if replay and replay.n_windows > 0 else None
    cvar5 = replay.cvar5_loss_pct if replay and replay.n_windows > 0 else None
    worst_loss = replay.worst_loss_pct if replay and replay.n_windows > 0 else None
    n_windows = replay.n_windows if replay else 0
    n_independent = replay.n_independent if replay else 0

    payload: Dict[str, Any] = {
        "run_id": run_id,
        "product": config.__dict__ if hasattr(config, "__dict__") else {},
        "metrics": {
            "max_gain_pct": metrics.max_gain_pct,
            "max_loss_pct": metrics.max_loss_pct,
            "stress_loss_pct": metrics.stress_loss_pct,
            "break_even_x": metrics.break_even_x,
            "p_loss": p_loss,
            "cvar5_loss_pct": cvar5,
            "worst_loss_pct": worst_loss,
            "n_windows": n_windows,
            "n_independent": n_independent,
            "median_annualised_return": replay.median_annualised_return if replay and replay.n_windows > 0 else None,
            "fd_baseline_rate_pa": metrics.fd_baseline.rate_pa,
            "fd_baseline_final": metrics.fd_baseline.final,
            "indicative_pa": metrics.pricing.indicative,
            "pricing_flag": metrics.pricing.flag,
            "volatility_ewma": metrics.volatility.ewma,
            "volatility_realised_1y": metrics.volatility.realised_1y,
        },
        "data_source": data_source,
        "as_of": as_of,
        "snapshot_id": snapshot_id,
        "disclaimer": (
            "Illustrative analysis using historical data and statistical models. "
            "Past performance does not predict future results."
        ),
    }

    if profile is not None:
        payload["profile"] = {
            "client_name": profile.client_name,
            "risk_appetite": profile.risk_appetite,
            "horizon_months": profile.horizon_months,
            "loss_tolerance_pct": profile.loss_tolerance_pct,
            "experience": profile.experience,
            "investment_amount": profile.investment_amount,
            "investable_assets": profile.investable_assets,
        }

    if suitability is not None:
        payload["suitability"] = {
            "verdict": suitability.verdict,
            "score": suitability.score,
            "tier": suitability.tier,
            "rules": [
                {
                    "rule_id": r.rule_id,
                    "status": r.status,
                    "message": r.message,
                    "facts": r.facts,
                }
                for r in suitability.rules
            ],
            "mismatches": [
                {
                    "rule_id": r.rule_id,
                    "status": r.status,
                    "message": r.message,
                    "facts": r.facts,
                }
                for r in suitability.mismatches
            ],
        }

    return payload
