"""Cut price history into every possible period of the product's length (the "line-up")."""

from __future__ import annotations

import math
import warnings
from dataclasses import dataclass
from typing import Tuple

import numpy as np
import pandas as pd

from .config import DAYS_PER_MONTH


def tenor_parts(tenor_months: float) -> Tuple[int, int]:
    """12 -> (12 months, 0 days); 8.5 -> (8, 15); 0.25 -> (0, 8)."""
    months = int(math.floor(tenor_months + 1e-9))
    days = int(round((tenor_months - months) * DAYS_PER_MONTH))
    if months == 0 and days == 0:
        days = 1
    return months, days


def add_tenor(ts: pd.Timestamp, tenor_months: float) -> pd.Timestamp:
    months, days = tenor_parts(tenor_months)
    return pd.Timestamp(ts) + pd.DateOffset(months=months) + pd.Timedelta(days=days)


@dataclass
class Windows:
    start: np.ndarray   # index of the first day of each period
    end: np.ndarray     # index of the last day (first trading day on/after start + tenor)
    move: np.ndarray    # end price / start price - 1

    def __len__(self) -> int:
        return int(len(self.start))


def build_windows(dates: pd.DatetimeIndex, values: np.ndarray, tenor_months: float) -> Windows:
    """Every trading day that has a full period after it becomes one window."""
    months, days = tenor_parts(tenor_months)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        targets = dates + pd.DateOffset(months=months) if months else dates
        targets = targets + pd.Timedelta(days=days)
    end = np.asarray(dates.searchsorted(targets, side="left"))
    start = np.arange(len(dates))
    ok = (end < len(dates)) & (end > start)
    start, end = start[ok], end[ok]
    move = values[end] / values[start] - 1.0
    return Windows(start=start.astype(int), end=end.astype(int), move=move.astype(float))


def path_of(values: np.ndarray, start: int, end: int) -> np.ndarray:
    """Daily closes of one period divided by the first close (starts at exactly 1.0)."""
    seg = values[start:end + 1]
    return seg / seg[0]
