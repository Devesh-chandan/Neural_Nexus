"""Replay a product historically, then assess it against one client.

The client record comes from the case store. Seeded clients keep the full
clients_india.json record (including `_meta` compliance flags) in `profile_json`, which is
exactly what the rules engine expects. Cases created through the questionnaire hold a normalised
ClientProfile instead; those are mapped onto the rules-engine shape here, and any compliance
data they lack is reported in `data_gaps` rather than silently assumed clean.
"""
from __future__ import annotations

import json
from typing import Any, Dict, List, Optional, Tuple

import logging

from pydantic import ValidationError

from app.analytics.metrics import compute_metrics
from app.explain.engine import explain_assessment
from app.assessment.unified import assess_product
from app.core.errors import AppError
from app.market.service import get_history
from app.schemas.client import ClientProfile
from app.schemas.product import parse_product_dict
from app.simulation.service import HistoryUntil, simulate_product
from app.store.cases import normalize_profile

logger = logging.getLogger(__name__)


def case_compliance_meta(case: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Compliance screening (`_meta`) held in the case's client record; None when none is on file."""
    if not case:
        return None
    raw = case.get("profile_json") or {}
    if isinstance(raw, str):
        raw = json.loads(raw)
    return raw.get("_meta") if isinstance(raw, dict) and "suitability_profile" in raw else None


def case_profile(case: Dict[str, Any]) -> Optional[ClientProfile]:
    """The case's client as a flat ClientProfile, or None if its record is incomplete."""
    raw = case.get("profile_json") or {}
    if isinstance(raw, str):
        raw = json.loads(raw)
    flat = normalize_profile(raw, case.get("client_name") or "")
    try:
        return ClientProfile(**flat)
    except (ValidationError, TypeError):
        return None


def to_rules_client(case: Dict[str, Any]) -> Tuple[Dict[str, Any], List[str]]:
    """Return (client record in clients_india.json shape, data_gaps)."""
    profile = case.get("profile_json") or {}
    if isinstance(profile, str):
        profile = json.loads(profile)

    if "suitability_profile" in profile:
        client = {k: v for k, v in profile.items() if k != "credentials"}
        client["client_id"] = client.get("client_id") or case["case_id"]
        return client, []

    # Normalised ClientProfile (app.schemas.client): percentages are always 0-100 here,
    # the rules engine expects fractions.
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
        # No AML screening on file: an unknown level makes the rules engine's AML gate return REVIEW.
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
    client, data_gaps = to_rules_client(case)
    simulation = simulate_product(product, history_until)
    try:
        config = parse_product_dict(product)
    except Exception as exc:
        raise AppError(422, "VALIDATION_ERROR", str(exc))

    # Flat profile for the extra checks (complexity, age, affordability, ...). A record that cannot
    # be expressed as one still gets the core assessment; the gap is reported, not hidden.
    profile = case_profile(case)
    if profile is None:
        data_gaps = data_gaps + ["Client record could not be read as a full profile; complexity, "
                                 "life-stage, affordability and liquidity checks were skipped."]
    # Indicative-pricing note only (informational); market data trouble must not block the assessment.
    metrics = None
    try:
        df, *_ = get_history(config.underlying)  # type: ignore[attr-defined]
        metrics = compute_metrics(config, df["close"], include_monte_carlo=False)
    except Exception:
        logger.warning("Pricing note skipped for %s", getattr(config, "underlying", "?"))

    try:
        outcome = assess_product(config, profile, metrics, raw_client=client, simulation=simulation)
    except (KeyError, TypeError, ValueError) as exc:
        raise AppError(422, "ASSESSMENT_FAILED", f"Suitability could not be assessed: {exc}")
    assessment, client = outcome["assessment"], outcome["client"]
    explanation = explain_assessment(assessment, simulation, client, data_gaps, metrics=metrics) if explain else None
    return {"assessment": assessment, "simulation": simulation, "data_gaps": data_gaps,
            "explanation": explanation, "fx": outcome["fx"].as_dict()}
