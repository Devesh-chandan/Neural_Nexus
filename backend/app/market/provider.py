"""
yfinance market data provider.
Downloads adjusted close prices with a configurable timeout.
"""
from __future__ import annotations

import logging
from datetime import date, datetime
from typing import Optional

import pandas as pd
import yfinance as yf

logger = logging.getLogger(__name__)

_TIMEOUT = 15  # seconds


def download_history(
    ticker: str,
    start: str,
    end: Optional[str] = None,
) -> pd.DataFrame:
    """
    Download daily adjusted-close history for *ticker* from yfinance.

    Returns a DataFrame with a 'close' column indexed by date.
    Raises RuntimeError on failure or empty result.
    """
    end_dt = end or datetime.utcnow().strftime("%Y-%m-%d")

    try:
        raw = yf.download(
            ticker,
            start=start,
            end=end_dt,
            auto_adjust=True,
            progress=False,
        )
    except Exception as exc:
        raise RuntimeError(f"yfinance download failed for {ticker}: {exc}") from exc

    if raw.empty:
        raise RuntimeError(f"yfinance returned empty data for {ticker}")

    # Flatten multi-index columns if present (yfinance 1.x always returns MultiIndex)
    if isinstance(raw.columns, pd.MultiIndex):
        raw.columns = raw.columns.get_level_values(0)

    # yfinance 1.x uses "Close" (with capital C)
    close_col = next(
        (c for c in raw.columns if c.lower() == "close"),
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
