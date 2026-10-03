"""Makes module2_simulation_engine's `sim_engine` package importable from the backend.

module2_simulation_engine/module2_simulation_engine/sim_engine is not pip-installed (no
setup.py/pyproject.toml) and is deliberately reused as-is rather than copied or rewritten, so
its folder is added to sys.path here. `MODULE2_DATA_DIR` is passed as `data_dir=` on every call
so sim_engine's own price cache/overrides under that folder are used regardless of the
backend's working directory.
"""
from __future__ import annotations

import sys
from pathlib import Path

_BACKEND_APP_DIR = Path(__file__).resolve().parent  # backend/app/simulation
_REPO_ROOT = _BACKEND_APP_DIR.parents[2]             # backend/app/simulation -> backend/app -> backend -> repo root
MODULE2_ROOT = _REPO_ROOT / "module2_simulation_engine" / "module2_simulation_engine"
MODULE2_DATA_DIR = str(MODULE2_ROOT / "data")

_module2_root_str = str(MODULE2_ROOT)
if _module2_root_str not in sys.path:
    sys.path.insert(0, _module2_root_str)

from sim_engine import Settings, SimulationError, run_simulation  # noqa: E402

__all__ = ["Settings", "SimulationError", "run_simulation", "MODULE2_DATA_DIR", "MODULE2_ROOT"]
