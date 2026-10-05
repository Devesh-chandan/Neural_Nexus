"""
POST /api/assess – deterministic suitability rules on top of the historical replay.

Runs the product through the historical-replay engine (app.simulation), then the
deterministic rules (app.assessment.rules_engine) against the client's case record, explains the result in plain language
for the client and the RM (Groq LLM, validated, with a template fallback), and appends it all
to the audit hash chain.
"""
from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from app.api.routes_cases import _ensure_case_access
from app.assessment.redact import redact_explanation
from app.assessment.service import assess_case
from app.core.errors import AppError
from app.simulation.service import HistoryUntil
from app.store.audit import append_audit
from app.store.cases import get_case

router = APIRouter(tags=["assessment"])

DISCLAIMER = (
    "Deterministic suitability check against historical replays of real past periods. "
    "Not a forecast and not investment advice; suitability must be confirmed by a qualified person."
)


class AssessRequest(BaseModel):
    client_id: str = Field(min_length=1, description="Case ID; for seeded clients this is the client_id, e.g. CLT-IN-0001.")
    product: Dict[str, Any]
    history_until: HistoryUntil = "latest"
    explain: bool = True


@router.post("/assess")
def assess(req: AssessRequest, request: Request) -> Dict[str, Any]:
    case = get_case(req.client_id)
    if case is None:
        raise AppError(404, "CASE_NOT_FOUND", "Case not found.")
    _ensure_case_access(case, request.state.user)

    result = assess_case(case, req.product, req.history_until, req.explain)
    assessment = result["assessment"]
    explanation = result["explanation"]
    market_data = result["simulation"].get("audit", {}).get("market_data", {})

    append_audit(
        run_id=assessment["assessment_id"],
        payload={
            "kind": "suitability_assessment",
            "assessment": assessment,
            "data_gaps": result["data_gaps"],
            "explanation": explanation,
            "assessed_by": request.state.user.get("id"),
        },
        verdict=assessment["overall_status"],
        data_source=str(market_data.get("source") or "historical_replay"),
        snapshot_id=str(market_data.get("fingerprint") or assessment["simulation_run_id"]),
        model=explanation["model"] if explanation else None,
        prompt_version=explanation["prompt_version"] if explanation else "none",
    )

    response = {**result, "disclaimer": DISCLAIMER}
    if request.state.user.get("user_type") != "rm":
        response = _client_view(response)
    return response


def _client_view(response: Dict[str, Any]) -> Dict[str, Any]:
    """Clients see their own explanation only: no RM briefing, no compliance-screening detail."""
    flags = response["assessment"]["compliance_flags"]
    assessment = {k: v for k, v in response["assessment"].items() if k != "compliance_flags"}
    assessment["additional_checks_required"] = any(f["status"] != "PASS" for f in flags.values())
    # KYC data-completeness notes are compliance detail, not for the client.
    assessment["additional_checks"] = {k: v for k, v in (assessment.get("additional_checks") or {}).items() if k != "kyc_data"}
    explanation = redact_explanation(response["explanation"])
    return {**response, "assessment": assessment, "explanation": explanation, "data_gaps": []}
