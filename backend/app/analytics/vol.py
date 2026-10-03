"""
Volatility estimation.
- EWMA vol: lambda=0.94, 252 days, annualised.
- Realised 1-year vol: std of daily log-returns over trailing 252 days.
"""
from __future__ import annotations

import numpy as np
import pandas as pd


EWMA_LAMBDA = 0.94
TRADING_DAYS = 252


def ewma_volatility(close: pd.Series) -> float:
    """
    EWMA annualised volatility.
    Returns the estimated vol as a fraction (e.g. 0.20 for 20%).
    """
    log_ret = np.log(close / close.shift(1)).dropna()
    if len(log_ret) < 2:
        return float("nan")

    lam = EWMA_LAMBDA
    sq_ret = log_ret ** 2
    # Recursive EWMA: var_t = lambda * var_{t-1} + (1 - lambda) * r_t^2
    var = float(sq_ret.iloc[0])
    for r2 in sq_ret.iloc[1:]:
        var = lam * var + (1 - lam) * float(r2)

    return float(np.sqrt(var * TRADING_DAYS))


def realised_volatility_1y(close: pd.Series) -> float:
    """
    Trailing 252-day realised volatility, annualised.
    """
    trailing = close.iloc[-TRADING_DAYS - 1 :] if len(close) > TRADING_DAYS else close
    log_ret = np.log(trailing / trailing.shift(1)).dropna()
    if len(log_ret) < 2:
        return float("nan")
    return float(log_ret.std(ddof=1) * np.sqrt(TRADING_DAYS))


def compute_vol(close: pd.Series) -> dict:
    return {
        "ewma": ewma_volatility(close),
        "realised_1y": realised_volatility_1y(close),
    }
