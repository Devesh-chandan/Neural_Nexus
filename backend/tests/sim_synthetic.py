"""Synthetic but realistic-looking daily prices so tests run offline and deterministically.

Never used by the engine itself: tests write these into a temporary data/prices/ folder.
"""

from __future__ import annotations

import os
from typing import Dict, Iterable

import numpy as np
import pandas as pd

# Rough level of each FX pair at the end of the series (per 1 unit; JPY per 1 JPY)
FX_END_LEVEL = {"USD": 88.0, "EUR": 103.0, "GBP": 118.0, "AUD": 57.5, "AED": 24.0,
                "CHF": 109.0, "SGD": 68.5, "JPY": 0.59}


def make_series(seed: int, start: str = "2005-01-03", end: str = "2026-10-01",
                s0: float = 100.0, mu: float = 0.11, vol: float = 0.24, crashes: bool = True) -> pd.Series:
    dates = pd.bdate_range(start, end)
    rng = np.random.default_rng(seed)
    dt = 1 / 252
    r = rng.normal((mu - 0.5 * vol ** 2) * dt, vol * np.sqrt(dt), len(dates))
    if crashes:
        def shock(a: str, b: str, total: float) -> None:
            m = (dates >= a) & (dates <= b)
            if m.any():
                r[m] += np.log(1 + total) / m.sum()
        shock("2008-01-08", "2008-10-27", -0.55)
        shock("2009-03-09", "2009-12-31", 0.70)
        shock("2020-01-20", "2020-03-23", -0.38)
        shock("2020-03-24", "2020-12-31", 0.60)
    return pd.Series(s0 * np.exp(np.cumsum(r)), index=dates)


def make_fx_series(base: str, seed: int, start: str = "2005-01-03", end: str = "2026-10-01") -> pd.Series:
    s = make_series(seed, start, end, s0=1.0, mu=0.035, vol=0.06, crashes=False)
    return s / s.iloc[-1] * FX_END_LEVEL.get(base, 50.0)


def write_prices(data_dir: str, underlyings: Iterable[str]) -> Dict[str, str]:
    """Write one CSV per underlying into data_dir/prices (same names the engine looks for)."""
    from app.simulation.sim_engine.market_data import safe_name
    folder = os.path.join(data_dir, "prices")
    os.makedirs(folder, exist_ok=True)
    paths = {}
    for i, u in enumerate(sorted(set(underlyings))):
        if "/" in u:
            s = make_fx_series(u.split("/")[0], seed=1000 + i)
        else:
            s = make_series(seed=1 + i, s0=100 + 37 * i)
        path = os.path.join(folder, safe_name(u) + ".csv")
        pd.DataFrame({"Date": s.index.strftime("%Y-%m-%d"), "Close": s.values}).to_csv(path, index=False)
        paths[u] = path
    return paths
