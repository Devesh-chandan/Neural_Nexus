"""Recommendation engine schemas."""
from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel

from app.schemas.suitability import Verdict


class ComparisonRow(BaseModel):
    product_type: str
    underlying: str
    key_params: Dict[str, Any]
    verdict: Verdict
    score: float
    p_loss: float
    cvar5: float
    median_annualised_return: float
    indicative_flag: str
    fit_score: float
    rejected_reasons: List[str]
    rank: int


class ProductCandidate(BaseModel):
    product_type: str
    run_id: str
    config: Dict[str, Any]
    metrics_summary: Dict[str, Any]
    suitability: Optional[Dict[str, Any]] = None
    fit_score: float
    verdict: Verdict
    is_suitable: bool
    rejected_reasons: List[str]
    rejection_note: Optional[str] = None  # populated if no_suitable_candidate


class RecommendationResult(BaseModel):
    recommendation_id: str
    best: Optional[ProductCandidate] = None
    ranking: List[ProductCandidate]
    comparison_table: List[ComparisonRow]
    rationale_text: Optional[str] = None
    disclaimer: str = (
        "Illustrative analysis using historical data and statistical models. "
        "Past performance does not predict future results. This is a "
        "decision-support tool and not investment advice."
    )
    data_source: str = "mixed"
    as_of: str


class RecommendRequest(BaseModel):
    profile: Any  # ClientProfile – validated at route
    filters: Optional[Dict[str, Any]] = None


class FixItSuggestion(BaseModel):
    change_description: str
    new_config: Dict[str, Any]
    new_verdict: Verdict
    new_score: float
    tradeoff: str


class FixItResponse(BaseModel):
    original_verdict: Verdict
    original_score: float
    suggestions: List[FixItSuggestion]
    label: str = "Options to discuss with your RM"
