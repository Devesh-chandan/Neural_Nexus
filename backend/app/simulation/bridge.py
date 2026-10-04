"""Makes module2_simulation_engine's `sim_engine` package importable from the backend.

module2_simulation_engine/module2_simulation_engine/sim_engine is not pip-installed (no
setup.py/pyproject.toml) and is deliberately reused as-is rather than copied or rewritten, so
its folder is added to sys.path here. `MODULE2_DATA_DIR` is passed as `data_dir=` on every call
so sim_engine's own price cache/overrides under that folder are used regardless of the
backend's working directory.

sim_engine resolves an underlying name through `<data_dir>/underlyings.json` first. That file
is generated here from backend/config/underlyings.yaml so both engines read the same ticker,
name and currency for every equity underlying (sim_engine would otherwise turn "SP500" into
the non-existent ticker "SP500.NS" and assume INR). FX pairs are passed as "USD/INR" and need
no entry.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from app.core.config import get_underlyings

_BACKEND_APP_DIR = Path(__file__).resolve().parent  # backend/app/simulation
_REPO_ROOT = _BACKEND_APP_DIR.parents[2]             # backend/app/simulation -> backend/app -> backend -> repo root
MODULE2_ROOT = _REPO_ROOT / "module2_simulation_engine" / "module2_simulation_engine"
MODULE2_DATA_DIR = str(MODULE2_ROOT / "data")

_module2_root_str = str(MODULE2_ROOT)
if _module2_root_str not in sys.path:
    sys.path.insert(0, _module2_root_str)

from sim_engine import Settings, SimulationError, run_simulation  # noqa: E402


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
    path = Path(MODULE2_DATA_DIR) / "underlyings.json"
    content = json.dumps(overrides, indent=2, sort_keys=True) + "\n"
    if path.exists() and path.read_text(encoding="utf-8") == content:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(content, encoding="utf-8")
    os.replace(tmp, path)


_sync_underlying_overrides()

__all__ = ["Settings", "SimulationError", "run_simulation", "MODULE2_DATA_DIR", "MODULE2_ROOT"]
