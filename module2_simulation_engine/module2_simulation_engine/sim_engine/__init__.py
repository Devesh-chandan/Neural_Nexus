"""Module 2 - Simulation Engine: replay a structured product on 20 real past market periods."""

from .config import ENGINE_VERSION
from .engine import Settings, payoff_curve, run_batch, run_simulation
from .errors import SimulationError
from .market_data import MarketDataService

__all__ = ["ENGINE_VERSION", "Settings", "run_simulation", "run_batch", "payoff_curve",
           "SimulationError", "MarketDataService"]
