"""
Suitability score and traffic-light summary (Section 7.4).

Also holds the product risk tier (1-5) computed from the replay statistics.
"""
from __future__ import annotations

from typing import List

from app.core.config import get_registration_config, get_suitability_rules
from app.schemas.analysis import MetricsBundle
from app.schemas.suitability import RuleResult, ScoreDriver, SummaryFlags


_WEIGHTS = {
    "R-LOSS": 30,
    "R-HORIZON": 20,
    "R-CONC": 20,
    "R-RISK": 20,
    "R-COMPLEX": 10,
    "R-FX": 0,
    "R-PRICE": 0,
    "R-AGE": 10,
    "R-AFFORD": 15,
    "R-KYC": 0,
    "R-COMPLIANCE": 10,
    "R-LIQ": 10,
}

# Informational rules that deduct a flat number of points when they fire,
# regardless of their computed severity.
_FLAT_RULES = ("R-FX", "R-PRICE", "R-KYC")


def compute_score(rules: List[RuleResult]) -> tuple:
    """
    Returns (score, score_drivers).
    Score: 100 minus weighted penalties. Informational rules (R-FX, R-PRICE,
    R-KYC) use a flat deduction so an incomplete KYC file can never dominate
    the fit of the product itself.
    """
    cfg = get_suitability_rules()
    penalties = cfg["scoring"]
    flat_fx = cfg["rules"]["R-FX"]["flat_penalty"]
    flat_price = cfg["rules"]["R-PRICE"]["flat_penalty"]
    flat_kyc = get_registration_config()["client_thresholds"].get("kyc_flat_penalty", 2)

    flat_map = {"R-FX": flat_fx, "R-PRICE": flat_price, "R-KYC": flat_kyc}

    score = 100.0
    drivers: List[ScoreDriver] = []

    for rule in rules:
        weight = _WEIGHTS.get(rule.rule_id, 0)
        if rule.rule_id in _FLAT_RULES:
            if rule.status != "GREEN":
                deduction = flat_map.get(rule.rule_id, flat_fx)
                score -= deduction
                drivers.append(
                    ScoreDriver(
                        rule_id=rule.rule_id,
                        dimension=rule.dimension,
                        points_deducted=deduction,
                        status=rule.status,
                    )
                )
            continue

        if rule.status == "GREEN":
            continue

        pen = penalties["red_penalty"] if rule.status == "RED" else penalties["amber_penalty"]
        deduction = weight * pen * (0.5 + 0.5 * rule.severity)
        score -= deduction
        drivers.append(
            ScoreDriver(
                rule_id=rule.rule_id,
                dimension=rule.dimension,
                points_deducted=round(deduction, 2),
                status=rule.status,
            )
        )

    score = max(0.0, min(100.0, score))
    drivers.sort(key=lambda d: d.points_deducted, reverse=True)
    return round(score, 2), drivers


_ORDER = {"GREEN": 0, "AMBER": 1, "RED": 2}


def _worst(*statuses: str) -> str:
    return max(statuses, key=_ORDER.get)


def compute_summary_flags(rules: List[RuleResult], metrics: MetricsBundle) -> SummaryFlags:
    """Map rules and metrics to the 7 traffic-light flags."""
    def _status(rule_id: str) -> str:
        for r in rules:
            if r.rule_id == rule_id:
                return r.status
        return "GREEN"

    # p_loss traffic light
    p_loss_val = metrics.replay.p_loss if metrics.replay and metrics.replay.n_windows > 0 else 0.0
    if p_loss_val > 0.30:
        p_loss_flag = "RED"
    elif p_loss_val > 0.15:
        p_loss_flag = "AMBER"
    else:
        p_loss_flag = "GREEN"

    # worst_case: stress_loss_pct
    wc = metrics.stress_loss_pct
    worst_case_flag = "RED" if wc > 0.30 else ("AMBER" if wc > 0.10 else "GREEN")

    # tail_loss: cvar5
    cvar5 = metrics.replay.cvar5_loss_pct if metrics.replay and metrics.replay.n_windows > 0 else metrics.stress_loss_pct
    tail_flag = "RED" if cvar5 > 0.25 else ("AMBER" if cvar5 > 0.10 else "GREEN")

    return SummaryFlags(
        p_loss=p_loss_flag,
        worst_case=worst_case_flag,
        tail_loss=tail_flag,
        horizon=_status("R-HORIZON"),
        concentration=_status("R-CONC"),
        appetite=_status("R-RISK"),
        complexity=_status("R-COMPLEX"),
        life_stage=_status("R-AGE"),
        affordability=_status("R-AFFORD"),
        kyc_aml=_worst(_status("R-KYC"), _status("R-COMPLIANCE")),
    )


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
