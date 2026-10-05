"""Run one product through the historical-replay engine, mapping its errors to AppError.

Shared by POST /api/simulate (the replay on its own) and POST /api/assess (replay output fed into the
suitability rules), so both run the exact same replay for the same product.

`SIM_DATA_DIR` (backend/data/sim) is passed as `data_dir=` on every call: the engine's optional local
price CSVs and ticker overrides live there regardless of the working directory. `underlyings.json` is
generated from backend/config/underlyings.yaml so the engine reads the same ticker, name and currency
as the rest of the backend (it would otherwise turn "SP500" into the non-existent ticker "SP500.NS").
FX pairs are passed as "USD/INR" and need no entry.
"""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any, Dict, Literal

from app.core.config import get_underlyings
from app.core.errors import AppError
from app.schemas.product import parse_product_dict
from app.simulation.adapter import to_sim_engine_payload
from app.simulation.market import BackendMarket
from app.simulation.sim_engine import Settings, SimulationError, run_simulation

SIM_DATA_DIR = str(Path(__file__).resolve().parents[2] / "data" / "sim")  # backend/data/sim


def _sync_underlying_overrides() -> None:
    overrides = {
        key: {
            "ticker": meta["ticker"],
            "name": meta["display_name"],
            "asset_class": "equity",
            "currency": meta["currency"],
        }
        for key, meta in get_underlyings().items()
        if meta.get("asset_class") in ("equity", "equity_index")
    }
    path = Path(SIM_DATA_DIR) / "underlyings.json"
    content = json.dumps(overrides, indent=2, sort_keys=True) + "\n"
    if path.exists() and path.read_text(encoding="utf-8") == content:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(content, encoding="utf-8")
    os.replace(tmp, path)


_sync_underlying_overrides()

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
            market=BackendMarket(data_dir=SIM_DATA_DIR),
            data_dir=SIM_DATA_DIR,
        )
    except SimulationError as exc:
        status = _ERROR_STATUS.get(exc.code, 422)
        raise AppError(status, exc.code, exc.message)
    except Exception as exc:  # never leak a raw stack trace
        logger.exception("sim_engine run_simulation failed")
        raise AppError(502, "SIMULATION_FAILED", f"{type(exc).__name__}: {exc}"[:300])
