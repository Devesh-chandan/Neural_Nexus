"""
POST /api/explain – generate explanation for a stored run.
"""
from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, Request
from pydantic import BaseModel

from app.api.routes_cases import _ensure_run_access
from app.core.errors import AppError
from app.explain.payload import build_payload
from app.explain.service import generate_explanation
from app.store.runs import load_run

router = APIRouter(tags=["explain"])


class ExplainRequest(BaseModel):
    run_id: str
    audience: str = "client"


@router.post("/explain")
def explain_run(req: ExplainRequest, request: Request) -> Dict[str, Any]:
    run = load_run(req.run_id)
    if run is None:
        raise AppError(404, "RUN_NOT_FOUND", f"Run {req.run_id} not found.")
    _ensure_run_access(run, request.state.user)

    # Reconstruct minimal facts from stored run
    facts: Dict[str, Any] = {
        "run_id": req.run_id,
        "product": run.get("product_json", {}),
        "profile": {},
        "metrics": run.get("metrics_json", {}).get("metrics", run.get("metrics_json", {})),
        "suitability": run.get("suitability_json", {}),
        "data_source": run.get("data_source", ""),
        "as_of": run.get("as_of", ""),
        "snapshot_id": run.get("snapshot_id", ""),
        "disclaimer": "Illustrative analysis. Not investment advice.",
    }

    explanation = generate_explanation(facts)
    return {"explanation": explanation.model_dump()}
