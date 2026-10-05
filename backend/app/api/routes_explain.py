"""
POST /api/explain – the explanation stored with an analysis run.

Explanations are generated once, together with the analysis, from the deterministic facts of that
run (`app.explain.engine`). Re-generating later could cite different numbers than the ones the
client was shown and the audit trail recorded, so this returns the stored explanation as is.
"""
from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, Request
from pydantic import BaseModel

from app.api.routes_cases import _ensure_run_access
from app.assessment.redact import is_rm, redact_explanation
from app.core.errors import AppError
from app.store.runs import load_run

router = APIRouter(tags=["explain"])


class ExplainRequest(BaseModel):
    run_id: str


@router.post("/explain")
def explain_run(req: ExplainRequest, request: Request) -> Dict[str, Any]:
    run = load_run(req.run_id)
    if run is None:
        raise AppError(404, "RUN_NOT_FOUND", f"Run {req.run_id} not found.")
    _ensure_run_access(run, request.state.user)
    explanation = run.get("explanation_json")
    if not explanation:
        raise AppError(422, "NO_EXPLANATION",
                       "This run has no explanation: it was analysed without a client profile.")
    return {"explanation": explanation if is_rm(request.state.user) else redact_explanation(explanation)}
