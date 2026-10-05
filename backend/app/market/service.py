"""
MarketService: fallback chain (live → cache → seed), data cleaning,
snapshot_id generation, and in-memory memoisation.
"""
from __future__ import annotations

import hashlib
import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Dict, Optional, Tuple

import pandas as pd

from app.core.config import get_settings, get_underlyings
from app.market.sources import load_cache, save_cache
from app.market.sources import download_history
from app.market.sources import load_seed
from app.simulation.sim_engine.market_data import clean_prices

logger = logging.getLogger(__name__)

# In-memory memo: key → (df, source, as_of, stored_at). Entries expire with the disk-cache TTL so a
# long-running server does not serve prices from days ago.
_MEMO: Dict[str, Tuple[pd.DataFrame, str, str, float]] = {}

MIN_HISTORY_YEARS = 2


def _snapshot_id(key: str, df: pd.DataFrame) -> str:
    """Stable identifier derived from key + first/last date + row count + last close."""
    first = str(df.index[0].date()) if len(df) else "none"
    last = str(df.index[-1].date()) if len(df) else "none"
    last_close = f"{df['close'].iloc[-1]:.4f}" if len(df) else "0"
    raw = f"{key}|{first}|{last}|{len(df)}|{last_close}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def _clean(df: pd.DataFrame, asset_class: str = "equity") -> pd.DataFrame:
    """Shared cleaning rules (same as the replay engine): drop blank/zero/duplicate rows and one-day
    spikes that fully reverse. Real trading days only: missing days are NOT forward-filled, because
    invented flat days would distort barrier checks and volatility."""
    clean, removed = clean_prices(df["close"], asset_class)
    if clean.empty:
        raise ValueError("No usable prices after cleaning.")
    if removed:
        logger.warning("Removed %d bad price rows (blank, zero or one-day spikes)", removed)
    out = clean.to_frame("close")
    out.index.name = "date"
    return out


def _slice(df: pd.DataFrame, start: Optional[str], end: Optional[str]) -> pd.DataFrame:
    """Restrict to [start, end]; raises ValueError if nothing remains."""
    if start:
        df = df[df.index >= pd.Timestamp(start)]
    if end:
        df = df[df.index <= pd.Timestamp(end)]
    if df.empty:
        raise ValueError("No data in requested date range.")
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

    entry = _MEMO.get(key)
    if entry is not None and time.monotonic() - entry[3] > get_settings().cache_ttl_seconds:
        _MEMO.pop(key, None)
    if not force_refresh and key in _MEMO:
        full, source, _, stored_at = _MEMO[key]
        df = _slice(full, start, end)
        return df, source, str(df.index[-1].date()), _snapshot_id(key, df)

    underlyings = get_underlyings()
    if key not in underlyings:
        raise ValueError(f"Unknown underlying key: {key}")

    ticker = underlyings[key]["ticker"]
    default_start = start or (
        datetime.now(timezone.utc) - timedelta(days=365 * 20)
    ).strftime("%Y-%m-%d")
    end_str = end or datetime.now(timezone.utc).strftime("%Y-%m-%d")

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

    df = _clean(df, "fx" if underlyings[key].get("asset_class") == "fx" else "equity")

    # Memoise the FULL cleaned history; a request-specific date window must never be
    # what later callers (analysis, FX conversion) read back from the memo.
    full = df
    df = _slice(full, start, end)

    years_available = (df.index[-1] - df.index[0]).days / 365.25
    if years_available < MIN_HISTORY_YEARS:
        raise ValueError(
            f"Insufficient history for {key}: {years_available:.1f} years "
            f"(minimum {MIN_HISTORY_YEARS} years required)."
        )

    as_of = str(df.index[-1].date())
    snap = _snapshot_id(key, df)
    _MEMO[key] = (full, source, str(full.index[-1].date()), time.monotonic())
    return df, source, as_of, snap


def invalidate_memo(key: Optional[str] = None) -> None:
    """Clear in-memory memo for a key or all keys."""
    global _MEMO
    if key:
        _MEMO.pop(key, None)
    else:
        _MEMO.clear()
