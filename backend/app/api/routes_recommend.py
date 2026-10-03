"""
POST /api/recommend – recommendation engine (Phase 5).
POST /api/fixit    – fix-it parameter suggestions (Phase 5).
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter
from pydantic import BaseModel

from app.core.errors import AppError
from app.recommend.engine import run_fixit, run_recommendation
from app.schemas.client import ClientProfile

logger = logging.getLogger(__name__)
router = APIRouter(tags=["recommend"])


class RecommendRequest(BaseModel):
    profile: Dict[str, Any]
    filters: Optional[Dict[str, Any]] = None


class FixItRequest(BaseModel):
    product: Dict[str, Any]
    profile: Dict[str, Any]


@router.post("/recommend")
async def recommend(req: RecommendRequest) -> Dict[str, Any]:
    """
    Run the recommendation engine for a client profile.
    Returns a ranked list of product candidates with suitability and fit scores.
    """
    try:
        profile = ClientProfile(**req.profile)
    except Exception as exc:
        raise AppError(422, "VALIDATION_ERROR", f"Invalid profile: {exc}")

    try:
        result = run_recommendation(profile, filters=req.filters)
    except Exception as exc:
        logger.exception("Recommendation engine failed")
        raise AppError(500, "RECOMMENDATION_ERROR", f"Recommendation engine error: {exc}")

    return result.model_dump()


@router.post("/fixit")
async def fixit(req: FixItRequest) -> Dict[str, Any]:
    """
    Given a product + profile, suggest parameter tweaks to improve suitability.
    """
    try:
        profile = ClientProfile(**req.profile)
    except Exception as exc:
        raise AppError(422, "VALIDATION_ERROR", f"Invalid profile: {exc}")

    try:
        result = run_fixit(req.product, profile)
    except ValueError as exc:
        raise AppError(422, "VALIDATION_ERROR", str(exc))
    except Exception as exc:
        logger.exception("Fix-it engine failed")
        raise AppError(500, "FIXIT_ERROR", f"Fix-it engine error: {exc}")

    return result.model_dump()
