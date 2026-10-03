"""
GET /api/audit/{run_id}  – audit record for a run
GET /api/audit/verify-chain  – verify the full hash chain
"""
from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter

from app.core.errors import AppError
from app.store.audit import get_audit_record, verify_chain

router = APIRouter(tags=["audit"])


@router.get("/audit/verify-chain")
async def verify_chain_route() -> Dict[str, Any]:
    return verify_chain()


@router.get("/audit/{run_id}")
async def get_audit(run_id: str) -> Dict[str, Any]:
    record = get_audit_record(run_id)
    if record is None:
        raise AppError(404, "AUDIT_NOT_FOUND", f"No audit record for run {run_id}.")
    # Verify just this record's hash integrity
    chain_result = verify_chain()
    return {
        "record": record,
        "chain_ok": chain_result["ok"],
        "verify_detail": chain_result["detail"],
    }
