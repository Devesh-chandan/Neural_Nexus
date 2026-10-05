"""
Suitability result in the shape the analysis API and UI use (traffic lights, score, tier).

There is ONE decision engine: `app.assessment.unified.assess_product` (the replay-driven rules plus
the profile checks). This module only renders its result as a `SuitabilityResult`:

  assessment check              rule id        status mapping
  risk_appetite                 R-RISK         PASS/REVIEW/FAIL -> GREEN/AMBER/RED
  investment_horizon            R-HORIZON
  loss_tolerance                R-LOSS
  concentration_risk            R-CONC
  compliance gates (4)          R-COMPLIANCE   worst gate
  extra checks (7)              R-COMPLEX, R-AGE, R-AFFORD, R-LIQ, R-FX, R-PRICE, R-KYC

The verdict is the assessment's overall status (any FAIL -> NOT_SUITABLE, any REVIEW ->
CONDITIONALLY_SUITABLE, else SUITABLE); informational checks never change it. Pure Python, no LLM.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from app.assessment.unified import assess_product
from app.schemas.analysis import MetricsBundle
from app.schemas.client import ClientProfile
from app.schemas.suitability import RuleResult, SuitabilityResult
from app.suitability.scoring import compute_score, compute_summary_flags
from app.suitability.scoring import compute_tier

_RULE_STATUS = {"PASS": "GREEN", "REVIEW": "AMBER", "FAIL": "RED"}
_SEVERITY = {"PASS": 0.0, "REVIEW": 0.6, "FAIL": 1.0}
_VERDICT = {"SUITABLE": "SUITABLE", "REVIEW_REQUIRED": "CONDITIONALLY_SUITABLE", "NOT_SUITABLE": "NOT_SUITABLE"}
_CORE = (
    ("risk_appetite", "R-RISK", "risk_appetite"),
    ("investment_horizon", "R-HORIZON", "horizon"),
    ("loss_tolerance", "R-LOSS", "loss_tolerance"),
    ("concentration_risk", "R-CONC", "concentration"),
)
_ORDER = {"PASS": 0, "REVIEW": 1, "FAIL": 2}


def _rule_from_check(rule_id: str, dimension: str, key: str, check: Dict[str, Any]) -> RuleResult:
    status = check["status"]
    return RuleResult(
        rule_id=rule_id, dimension=dimension, status=_RULE_STATUS[status],
        severity=_SEVERITY[status], message_key=f"{rule_id.lower()}_{status.lower()}",
        message=check["reason"], facts={k: v for k, v in check.items() if k not in ("reason",)},
    )


def _compliance_rule(flags: Dict[str, Dict[str, str]]) -> RuleResult:
    worst = max((f["status"] for f in flags.values()), key=_ORDER.get)
    problems = [f["reason"] for f in flags.values() if f["status"] != "PASS"]
    return RuleResult(
        rule_id="R-COMPLIANCE", dimension="compliance", status=_RULE_STATUS[worst],
        severity=_SEVERITY[worst], message_key=f"r-compliance_{worst.lower()}",
        message=" ".join(problems) if problems else "All compliance gates passed.",
        facts={name: f["status"] for name, f in flags.items()},
    )


def to_suitability_result(outcome: Dict[str, Any], metrics: MetricsBundle) -> SuitabilityResult:
    assessment = outcome["assessment"]
    rules: List[RuleResult] = [
        _rule_from_check(rid, dim, key, assessment["checks"][key]) for key, rid, dim in _CORE
    ]
    rules.append(_compliance_rule(assessment["compliance_flags"]))
    rules.extend(outcome["extras"])

    score, drivers = compute_score(rules)
    mismatches = [r for r in rules if r.status in ("RED", "AMBER") and r.rule_id not in ("R-FX", "R-PRICE", "R-KYC")]
    mismatches.sort(key=lambda r: (0 if r.status == "RED" else 1, -r.severity))
    return SuitabilityResult(
        verdict=_VERDICT[assessment["overall_status"]],
        score=score,
        score_drivers=drivers,
        rules=rules,
        tier=compute_tier(metrics),
        mismatches=mismatches,
        summary_flags=compute_summary_flags(rules, metrics),
        assessment=assessment,
    )


def evaluate_suitability(
    config: object,
    profile: ClientProfile,
    metrics: MetricsBundle,
    *,
    meta: Optional[Dict[str, Any]] = None,
    simulation: Optional[Dict[str, Any]] = None,
    raw_client: Optional[Dict[str, Any]] = None,
) -> SuitabilityResult:
    """Main entry point of the analysis API's suitability engine (see module docstring).

    `meta` is the client's compliance screening (None = none on file, which the rules treat as
    REVIEW); `simulation` is the real replay result when the caller has it.
    """
    outcome = assess_product(config, profile, metrics, meta=meta, simulation=simulation, raw_client=raw_client)
    return to_suitability_result(outcome, metrics)
