"""
POST /api/simulate – real historical replay (module2_simulation_engine / sim_engine).

Replays the given product on 20 real historical market periods of matching length and
returns dated, narrated scenarios with a SHA-256 fingerprint of the price data used. This is
a separate, additional source of real-figures evidence alongside the existing /api/analyze
pipeline, not a replacement for it.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Literal

from fastapi import APIRouter
from pydantic import BaseModel

from app.core.errors import AppError
from app.schemas.product import parse_product_dict
from app.simulation.adapter import to_sim_engine_payload
from app.simulation.bridge import MODULE2_DATA_DIR, Settings, SimulationError, run_simulation

logger = logging.getLogger(__name__)
router = APIRouter(tags=["simulation"])

_ERROR_STATUS = {
    "INVALID_PRODUCT": 422,
    "INVALID_SETTINGS": 422,
    "UNSUPPORTED_UNDERLYING": 422,
    "NOT_ENOUGH_HISTORY": 422,
    "MARKET_DATA_UNAVAILABLE": 502,
}


class SimulateRequest(BaseModel):
    product: Dict[str, Any]
    history_until: Literal["latest", "start_date"] = "latest"


@router.post("/simulate")
async def simulate(req: SimulateRequest) -> Dict[str, Any]:
    try:
        config = parse_product_dict(req.product)
    except ValueError as exc:
        raise AppError(422, "VALIDATION_ERROR", str(exc))
    except Exception as exc:
        raise AppError(422, "VALIDATION_ERROR", str(exc))

    raw = to_sim_engine_payload(config)

    try:
        result = run_simulation(
            raw,
            settings=Settings(history_until=req.history_until),
            data_dir=MODULE2_DATA_DIR,
        )
    except SimulationError as exc:
        status = _ERROR_STATUS.get(exc.code, 422)
        raise AppError(status, exc.code, exc.message)
    except Exception as exc:  # never leak a raw stack trace
        logger.exception("sim_engine run_simulation failed")
        raise AppError(502, "SIMULATION_FAILED", f"{type(exc).__name__}: {exc}"[:300])

    return result
