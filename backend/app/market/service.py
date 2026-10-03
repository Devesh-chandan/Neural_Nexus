"""
MarketService: fallback chain (live → cache → seed), data cleaning,
snapshot_id generation, and in-memory memoisation.
"""
from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timedelta
from typing import Dict, Optional, Tuple

import pandas as pd

from app.core.config import get_settings, get_underlyings
from app.market.cache import load_cache, save_cache
from app.market.provider import download_history
from app.market.seed import load_seed

logger = logging.getLogger(__name__)

# In-memory memo: key → (df, source, as_of)
_MEMO: Dict[str, Tuple[pd.DataFrame, str, str]] = {}

MIN_HISTORY_YEARS = 2
MAX_GAP_DAYS = 3  # forward-fill at most 3-day gaps


def _snapshot_id(key: str, df: pd.DataFrame) -> str:
    """Stable identifier derived from key + first/last date + row count + last close."""
    first = str(df.index[0].date()) if len(df) else "none"
    last = str(df.index[-1].date()) if len(df) else "none"
    last_close = f"{df['close'].iloc[-1]:.4f}" if len(df) else "0"
    raw = f"{key}|{first}|{last}|{len(df)}|{last_close}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def _clean(df: pd.DataFrame) -> pd.DataFrame:
    """Drop NaN closes; forward-fill gaps ≤ MAX_GAP_DAYS; raise if still NaN."""
    df = df.copy()
    df["close"] = df["close"].astype(float)
    # Drop rows that are explicitly NaN
    df.dropna(subset=["close"], inplace=True)
    if df.empty:
        raise ValueError("All rows are NaN after dropping.")

    # Reindex to business-day calendar and forward-fill small gaps
    bday_range = pd.bdate_range(df.index[0], df.index[-1])
    df = df.reindex(bday_range)
    # Mark where gaps are too large (>MAX_GAP_DAYS consecutive NaN)
    mask = df["close"].isna()
    # Count consecutive NaN runs
    cumsum = mask.cumsum()
    run_len = cumsum - cumsum.where(~mask).ffill().fillna(0)
    too_large = run_len > MAX_GAP_DAYS
    if too_large.any():
        n = int(too_large.sum())
        logger.warning("Dropping %d rows with large gaps (>%d days)", n, MAX_GAP_DAYS)
    df = df[~too_large]
    df["close"] = df["close"].ffill()
    df.dropna(subset=["close"], inplace=True)
    df.index.name = "date"
    return df


def get_history(
    key: str,
    start: Optional[str] = None,
    end: Optional[str] = None,
    force_refresh: bool = False,
) -> Tuple[pd.DataFrame, str, str, str]:
    """
    Return (df, source, as_of, snapshot_id) for *key*.

    Fallback order: in-memory memo → live yfinance → disk cache → seed CSV.
    Raises ValueError if history is too short.
    """
    global _MEMO

    if not force_refresh and key in _MEMO:
        df, source, as_of = _MEMO[key]
        return df, source, as_of, _snapshot_id(key, df)

    underlyings = get_underlyings()
    if key not in underlyings:
        raise ValueError(f"Unknown underlying key: {key}")

    ticker = underlyings[key]["ticker"]
    default_start = start or (
        datetime.utcnow() - timedelta(days=365 * 20)
    ).strftime("%Y-%m-%d")
    end_str = end or datetime.utcnow().strftime("%Y-%m-%d")

    df: Optional[pd.DataFrame] = None
    source = "live"

    # 1. Try live
    try:
        df = download_history(ticker, default_start, end_str)
        save_cache(key, df)
    except Exception as exc:
        logger.warning("Live fetch failed for %s: %s", key, exc)
        df = None

    # 2. Try disk cache
    if df is None:
        df = load_cache(key)
        if df is not None:
            source = "cache"
            logger.info("Using disk cache for %s", key)

    # 3. Try seed
    if df is None:
        df = load_seed(key)
        if df is not None:
            source = "seed"
            logger.info("Using seed data for %s", key)

    if df is None:
        raise ValueError(f"No market data available for {key} (live, cache, and seed all failed).")

    df = _clean(df)

    # Filter to requested date range
    if start:
        df = df[df.index >= pd.Timestamp(start)]
    if end:
        df = df[df.index <= pd.Timestamp(end)]

    if df.empty:
        raise ValueError(f"No data in requested date range for {key}.")

    years_available = (df.index[-1] - df.index[0]).days / 365.25
    if years_available < MIN_HISTORY_YEARS:
        raise ValueError(
            f"Insufficient history for {key}: {years_available:.1f} years "
            f"(minimum {MIN_HISTORY_YEARS} years required)."
        )

    as_of = str(df.index[-1].date())
    snap = _snapshot_id(key, df)
    _MEMO[key] = (df, source, as_of)
    return df, source, as_of, snap


def invalidate_memo(key: Optional[str] = None) -> None:
    """Clear in-memory memo for a key or all keys."""
    global _MEMO
    if key:
        _MEMO.pop(key, None)
    else:
        _MEMO.clear()
