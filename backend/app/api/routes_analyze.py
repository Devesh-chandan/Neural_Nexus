"""
POST /api/analyze – main analysis endpoint.
POST /api/suitability – fast suitability-only (for live slider updates).
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter, Request
from pydantic import BaseModel, ValidationError

from app.analytics.metrics import compute_metrics
from app.assessment.service import case_compliance_meta
from app.api.routes_cases import _ensure_case_access
from app.core.errors import AppError
from app.assessment.redact import is_rm, redact_explanation, redact_suitability
from app.assessment.unified import assess_product, synthetic_simulation
from app.explain.engine import explain_assessment
from app.market.fx import inr_rate
from app.market.service import get_history
from app.schemas.client import ClientProfile
from app.schemas.product import parse_product_dict
from app.store.audit import append_audit
from app.store.cases import get_case
from app.store.db import init_db
from app.simulation.service import simulate_product
from app.store.runs import generate_run_id, save_run
from app.suitability.engine import evaluate_suitability, to_suitability_result

logger = logging.getLogger(__name__)
router = APIRouter(tags=["analysis"])

DISCLAIMER = (
    "Illustrative analysis using historical data and statistical models. "
    "Past performance does not predict future results. Issuer credit risk is shown only as a generic "
    "illustrative assumption and liquidity risk is not modelled. This is a decision-support tool and not "
    "investment advice; suitability must be confirmed by a qualified person."
)


class AnalyzeRequest(BaseModel):
    product: Dict[str, Any]
    profile: Optional[Dict[str, Any]] = None
    include_monte_carlo: bool = False
    case_id: Optional[str] = None
    # Read-only views (e.g. the client portal re-showing a recommendation) skip the
    # run/audit write; analyses an RM acts on are always persisted.
    persist: bool = True


class SuitabilityOnlyRequest(BaseModel):
    product: Dict[str, Any]
    profile: Dict[str, Any]


def _parse_product(data: Dict[str, Any]) -> object:
    try:
        return parse_product_dict(data)
    except (ValueError, ValidationError) as exc:
        raise AppError(422, "VALIDATION_ERROR", str(exc))


@router.post("/analyze")
def analyze(req: AnalyzeRequest, request: Request) -> Dict[str, Any]:
    init_db()
    case = None
    if req.case_id:
        case = get_case(req.case_id)
        if case is None:
            raise AppError(404, "CASE_NOT_FOUND", "Case not found.")
        _ensure_case_access(case, request.state.user)

    config = _parse_product(req.product)

    underlying_key = config.underlying  # type: ignore[attr-defined]
    try:
        df, source, as_of, snap = get_history(underlying_key)
    except ValueError as exc:
        raise AppError(404, "DATA_NOT_FOUND", str(exc))

    metrics = compute_metrics(config, df["close"], include_monte_carlo=req.include_monte_carlo)
    fx = inr_rate(config.currency)  # type: ignore[attr-defined]

    profile: Optional[ClientProfile] = None
    suitability = None
    if req.profile:
        try:
            profile = ClientProfile(**req.profile)
        except Exception as exc:
            raise AppError(422, "VALIDATION_ERROR", f"Invalid profile: {exc}")
        # The amount assessed is this product's principal, in INR.
        profile = profile.model_copy(update={"investment_amount": config.principal * fx.inr_per_unit})  # type: ignore[attr-defined]
        # The same real replay /api/assess runs; if it cannot run, the window statistics (identical
        # windows and formulas) supply the worst period instead.
        try:
            simulation = simulate_product(config.model_dump(mode="json"))  # type: ignore[attr-defined]
        except AppError as exc:
            logger.warning("Replay unavailable for suitability, using window statistics: %s", exc.message)
            simulation = None
        outcome = assess_product(config, profile, metrics, meta=case_compliance_meta(case),
                                 simulation=simulation)
        suitability = to_suitability_result(outcome, metrics)

    run_id = generate_run_id()
    explanation = None
    if profile and suitability:
        # The same explainer /api/assess uses, fed with the same assessment.
        explanation = explain_assessment(
            outcome["assessment"], simulation or synthetic_simulation(config, metrics), outcome["client"],
            outcome["data_gaps"], metrics=metrics, suitability=suitability)

    response: Dict[str, Any] = {
        "run_id": run_id if req.persist else None,
        "metrics": metrics.model_dump(),
        "data_source": source,
        "as_of": as_of,
        "snapshot_id": snap,
        "product": config.model_dump(mode="json"),  # type: ignore[attr-defined]
        "principal_inr": round(config.principal * fx.inr_per_unit, 2),  # type: ignore[attr-defined]
        "fx": fx.as_dict(),
        "disclaimer": DISCLAIMER,
    }
    # Clients get a redacted view of the response; the persisted run keeps the full detail.
    client_view = not is_rm(request.state.user)
    if suitability:
        full = suitability.model_dump()
        response["suitability"] = redact_suitability(full) if client_view else full
    if explanation:
        response["explanation"] = redact_explanation(explanation) if client_view else explanation
    if not req.persist:
        return response

    # Persist
    save_run(
        run_id=run_id,
        case_id=req.case_id,
        product_json=config.__dict__,
        metrics_json=metrics.model_dump(),
        suitability_json=suitability.model_dump() if suitability else None,
        explanation_json=explanation,
        data_source=source,
        as_of=as_of,
        snapshot_id=snap,
    )

    # Append audit if complete analysis
    if suitability and explanation:
        audit_payload = {
            "run_id": run_id,
            "product": config.__dict__,
            "profile": profile.model_dump() if profile else None,
            "metrics_digest": {
                "max_gain_pct": metrics.max_gain_pct,
                "max_loss_pct": metrics.max_loss_pct,
                "stress_loss_pct": metrics.stress_loss_pct,
            },
            "verdict": suitability.verdict,
            "explanation_source": explanation["source"],
            "snapshot_id": snap,
        }
        append_audit(
            run_id=run_id,
            payload=audit_payload,
            verdict=suitability.verdict,
            data_source=source,
            snapshot_id=snap,
            model=explanation["model"],
            prompt_version=explanation["prompt_version"],
        )

    return response


@router.post("/suitability")
def suitability_only(req: SuitabilityOnlyRequest, request: Request) -> Dict[str, Any]:
    """Fast suitability check – reuses cached history, no persistence."""
    config = _parse_product(req.product)

    try:
        profile = ClientProfile(**req.profile)
    except Exception as exc:
        raise AppError(422, "VALIDATION_ERROR", str(exc))

    underlying_key = config.underlying  # type: ignore[attr-defined]
    try:
        df, source, as_of, snap = get_history(underlying_key)
    except ValueError as exc:
        raise AppError(404, "DATA_NOT_FOUND", str(exc))

    metrics = compute_metrics(config, df["close"], include_monte_carlo=False)
    suitability = evaluate_suitability(config, profile, metrics)

    full = suitability.model_dump()
    return {
        "suitability": full if is_rm(request.state.user) else redact_suitability(full),
        "data_source": source,
        "as_of": as_of,
        "snapshot_id": snap,
    }
