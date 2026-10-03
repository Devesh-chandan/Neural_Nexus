"""Audit and persistence schemas."""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


class CaseCreateRequest(BaseModel):
    profile: object  # ClientProfile typed at route


class CaseResponse(BaseModel):
    case_id: str
    client_name: str
    latest_recommendation_id: Optional[str] = None


class AuditRecord(BaseModel):
    id: int
    run_id: str
    created_at: str
    payload_hash: str
    prev_hash: str
    record_hash: str
    model: Optional[str]
    prompt_version: str
    rules_version: str
    snapshot_id: str
    verdict: Optional[str]
    data_source: str


class VerifyResult(BaseModel):
    ok: bool
    total_records: int
    first_broken_record_id: Optional[int] = None
    detail: str
