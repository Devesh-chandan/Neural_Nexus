"""Module 2 -> Module 3: replay a product historically, then assess it against one client.

The client record comes from the case store. Seeded clients keep the full
clients_india.json record (including `_meta` compliance flags) in `profile_json`, which is
exactly what module3 expects. Cases created through the questionnaire hold a normalised
ClientProfile instead; those are mapped onto the module3 shape here, and any compliance
data they lack is reported in `data_gaps` rather than silently assumed clean.
"""
from __future__ import annotations

import json
from typing import Any, Dict, List, Tuple

from app.assessment.bridge import SuitabilityEngine
from app.assessment.explain import explain_assessment
from app.core.errors import AppError
from app.market.fx import HOME_CURRENCY, inr_rate
from app.simulation.service import HistoryUntil, simulate_product

_engine = SuitabilityEngine()


def to_module3_client(case: Dict[str, Any]) -> Tuple[Dict[str, Any], List[str]]:
    """Return (client record in clients_india.json shape, data_gaps)."""
    profile = case.get("profile_json") or {}
    if isinstance(profile, str):
        profile = json.loads(profile)

    if "suitability_profile" in profile:
        client = {k: v for k, v in profile.items() if k != "credentials"}
        client["client_id"] = client.get("client_id") or case["case_id"]
        return client, []

    # Normalised ClientProfile (app.schemas.client): percentages are always 0-100 here,
    # module3 expects fractions.
    lnw = profile.get("liquid_net_worth") or profile.get("investable_assets") or 0
    client = {
        "client_id": case["case_id"],
        "financial_information": {"liquid_net_worth_inr": lnw},
        "suitability_profile": {
            "risk_appetite": str(profile.get("risk_appetite") or "").upper(),
            "investment_horizon_years": float(profile.get("horizon_months") or 0) / 12.0,
            "loss_tolerance_pct": float(profile.get("loss_tolerance_pct") or 0) / 100.0,
            "current_portfolio_concentration_pct": float(profile.get("existing_exposure_underlying_pct") or 0) / 100.0,
        },
        # No AML screening on file: an unknown level makes module3's AML gate return REVIEW.
        "_meta": {"aml_risk": "UNKNOWN"},
    }
    gaps = [
        "Client profile has no KYC compliance screening (AML, FATCA, vulnerability, profile "
        "freshness); the AML gate is set to REVIEW until screening is on file."
    ]
    return client, gaps


def assess_case(
    case: Dict[str, Any],
    product: Dict[str, Any],
    history_until: HistoryUntil = "latest",
    explain: bool = True,
) -> Dict[str, Any]:
    if "enc:" in str(case.get("profile_json")):
        raise AppError(
            422, "PROFILE_UNREADABLE",
            "This client's profile holds encrypted values from an older version of the app and "
            "cannot be read. Re-register the client or remove this record.",
        )
    client, data_gaps = to_module3_client(case)
    simulation = simulate_product(product, history_until)

    # module3 compares the product notional with liquid net worth, so both must be in
    # the same currency: restate the client's INR net worth in the product currency.
    fx = inr_rate(simulation.get("currency") or HOME_CURRENCY)
    if fx.currency != HOME_CURRENCY:
        fin = dict(client.get("financial_information") or {})
        lnw_inr = fin.get("liquid_net_worth_inr")
        if lnw_inr:
            fin["liquid_net_worth_inr"] = float(lnw_inr) / fx.inr_per_unit
        client = {**client, "financial_information": fin}

    try:
        assessment = _engine.run_assessment(client, simulation)
    except (KeyError, TypeError, ValueError) as exc:
        raise AppError(422, "ASSESSMENT_FAILED", f"Suitability could not be assessed: {exc}")
    explanation = explain_assessment(assessment, simulation, client, data_gaps) if explain else None
    return {"assessment": assessment, "simulation": simulation, "data_gaps": data_gaps,
            "explanation": explanation, "fx": fx.as_dict()}
