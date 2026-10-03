"""FastAPI endpoints for Module 2 (plugs into the team's single FastAPI backend).

Run:   uvicorn sim_engine.api:app --reload --port 8002
Docs:  http://127.0.0.1:8002/docs

Environment: SIM_DATA_DIR (default "data"), SIM_RUNS_DIR (default "runs"), SIM_OFFLINE=1 to never download.
"""

from __future__ import annotations

import os
from typing import Any, Dict, List

from fastapi import Body, FastAPI, HTTPException, Query
from fastapi.responses import JSONResponse

from .config import ENGINE_VERSION
from .engine import Settings, payoff_curve, run_batch, run_simulation
from .errors import SimulationError
from .market_data import MarketDataService
from .storage import load_run, save_run

DATA_DIR = os.environ.get("SIM_DATA_DIR", "data")
RUNS_DIR = os.environ.get("SIM_RUNS_DIR", "runs")
OFFLINE = os.environ.get("SIM_OFFLINE", "0") == "1"

app = FastAPI(title="Module 2 - Simulation Engine", version=ENGINE_VERSION,
              description="Replays a structured product on 20 real past market periods. "
                          "Historical analysis, not a forecast.")
_market = MarketDataService(data_dir=DATA_DIR, offline=OFFLINE)


def _error(exc: SimulationError) -> JSONResponse:
    return JSONResponse(status_code=exc.status, content={"status": "error", "error": exc.to_dict()})


@app.get("/health")
def health() -> Dict[str, Any]:
    return {"status": "ok", "engine_version": ENGINE_VERSION, "offline": OFFLINE}


@app.post("/simulations")
def create_simulation(product: Dict[str, Any] = Body(...),
                      history_until: str = Query("latest")):
    try:
        result = run_simulation(product, Settings(history_until=history_until), _market)
    except SimulationError as exc:
        return _error(exc)
    save_run(result, RUNS_DIR)
    return result


@app.post("/simulations/batch")
def create_batch(products: List[Dict[str, Any]] = Body(...),
                 history_until: str = Query("latest")):
    if len(products) > 500:
        raise HTTPException(status_code=422, detail="At most 500 products per batch.")
    settings = Settings(history_until=history_until)
    try:
        settings.check()
    except SimulationError as exc:
        return _error(exc)
    rows = run_batch(products, settings, _market)
    for row in rows:
        if row["status"] == "ok":
            save_run(row["result"], RUNS_DIR)
    return rows


@app.get("/simulations/{run_id}")
def get_simulation(run_id: str):
    result = load_run(run_id, RUNS_DIR)
    if result is None:
        raise HTTPException(status_code=404, detail=f"No saved run {run_id}.")
    return result


@app.post("/payoff-curve")
def get_payoff_curve(product: Dict[str, Any] = Body(...)):
    try:
        return payoff_curve(product, _market)
    except SimulationError as exc:
        return _error(exc)
