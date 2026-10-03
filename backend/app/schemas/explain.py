"""Explanation layer schemas."""
from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel


class ValidationCheck(BaseModel):
    check_name: str
    passed: bool
    detail: Optional[str] = None


class ExplanationValidation(BaseModel):
    passed: bool
    checks: List[ValidationCheck]


class ExplanationResult(BaseModel):
    client_text: str
    rm_text: str
    source: Literal["llm", "template"]
    validation: ExplanationValidation
    model: Optional[str] = None
    prompt_version: str
    fallback_reason: Optional[str] = None


class ExplainRequest(BaseModel):
    run_id: str
    audience: Literal["client", "rm"] = "client"
