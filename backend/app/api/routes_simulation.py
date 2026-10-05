"""
POST /api/simulate – real historical replay (app.simulation.sim_engine).

Replays the given product on 20 real historical market periods of matching length and
returns dated, narrated scenarios with a SHA-256 fingerprint of the price data used. This is
a separate, additional source of real-figures evidence alongside the existing /api/analyze
pipeline, not a replacement for it.
"""
from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter
from pydantic import BaseModel

from app.simulation.service import HistoryUntil, simulate_product

router = APIRouter(tags=["simulation"])


class SimulateRequest(BaseModel):
    product: Dict[str, Any]
    history_until: HistoryUntil = "latest"


@router.post("/simulate")
def simulate(req: SimulateRequest) -> Dict[str, Any]:
    return simulate_product(req.product, req.history_until)
