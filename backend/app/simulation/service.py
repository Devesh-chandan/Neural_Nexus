"""Run one product through module2_simulation_engine, mapping its errors to AppError.

Shared by POST /api/simulate (Module 2 on its own) and POST /api/assess (Module 2 output
fed into Module 3), so both run the exact same replay for the same product.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Literal

from app.core.errors import AppError
from app.schemas.product import parse_product_dict
from app.simulation.adapter import to_sim_engine_payload
from app.simulation.bridge import MODULE2_DATA_DIR, Settings, SimulationError, run_simulation

logger = logging.getLogger(__name__)

HistoryUntil = Literal["latest", "start_date"]

_ERROR_STATUS = {
    "INVALID_PRODUCT": 422,
    "INVALID_SETTINGS": 422,
    "UNSUPPORTED_UNDERLYING": 422,
    "NOT_ENOUGH_HISTORY": 422,
    "MARKET_DATA_UNAVAILABLE": 502,
}


def simulate_product(product: Dict[str, Any], history_until: HistoryUntil = "latest") -> Dict[str, Any]:
    try:
        config = parse_product_dict(product)
    except Exception as exc:
        raise AppError(422, "VALIDATION_ERROR", str(exc))

    raw = to_sim_engine_payload(config)

    try:
        return run_simulation(
            raw,
            settings=Settings(history_until=history_until),
            data_dir=MODULE2_DATA_DIR,
        )
    except SimulationError as exc:
        status = _ERROR_STATUS.get(exc.code, 422)
        raise AppError(status, exc.code, exc.message)
    except Exception as exc:  # never leak a raw stack trace
        logger.exception("sim_engine run_simulation failed")
        raise AppError(502, "SIMULATION_FAILED", f"{type(exc).__name__}: {exc}"[:300])
