"""The one suitability decision path.

Every endpoint that returns a suitability verdict (`/api/assess`, `/api/analyze`, `/api/suitability`,
`/api/recommend`, `/api/fixit`) goes through `assess_product`, so the same client and the same
product always get the same verdict:

  core rules   (`rules_engine`)  risk appetite, horizon, loss tolerance, concentration, compliance
                                 gates, all driven by the historical replay;
  extra checks (`extra_checks`)  complexity, life stage, affordability, liquidity (decisive) and
                                 currency / pricing / KYC-data notes (informational).

The loss-tolerance and risk-appetite rules read the WORST period of the replay. The 20-scenario
replay always contains the worst period among all historical windows, and the window statistics in
`app.analytics.replay` use identical windows and payoff formulas, so when a full replay result is
not at hand the worst period is taken from those statistics (`synthetic_simulation`); a test pins
the two to be equal.
"""
from __future__ import annotations

import copy
from typing import Any, Dict, List, Optional, Tuple

from app.assessment.extra_checks import INFORMATIONAL, evaluate_extras
from app.assessment.rules_engine import SuitabilityEngine
from app.market.fx import inr_rate
from app.schemas.analysis import MetricsBundle
from app.schemas.client import ClientProfile
from app.schemas.suitability import RuleResult
from app.simulation.adapter import to_sim_engine_payload

_engine = SuitabilityEngine()

STATUS = {"GREEN": "PASS", "AMBER": "REVIEW", "RED": "FAIL"}

NO_SCREENING_GAP = (
    "Client profile has no KYC compliance screening (AML, FATCA, vulnerability, profile "
    "freshness); the AML gate is set to REVIEW until screening is on file."
)

# Name of each extra check in the assessment contract, by rule id.
EXTRA_NAMES = {
    "R-COMPLEX": "product_complexity",
    "R-AGE": "life_stage",
    "R-AFFORD": "affordability",
    "R-LIQ": "liquidity",
    "R-FX": "currency_risk",
    "R-PRICE": "pricing_sanity",
    "R-KYC": "kyc_data",
}


def client_from_profile(profile: ClientProfile, meta: Optional[Dict[str, Any]] = None,
                        client_id: str = "profile") -> Tuple[Dict[str, Any], List[str]]:
    """Client record in the rules engine's shape from a flat profile. Returns (client, data_gaps).

    Without compliance screening (`meta` is None) the AML level is UNKNOWN, which the rules engine
    treats as REVIEW: nothing is silently assumed clean.
    """
    lnw = profile.liquid_net_worth or profile.investable_assets
    client = {
        "client_id": client_id,
        "financial_information": {"liquid_net_worth_inr": lnw},
        "suitability_profile": {
            "risk_appetite": str(profile.risk_appetite or "").upper(),
            "investment_horizon_years": float(profile.horizon_months or 0) / 12.0,
            "loss_tolerance_pct": float(profile.loss_tolerance_pct or 0) / 100.0,
            "current_portfolio_concentration_pct": float(profile.existing_exposure_underlying_pct or 0) / 100.0,
        },
        "_meta": copy.deepcopy(meta) if meta is not None else {"aml_risk": "UNKNOWN"},
    }
    return client, ([] if meta is not None else [NO_SCREENING_GAP])


def replay_worst_return_pct(metrics: MetricsBundle) -> float:
    """Worst replay period's return in percent (e.g. -18.4), from the window statistics."""
    r = metrics.replay
    if r is not None and r.n_windows > 0:
        if r.worst_return_pct is not None:
            return r.worst_return_pct * 100.0
        return -r.worst_loss_pct * 100.0
    return -metrics.stress_loss_pct * 100.0   # no usable history: the stress shock is all we have


def synthetic_simulation(config: object, metrics: MetricsBundle) -> Dict[str, Any]:
    """Minimal replay-shaped result carrying exactly what the rules read (product + worst return)."""
    payload = to_sim_engine_payload(config)  # type: ignore[arg-type]
    return {
        "product_id": "metrics-derived",
        "run_id": "metrics-derived",
        "audit": {"product": payload},
        "scenarios": [{"return_pct": replay_worst_return_pct(metrics)}],
    }


def _as_check(rule: RuleResult) -> Dict[str, Any]:
    return {
        "status": STATUS[rule.status],
        "reason": rule.message,
        "informational": rule.rule_id in INFORMATIONAL,
        "rule_id": rule.rule_id,
        "severity": rule.severity,
        "facts": rule.facts,
    }


def assess_product(
    config: object,
    profile: Optional[ClientProfile],
    metrics: Optional[MetricsBundle],
    *,
    meta: Optional[Dict[str, Any]] = None,
    raw_client: Optional[Dict[str, Any]] = None,
    simulation: Optional[Dict[str, Any]] = None,
    data_gaps: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Run the full suitability decision. Returns {assessment, extras, data_gaps, fx}.

    profile      flat client profile (used for the extra checks and, unless raw_client is given,
                 for the core rules);
    meta         compliance screening (`_meta` of the client record); None = no screening on file;
    raw_client   a full client record (clients_india.json shape) to feed the core rules unchanged;
    simulation   the real 20-scenario replay; if omitted the worst period is taken from `metrics`.
    """
    fx = inr_rate(config.currency)  # type: ignore[attr-defined]
    if profile is not None:
        profile = profile.model_copy(update={"investment_amount": config.principal * fx.inr_per_unit})  # type: ignore[attr-defined]

    if raw_client is not None:
        client = copy.deepcopy(raw_client)
        gaps = list(data_gaps or [])
    else:
        if profile is None:
            raise ValueError("assess_product needs a profile or a raw client record.")
        client, gaps = client_from_profile(profile, meta)
        gaps = gaps + list(data_gaps or [])

    # The rules compare the product notional with liquid net worth, so both must be in one currency.
    if fx.currency != "INR":
        fin = dict(client.get("financial_information") or {})
        lnw_inr = fin.get("liquid_net_worth_inr")
        if lnw_inr:
            fin["liquid_net_worth_inr"] = float(lnw_inr) / fx.inr_per_unit
        client = {**client, "financial_information": fin}

    if simulation is None:
        if metrics is None:
            raise ValueError("assess_product needs either a replay result or metrics.")
        simulation = synthetic_simulation(config, metrics)

    extras = evaluate_extras(config, profile, metrics) if profile is not None else []
    additional = {EXTRA_NAMES[r.rule_id]: _as_check(r) for r in extras}
    assessment = _engine.run_assessment(client, simulation, additional)
    return {"assessment": assessment, "extras": extras, "data_gaps": gaps, "fx": fx, "client": client}
