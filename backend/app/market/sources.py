"""
Where market prices come from, in fallback order: live yfinance download, 12-hour disk cache, bundled seed CSV.

  * `download_history`   split-adjusted (not dividend-adjusted) daily closes from yfinance
  * `load_cache` / `save_cache`   parquet cache with a TTL
  * `load_seed`          committed CSVs in data/seed so demos work offline
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import pandas as pd
import yfinance as yf

from app.core.config import get_settings

logger = logging.getLogger(__name__)

_TIMEOUT = 15  # seconds


def download_history(
    ticker: str,
    start: str,
    end: Optional[str] = None,
) -> pd.DataFrame:
    """
    Download daily close history for *ticker* from yfinance.

    Uses the split-adjusted, not dividend-adjusted, close: barriers, strikes and
    fixings reference the traded price, and it is the same series the historical
    replay engine (app.simulation.sim_engine) uses, so both read identical prices.

    Returns a DataFrame with a 'close' column indexed by date.
    Raises RuntimeError on failure or empty result.
    """
    end_dt = end or datetime.now(timezone.utc).strftime("%Y-%m-%d")

    try:
        raw = yf.download(
            ticker,
            start=start,
            end=end_dt,
            auto_adjust=False,
            progress=False,
        )
    except Exception as exc:
        raise RuntimeError(f"yfinance download failed for {ticker}: {exc}") from exc

    if raw.empty:
        raise RuntimeError(f"yfinance returned empty data for {ticker}")

    # Flatten multi-index columns if present (yfinance 1.x always returns MultiIndex)
    if isinstance(raw.columns, pd.MultiIndex):
        raw.columns = raw.columns.get_level_values(0)

    # yfinance 1.x uses "Close" (with capital C); "Adj Close" is the dividend-adjusted one.
    close_col = next(
        (c for c in raw.columns if str(c).lower() == "close"),
        None
    )
    if close_col is None:
        raise RuntimeError(f"'Close' column missing for {ticker}; got {list(raw.columns)}")

    df = raw[[close_col]].rename(columns={close_col: "close"}).copy()
    df.index = pd.to_datetime(df.index).normalize()
    df = df[~df.index.duplicated(keep="last")]
    df.sort_index(inplace=True)

    logger.info("Downloaded %d rows for %s (%s to %s)", len(df), ticker, start, end_dt)
    return df




def _cache_path(key: str) -> Path:
    settings = get_settings()
    settings.cache_dir.mkdir(parents=True, exist_ok=True)
    return settings.cache_dir / f"{key}.parquet"


def _meta_path(key: str) -> Path:
    return _cache_path(key).with_suffix(".meta")


def load_cache(key: str) -> Optional[pd.DataFrame]:
    """Return cached DataFrame if it exists and is within TTL, else None."""
    path = _cache_path(key)
    meta = _meta_path(key)
    if not path.exists() or not meta.exists():
        return None

    try:
        saved_at = float(meta.read_text().strip())
    except Exception:
        return None

    settings = get_settings()
    if time.time() - saved_at > settings.cache_ttl_seconds:
        logger.debug("Cache expired for %s", key)
        return None

    try:
        df = pd.read_parquet(path)
        logger.debug("Cache hit for %s (%d rows)", key, len(df))
        return df
    except Exception as exc:
        logger.warning("Cache read failed for %s: %s", key, exc)
        return None


def save_cache(key: str, df: pd.DataFrame) -> None:
    """Persist DataFrame to disk cache."""
    path = _cache_path(key)
    meta = _meta_path(key)
    try:
        df.to_parquet(path)
        meta.write_text(str(time.time()))
        logger.debug("Saved cache for %s (%d rows)", key, len(df))
    except Exception as exc:
        logger.warning("Cache write failed for %s: %s", key, exc)




def load_seed(key: str) -> Optional[pd.DataFrame]:
    """
    Load seed CSV for *key* if it exists.
    Returns DataFrame with 'close' column and DatetimeIndex, or None.
    """
    settings = get_settings()
    path = settings.seed_dir / f"{key}.csv"

    if not path.exists():
        logger.debug("No seed file for %s at %s", key, path)
        return None

    try:
        df = pd.read_csv(path, index_col=0, parse_dates=True)
        if "close" not in df.columns:
            # Try renaming common variants
            col_map = {c: "close" for c in df.columns if c.lower() == "close"}
            df.rename(columns=col_map, inplace=True)
        if "close" not in df.columns:
            logger.warning("Seed file %s has no 'close' column; columns: %s", key, list(df.columns))
            return None
        df.index = pd.to_datetime(df.index).normalize()
        df = df[["close"]].copy()
        df = df[~df.index.duplicated(keep="last")]
        df.sort_index(inplace=True)
        logger.info("Loaded seed data for %s (%d rows)", key, len(df))
        return df
    except Exception as exc:
        logger.error("Failed to load seed for %s: %s", key, exc)
        return None
