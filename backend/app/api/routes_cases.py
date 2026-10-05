"""
POST /api/cases  – create case from profile
GET  /api/cases/{case_id}  – load profile
PUT  /api/cases/{case_id}/profile  – update the client's answers
PUT  /api/cases/{case_id}/product-config  – RM recommends an analysed product (RBAC-gated)
GET  /api/runs/{run_id}  – full run
GET  /api/runs/{run_id}/export  – JSON or HTML export
"""
from __future__ import annotations

import html
import json
import logging
from typing import Any, Dict

from fastapi import APIRouter, Query, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, ValidationError

from app.assessment.redact import is_rm, redact_explanation, redact_suitability
from app.core.errors import AppError
from app.core.rbac import (
    PERM_FINALISE_CONFIGURATION,
    permissions_for_tier,
    rm_product_error,
    tier_cannot_finalise_reason,
)
from app.schemas.client import ClientProfile
from app.schemas.product import parse_product_dict
from app.store.audit import get_audit_record
from app.store.cases import (
    create_case,
    get_case,
    list_cases,
    merge_profile_edit,
    normalize_profile,
    update_case_product_config,
    update_case_profile,
)
from app.store.db import init_db
from app.store.rms import get_rm, record_finalisation
from app.store.runs import load_run

logger = logging.getLogger(__name__)
router = APIRouter(tags=["cases"])

DISCLAIMER = (
    "Illustrative analysis using historical data and statistical models. "
    "Past performance does not predict future results. Issuer credit risk is shown only as a "
    "generic illustrative assumption. Notes are held to maturity (no early redemption is offered) "
    "and liquidity risk is not modelled. This is a decision-support tool and not "
    "investment advice; suitability must be confirmed by a qualified person."
)


class CaseCreateRequest(BaseModel):
    profile: Dict[str, Any]


def _ensure_case_access(row: Dict[str, Any], user: Dict[str, Any]) -> None:
    if user.get("user_type") == "rm":
        return
    if row.get("owner_user_id") != user.get("id"):
        raise AppError(404, "CASE_NOT_FOUND", "Case not found.")


def _ensure_run_access(run: Dict[str, Any], user: Dict[str, Any]) -> None:
    if user.get("user_type") == "rm":
        return
    case_id = run.get("case_id")
    case = get_case(case_id) if case_id else None
    if case is None:
        raise AppError(404, "RUN_NOT_FOUND", "Run not found.")
    _ensure_case_access(case, user)


def _require_case(case_id: str, user: Dict[str, Any]) -> Dict[str, Any]:
    row = get_case(case_id)
    if row is None:
        raise AppError(404, "CASE_NOT_FOUND", f"Case {case_id} not found.")
    _ensure_case_access(row, user)
    return row


def _validated_profile(profile: Dict[str, Any]) -> ClientProfile:
    try:
        return ClientProfile(**profile)
    except ValidationError as exc:
        raise AppError(422, "VALIDATION_ERROR", f"Invalid profile: {exc}")


@router.get("/cases")
def list_cases_route(request: Request) -> Dict[str, Any]:
    init_db()
    user = request.state.user
    cases = (
        list_cases()
        if user.get("user_type") == "rm"
        else list_cases(user.get("id"))
    )
    return {"cases": cases, "count": len(cases)}


@router.post("/cases")
def create_case_route(req: CaseCreateRequest, request: Request) -> Dict[str, Any]:
    init_db()
    profile = _validated_profile(req.profile)
    user = request.state.user
    case_id = create_case(
        profile.stored_dict(),
        profile.client_name,
        owner_user_id=user.get("id") if user.get("user_type") == "client" else None,
    )
    return {"case_id": case_id, "client_name": profile.client_name}


@router.get("/cases/{case_id}")
def get_case_route(case_id: str, request: Request) -> Dict[str, Any]:
    row = _require_case(case_id, request.state.user)
    return {
        "case_id": row["case_id"],
        "client_name": row["client_name"],
        "profile": normalize_profile(json.loads(row["profile_json"]), row["client_name"]),
        "created_at": row["created_at"],
        "latest_recommendation_id": row.get("latest_recommendation_id"),
        "product_config": json.loads(row["product_config_json"]) if row.get("product_config_json") else None,
    }


class ProductConfigUpdate(BaseModel):
    product_config: Dict[str, Any]
    # The analysis run these exact terms were evaluated in, for this case.
    run_id: str


