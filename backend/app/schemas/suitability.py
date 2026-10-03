"""Suitability engine output schemas."""
from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


RuleStatus = Literal["GREEN", "AMBER", "RED"]
Verdict = Literal["SUITABLE", "CONDITIONALLY_SUITABLE", "NOT_SUITABLE"]


class RuleResult(BaseModel):
    rule_id: str
    dimension: str
    status: RuleStatus
    severity: float = Field(ge=0, le=1, default=0.5)
    message_key: str
    message: str
    facts: Dict[str, Any]


class ScoreDriver(BaseModel):
    rule_id: str
    dimension: str
    points_deducted: float
    status: RuleStatus


class SummaryFlags(BaseModel):
    p_loss: RuleStatus
    worst_case: RuleStatus
    tail_loss: RuleStatus
    horizon: RuleStatus
    concentration: RuleStatus
    appetite: RuleStatus
    complexity: RuleStatus


class SuitabilityResult(BaseModel):
    verdict: Verdict
    score: float = Field(ge=0, le=100)
    score_drivers: List[ScoreDriver]
    rules: List[RuleResult]
    tier: int = Field(ge=1, le=5)
    mismatches: List[RuleResult]
    summary_flags: SummaryFlags
