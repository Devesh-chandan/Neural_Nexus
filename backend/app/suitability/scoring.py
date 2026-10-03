"""
Suitability score and traffic-light summary (Section 7.4).
"""
from __future__ import annotations

from typing import List

from app.core.config import get_suitability_rules
from app.schemas.analysis import MetricsBundle
from app.schemas.client import ClientProfile
from app.schemas.suitability import RuleResult, ScoreDriver, SummaryFlags


_WEIGHTS = {
    "R-LOSS": 30,
    "R-HORIZON": 20,
    "R-CONC": 20,
    "R-RISK": 20,
    "R-COMPLEX": 10,
    "R-FX": 0,
    "R-PRICE": 0,
}


def compute_score(rules: List[RuleResult]) -> tuple:
    """
    Returns (score, score_drivers).
    Score: 100 minus weighted penalties. R-FX/R-PRICE use flat deduction.
    """
    cfg = get_suitability_rules()
    penalties = cfg["scoring"]
    flat_fx = cfg["rules"]["R-FX"]["flat_penalty"]
    flat_price = cfg["rules"]["R-PRICE"]["flat_penalty"]

    score = 100.0
    drivers: List[ScoreDriver] = []

    for rule in rules:
        weight = _WEIGHTS.get(rule.rule_id, 0)
        if rule.rule_id in ("R-FX", "R-PRICE"):
            if rule.status != "GREEN":
                deduction = flat_fx if rule.rule_id == "R-FX" else flat_price
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
    )
