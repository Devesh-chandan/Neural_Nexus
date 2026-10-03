"""
POST /api/cases  – create case from profile
GET  /api/cases/{case_id}  – load profile
GET  /api/runs/{run_id}  – full run
GET  /api/runs/{run_id}/export  – JSON or HTML export
"""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter, Query
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from app.core.errors import AppError
from app.store.audit import get_audit_record
from app.store.cases import create_case, get_case, list_cases
from app.store.db import init_db
from app.store.runs import load_run

logger = logging.getLogger(__name__)
router = APIRouter(tags=["cases"])

DISCLAIMER = (
    "Illustrative analysis using historical data and statistical models. "
    "Past performance does not predict future results. Issuer credit risk and "
    "liquidity risk are not modelled. This is a decision-support tool and not "
    "investment advice; suitability must be confirmed by a qualified person."
)


class CaseCreateRequest(BaseModel):
    profile: Dict[str, Any]


@router.get("/cases")
async def list_cases_route() -> Dict[str, Any]:
    init_db()
    cases = list_cases()
    return {"cases": cases, "count": len(cases)}


@router.post("/cases")
async def create_case_route(req: CaseCreateRequest) -> Dict[str, Any]:
    init_db()
    profile = req.profile
    client_name = profile.get("client_name", "Unknown")
    case_id = create_case(profile, client_name)
    return {"case_id": case_id, "client_name": client_name}


@router.get("/cases/{case_id}")
async def get_case_route(case_id: str) -> Dict[str, Any]:
    row = get_case(case_id)
    if row is None:
        raise AppError(404, "CASE_NOT_FOUND", f"Case {case_id} not found.")
    return {
        "case_id": row["case_id"],
        "client_name": row["client_name"],
        "profile": json.loads(row["profile_json"]),
        "created_at": row["created_at"],
        "latest_recommendation_id": row.get("latest_recommendation_id"),
    }


@router.get("/runs/{run_id}")
async def get_run(run_id: str) -> Dict[str, Any]:
    run = load_run(run_id)
    if run is None:
        raise AppError(404, "RUN_NOT_FOUND", f"Run {run_id} not found.")
    return {
        "run_id": run["run_id"],
        "case_id": run.get("case_id"),
        "product": run["product_json"],
        "metrics": run["metrics_json"],
        "suitability": run.get("suitability_json"),
        "explanation": run.get("explanation_json"),
        "data_source": run.get("data_source"),
        "as_of": run.get("as_of"),
        "snapshot_id": run.get("snapshot_id"),
        "created_at": run.get("created_at"),
        "disclaimer": DISCLAIMER,
    }


@router.get("/runs/{run_id}/export")
async def export_run(
    run_id: str,
    format: str = Query(default="json", regex="^(json|html)$"),
) -> Any:
    run = load_run(run_id)
    if run is None:
        raise AppError(404, "RUN_NOT_FOUND", f"Run {run_id} not found.")

    audit = get_audit_record(run_id)

    if format == "json":
        return {
            "run_id": run_id,
            "product": run["product_json"],
            "metrics": run["metrics_json"],
            "suitability": run.get("suitability_json"),
            "explanation": run.get("explanation_json"),
            "audit": audit,
            "disclaimer": DISCLAIMER,
        }

    # HTML report
    suitability = run.get("suitability_json") or {}
    verdict = suitability.get("verdict", "N/A")
    score = suitability.get("score", "N/A")
    explanation = run.get("explanation_json") or {}
    client_text = explanation.get("client_text", "No explanation available.")
    product = run.get("product_json", {})
    record_hash = audit["record_hash"] if audit else "N/A"

    html = f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Analysis Report – {run_id}</title>
<style>
  body {{ font-family: Arial, sans-serif; max-width: 900px; margin: 40px auto; padding: 0 20px; }}
  h1 {{ color: #1e40af; }} h2 {{ color: #374151; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }}
  .verdict-SUITABLE {{ color: #16a34a; font-weight: bold; }}
  .verdict-NOT_SUITABLE {{ color: #dc2626; font-weight: bold; }}
  .verdict-CONDITIONALLY_SUITABLE {{ color: #f59e0b; font-weight: bold; }}
  .disclaimer {{ background: #fef3c7; padding: 12px; border-left: 4px solid #f59e0b; font-size: 12px; }}
  .hash {{ font-family: monospace; font-size: 11px; color: #6b7280; word-break: break-all; }}
  table {{ border-collapse: collapse; width: 100%; }} th, td {{ border: 1px solid #e5e7eb; padding: 8px; text-align: left; }}
  th {{ background: #f3f4f6; }}
</style>
</head>
<body>
<h1>Structured Product Analysis Report</h1>
<p><strong>Run ID:</strong> {run_id}</p>

<h2>Product</h2>
<table>
{"".join(f"<tr><td>{k}</td><td>{v}</td></tr>" for k, v in product.items())}
</table>

<h2>Suitability</h2>
<p>Verdict: <span class="verdict-{verdict}">{verdict}</span> | Score: {score}/100</p>

<h2>Explanation</h2>
<div style="white-space: pre-wrap; font-size: 14px;">{client_text}</div>

<h2>Audit</h2>
<p class="hash">Record hash: {record_hash}</p>
<p style="font-size: 12px;">This hash chain is tamper-evident in the prototype, not tamper-proof.</p>

<div class="disclaimer">{DISCLAIMER}</div>
</body></html>"""

    return HTMLResponse(content=html, media_type="text/html")