@router.put("/cases/{case_id}/product-config")
def update_product_config_route(
    case_id: str, req: ProductConfigUpdate, request: Request
) -> Dict[str, Any]:
    """
    Recommend a product to a client. Only an RM may do this, only for a product type
    their jurisdiction and authorisation allow, only after the terms were analysed
    for this client, and only with finalisation clearance. A denied attempt by a
    tier without clearance is recorded so the escalation is auditable.
    """
    user = request.state.user
    if user.get("user_type") != "rm":
        raise AppError(403, "FORBIDDEN", "Only a relationship manager can recommend a product.")
    _require_case(case_id, user)

    rm = get_rm(user.get("rm_id") or "")
    if rm is None:
        raise AppError(403, "RM_NOT_REGISTERED", "Your account has no registered RM record.")

    try:
        config = parse_product_dict(req.product_config)
    except (ValueError, ValidationError) as exc:
        raise AppError(422, "VALIDATION_ERROR", str(exc))

    product_error = rm_product_error(rm, config.product_type)
    if product_error:
        raise AppError(403, "PRODUCT_NOT_AUTHORISED", product_error)

    run = load_run(req.run_id)
    if run is None or run.get("case_id") != case_id:
        raise AppError(422, "RUN_MISMATCH", "Analyse these terms for this client before recommending them.")
    try:
        analysed = parse_product_dict(run["product_json"])
    except (ValueError, ValidationError):
        analysed = None
    if analysed is None or analysed.model_dump() != config.model_dump():
        raise AppError(422, "RUN_MISMATCH", "The terms changed since the last analysis; re-run it first.")

    tier = rm["access_tier"]
    if PERM_FINALISE_CONFIGURATION not in permissions_for_tier(tier):
        reason = tier_cannot_finalise_reason(tier) or "Your access tier cannot finalise a configuration."
        record_finalisation(req.run_id, rm["rm_id"], False, tier, reason)
        raise AppError(403, "FINALISE_NOT_PERMITTED", reason)

    stored = config.model_dump(mode="json")
    update_case_product_config(case_id, stored)
    finalised_at = record_finalisation(req.run_id, rm["rm_id"], True, tier, None)
    return {
        "case_id": case_id,
        "product_config": stored,
        "run_id": req.run_id,
        "finalised_by": rm["rm_id"],
        "finalised_at": finalised_at,
    }


@router.put("/cases/{case_id}/profile")
def update_profile_route(
    case_id: str, req: CaseCreateRequest, request: Request
) -> Dict[str, Any]:
    row = _require_case(case_id, request.state.user)
    edited = _validated_profile(req.profile).stored_dict()
    merged = merge_profile_edit(json.loads(row["profile_json"]), edited)
    update_case_profile(case_id, merged, edited["client_name"])
    return {
        "case_id": case_id,
        "client_name": edited["client_name"],
        "profile": normalize_profile(merged, edited["client_name"]),
    }


@router.get("/runs/{run_id}")
def get_run(run_id: str, request: Request) -> Dict[str, Any]:
    run = load_run(run_id)
    if run is None:
        raise AppError(404, "RUN_NOT_FOUND", f"Run {run_id} not found.")
    _ensure_run_access(run, request.state.user)
    rm = is_rm(request.state.user)
    return {
        "run_id": run["run_id"],
        "case_id": run.get("case_id"),
        "product": run["product_json"],
        "metrics": run["metrics_json"],
        "suitability": run.get("suitability_json") if rm else redact_suitability(run.get("suitability_json")),
        "explanation": run.get("explanation_json") if rm else redact_explanation(run.get("explanation_json")),
        "data_source": run.get("data_source"),
        "as_of": run.get("as_of"),
        "snapshot_id": run.get("snapshot_id"),
        "created_at": run.get("created_at"),
        "disclaimer": DISCLAIMER,
    }


@router.get("/runs/{run_id}/export")
def export_run(
    run_id: str,
    request: Request,
    format: str = Query(default="json", pattern="^(json|html)$"),
) -> Any:
    run = load_run(run_id)
    if run is None:
        raise AppError(404, "RUN_NOT_FOUND", f"Run {run_id} not found.")
    _ensure_run_access(run, request.state.user)

    rm = is_rm(request.state.user)
    audit = get_audit_record(run_id) if rm else None

    if format == "json":
        return {
            "run_id": run_id,
            "product": run["product_json"],
            "metrics": run["metrics_json"],
            "suitability": run.get("suitability_json") if rm else redact_suitability(run.get("suitability_json")),
            "explanation": run.get("explanation_json") if rm else redact_explanation(run.get("explanation_json")),
            "audit": audit,
            "disclaimer": DISCLAIMER,
        }

    # HTML report
    esc = html.escape
    suitability = run.get("suitability_json") or {}
    verdict = str(suitability.get("verdict", "N/A"))
    score = suitability.get("score", "N/A")
    explanation = run.get("explanation_json") or {}
    client_text = explanation.get("client_text") or "No explanation was generated for this run."
    product = run.get("product_json", {})
    record_hash = audit["record_hash"] if audit else "Not available"
    rows = "".join(f"<tr><td>{esc(str(k))}</td><td>{esc(str(v))}</td></tr>" for k, v in product.items())

    page = f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Analysis Report – {esc(run_id)}</title>
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
<p><strong>Run ID:</strong> {esc(run_id)} · <strong>Data:</strong> {esc(str(run.get("data_source")))} as of {esc(str(run.get("as_of")))}</p>

<h2>Product</h2>
<table>{rows}</table>

<h2>Suitability</h2>
<p>Verdict: <span class="verdict-{esc(verdict)}">{esc(verdict)}</span> | Score: {esc(str(score))}/100</p>

<h2>Explanation</h2>
<div style="white-space: pre-wrap; font-size: 14px;">{esc(client_text)}</div>

<h2>Audit</h2>
<p class="hash">Record hash: {esc(record_hash)}</p>
<p style="font-size: 12px;">This hash chain is tamper-evident in the prototype, not tamper-proof.</p>

<div class="disclaimer">{esc(DISCLAIMER)}</div>
</body></html>"""

    return HTMLResponse(content=page, media_type="text/html")
