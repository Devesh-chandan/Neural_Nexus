"""
POST /api/analyze – main analysis endpoint.
POST /api/suitability – fast suitability-only (for live slider updates).
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter
from pydantic import BaseModel

from app.analytics.metrics import compute_metrics
from app.core.errors import AppError
from app.explain.payload import build_payload
from app.explain.service import generate_explanation
from app.market.service import get_history
from app.schemas.analysis import AnalyzeResponse
from app.schemas.client import ClientProfile
from app.schemas.product import CPNConfig, DCDConfig, ELNConfig
from app.store.audit import append_audit
from app.store.db import init_db
from app.store.runs import generate_run_id, save_run
from app.suitability.engine import evaluate_suitability

logger = logging.getLogger(__name__)
router = APIRouter(tags=["analysis"])

DISCLAIMER = (
    "Illustrative analysis using historical data and statistical models. "
    "Past performance does not predict future results. Issuer credit risk and "
    "liquidity risk are not modelled. This is a decision-support tool and not "
    "investment advice; suitability must be confirmed by a qualified person."
)


class AnalyzeRequest(BaseModel):
    product: Dict[str, Any]
    profile: Optional[Dict[str, Any]] = None
    include_monte_carlo: bool = False
    case_id: Optional[str] = None


class SuitabilityOnlyRequest(BaseModel):
    product: Dict[str, Any]
    profile: Dict[str, Any]


def _parse_product(data: Dict[str, Any]) -> object:
    pt = data.get("product_type", "").upper()
    if pt == "ELN":
        return ELNConfig(**data)
    elif pt == "CPN":
        return CPNConfig(**data)
    elif pt == "DCD":
        return DCDConfig(**data)
    raise AppError(422, "VALIDATION_ERROR", f"Unknown product_type: {pt}")


@router.post("/analyze")
async def analyze(req: AnalyzeRequest) -> Dict[str, Any]:
    init_db()
    try:
        config = _parse_product(req.product)
    except Exception as exc:
        raise AppError(422, "VALIDATION_ERROR", str(exc))

    underlying_key = config.underlying  # type: ignore[attr-defined]
    try:
        df, source, as_of, snap = get_history(underlying_key)
    except ValueError as exc:
        raise AppError(404, "DATA_NOT_FOUND", str(exc))

    metrics = compute_metrics(config, df["close"], include_monte_carlo=req.include_monte_carlo)

    profile: Optional[ClientProfile] = None
    suitability = None
    if req.profile:
        try:
            profile = ClientProfile(**req.profile)
            suitability = evaluate_suitability(config, profile, metrics)
        except Exception as exc:
            logger.warning("Suitability evaluation failed: %s", exc)

    explanation = None
    if profile and suitability:
        facts = build_payload(config, profile, metrics, suitability, source, as_of, snap, "TMP")
        explanation = generate_explanation(facts)

    run_id = generate_run_id()

    # Update facts with real run_id
    if profile and suitability:
        facts = build_payload(config, profile, metrics, suitability, source, as_of, snap, run_id)

    # Persist
    save_run(
        run_id=run_id,
        case_id=req.case_id,
        product_json=config.__dict__,
        metrics_json=metrics.model_dump(),
        suitability_json=suitability.model_dump() if suitability else None,
        explanation_json=explanation.model_dump() if explanation else None,
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
            "explanation_source": explanation.source,
            "snapshot_id": snap,
        }
        append_audit(
            run_id=run_id,
            payload=audit_payload,
            verdict=suitability.verdict,
            data_source=source,
            snapshot_id=snap,
            model=explanation.model,
            prompt_version=explanation.prompt_version,
        )

    response: Dict[str, Any] = {
        "run_id": run_id,
        "metrics": metrics.model_dump(),
        "data_source": source,
        "as_of": as_of,
        "snapshot_id": snap,
        "disclaimer": DISCLAIMER,
    }
    if suitability:
        response["suitability"] = suitability.model_dump()
    if explanation:
        response["explanation"] = explanation.model_dump()

    return response


@router.post("/suitability")
async def suitability_only(req: SuitabilityOnlyRequest) -> Dict[str, Any]:
    """Fast suitability check – reuses cached history, no persistence."""
    try:
        config = _parse_product(req.product)
    except Exception as exc:
        raise AppError(422, "VALIDATION_ERROR", str(exc))

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

    return {
        "suitability": suitability.model_dump(),
        "data_source": source,
        "as_of": as_of,
        "snapshot_id": snap,
    }
