"""
Product risk tier calculation (Section 7.1).

tier 1: max_loss_pct == 0
tier 2: cvar5 <= t2_cvar AND p_loss <= t2_p_loss
tier 3: cvar5 <= t3_cvar
tier 4: cvar5 <= t4_cvar
tier 5: else
Uses replay CVaR; falls back to stress_loss if replay unavailable.
"""
from __future__ import annotations

from app.core.config import get_suitability_rules
from app.schemas.analysis import MetricsBundle


def compute_tier(metrics: MetricsBundle) -> int:
    cfg = get_suitability_rules()
    thresholds = cfg["tier_thresholds"]

    if metrics.max_loss_pct == 0.0:
        return 1

    # Get CVaR and p_loss from replay; fall back to stress_loss
    if metrics.replay and metrics.replay.n_windows > 0:
        cvar5 = metrics.replay.cvar5_loss_pct
        p_loss = metrics.replay.p_loss
    else:
        # Use stress_loss as proxy
        cvar5 = metrics.stress_loss_pct
        p_loss = 1.0 if metrics.stress_loss_pct > 0 else 0.0

    if cvar5 <= thresholds["t2_cvar"] and p_loss <= thresholds["t2_p_loss"]:
        return 2
    if cvar5 <= thresholds["t3_cvar"]:
        return 3
    if cvar5 <= thresholds["t4_cvar"]:
        return 4
    return 5
