"""Price data for the replay engine: cleaning, fingerprinting and local-CSV overrides.

The engine does NOT download or cache prices itself. Where prices come from is the caller's
decision: the backend plugs in its market service (`app.simulation.market.BackendMarket`:
live yfinance -> disk cache -> bundled seed), so every endpoint reads one price source.

Order of lookup in `MarketDataService.get`:
  1. <data_dir>/prices/<UNDERLYING>.csv   your own file (e.g. downloaded from NSE); always wins
  2. `_load_raw`, which a subclass implements (the base class refuses: no source configured)

Whatever the source, the series is cleaned the same way (blank / zero / duplicate rows and
one-day spikes that fully reverse are dropped), fingerprinted, and stale data is flagged, never
presented as fresh.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import os
import re
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

from .config import CACHE_MAX_AGE_HOURS, MIN_PRICE_POINTS, SPIKE_THRESHOLD, STALE_AFTER_DAYS
from .errors import MarketDataUnavailable
from .underlyings import UnderlyingInfo

# --------------------------------------------------------------------------- helpers
def safe_name(text: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]", "_", text)


def _to_naive_dates(index: Any) -> pd.DatetimeIndex:
    idx = pd.DatetimeIndex(index)
    if idx.tz is not None:
        idx = idx.tz_localize(None)
    return idx.normalize()


def clean_prices(series: pd.Series, asset_class: str) -> Tuple[pd.Series, int]:
    """Drop bad rows and one-day spikes that fully reverse. Returns (clean, removed_count)."""
    s = pd.Series(pd.to_numeric(series, errors="coerce").values,
                  index=_to_naive_dates(series.index), dtype=float)
    n0 = len(s)
    s = s[np.isfinite(s.values) & (s.values > 0)]
    s = s[~s.index.duplicated(keep="last")].sort_index()

    thr = SPIKE_THRESHOLD.get(asset_class, 0.25)
    if len(s) >= 3:
        r = np.diff(np.log(s.values))
        r_in, r_out = r[:-1], r[1:]
        spike = ((np.abs(r_in) > thr) & (np.abs(r_out) > thr)
                 & (np.sign(r_in) != np.sign(r_out)) & (np.abs(r_in + r_out) < thr / 2))
        bad = np.nonzero(spike)[0] + 1
        if len(bad):
            s = s.drop(s.index[bad])
    return s, n0 - len(s)


def fingerprint(s: pd.Series) -> str:
    body = "".join(f"{d:%Y-%m-%d},{v:.10g}\n" for d, v in zip(s.index, s.values))
    return "sha256:" + hashlib.sha256(body.encode("utf-8")).hexdigest()


def read_price_csv(path: str) -> pd.Series:
    """Read a CSV with a date column and a close column (Yahoo or NSE download formats)."""
    df = pd.read_csv(path)
    if df.empty:
        raise ValueError(f"{path} is empty")
    cols = {str(c).strip().lower(): c for c in df.columns}
    date_col = next((cols[k] for k in ("date", "datetime", "timestamp", "index_date") if k in cols),
                    df.columns[0])
    close_col = next((cols[k] for k in ("close", "close price", "closing price", "close_price",
                                        "adj close", "price", "rate", "value") if k in cols), None)
    if close_col is None:
        raise ValueError(f"{path} needs a 'Close' column (found: {', '.join(map(str, df.columns))})")
    dates_txt = df[date_col].astype(str).str.strip()
    if dates_txt.str.match(r"^\d{4}-\d{2}-\d{2}").all():
        dates = pd.to_datetime(dates_txt.str[:10], format="%Y-%m-%d", errors="coerce")
    else:
        try:
            dates = pd.to_datetime(dates_txt, dayfirst=True, format="mixed", errors="coerce")
        except (TypeError, ValueError):
            dates = pd.to_datetime(dates_txt, dayfirst=True, errors="coerce")
    values = pd.to_numeric(df[close_col].astype(str).str.replace(",", "", regex=False).str.strip(),
                           errors="coerce")
    s = pd.Series(values.values, index=pd.DatetimeIndex(dates))
    s = s[s.index.notna()]
    return s


# --------------------------------------------------------------------------- service
@dataclass
class PriceData:
    prices: pd.Series                 # clean daily closes, in the pair's own quote units
    info: UnderlyingInfo
    source: str                       # "local_csv" or the caller's own label, e.g. "backend/live"
    fetched_at: Optional[str]
    fingerprint: str
    points_removed: int
    warnings: List[Dict[str, str]] = field(default_factory=list)

    def audit(self) -> Dict[str, Any]:
        return {"source": self.source, "ticker": self.info.ticker, "fetched_at": self.fetched_at,
                "fingerprint": self.fingerprint, "first_date": self.prices.index[0].date().isoformat(),
                "last_date": self.prices.index[-1].date().isoformat(), "rows": int(len(self.prices)),
                "bad_points_removed": int(self.points_removed)}


class MarketDataService:
    """Local-CSV override plus whatever `_load_raw` a subclass provides."""

    def __init__(self, data_dir: str = "data", max_age_hours: float = CACHE_MAX_AGE_HOURS,
                 today: Optional[dt.date] = None):
        self.data_dir = data_dir
        self.max_age_hours = max_age_hours
        self.today = today
        self._memo: Dict[str, Tuple[PriceData, float]] = {}   # in-process copy, expires after max_age_hours

    def _local_csv(self, info: UnderlyingInfo) -> Optional[str]:
        folder = os.path.join(self.data_dir, "prices")
        for stem in (safe_name(info.underlying), safe_name(info.ticker)):
            path = os.path.join(folder, stem + ".csv")
            if os.path.exists(path):
                return path
        return None

    def get(self, info: UnderlyingInfo) -> PriceData:
        memo_key = f"{info.underlying}|{info.ticker}|{info.quote_unit}"
        hit = self._memo.get(memo_key)
        if hit is not None and time.monotonic() - hit[1] < self.max_age_hours * 3600:
            cached = hit[0]
            return PriceData(cached.prices, cached.info, cached.source, cached.fetched_at,
                             cached.fingerprint, cached.points_removed, list(cached.warnings))

        raw, source, fetched_at, warns = self._load_raw(info)
        clean, removed = clean_prices(raw, info.asset_class)
        if len(clean) < MIN_PRICE_POINTS:
            raise MarketDataUnavailable(
                f"Only {len(clean)} usable daily prices for {info.underlying} ({info.ticker}); "
                f"need at least {MIN_PRICE_POINTS}.")
        prices = clean * float(info.quote_unit)
        if removed:
            warns.append({"code": "BAD_PRICES_REMOVED",
                          "message": f"{removed} bad price rows (blank, zero or one-day spikes) were removed."})
        today = self.today or dt.date.today()
        last = prices.index[-1].date()
        if (today - last).days > STALE_AFTER_DAYS:
            warns.append({"code": "STALE_DATA",
                          "message": f"Latest {info.underlying} price is from {last.isoformat()} "
                                     f"({(today - last).days} days old)."})
        data = PriceData(prices, info, source, fetched_at, fingerprint(prices), removed, warns)
        self._memo[memo_key] = (data, time.monotonic())
        return PriceData(prices, info, source, fetched_at, data.fingerprint, removed, list(warns))

    def _load_raw(self, info: UnderlyingInfo) -> Tuple[pd.Series, str, Optional[str], List[Dict[str, str]]]:
        local = self._local_csv(info)
        if local:
            try:
                s = read_price_csv(local)
            except (OSError, ValueError) as exc:
                raise MarketDataUnavailable(f"Could not read {local}: {exc}") from exc
            mtime = dt.datetime.fromtimestamp(os.path.getmtime(local), dt.timezone.utc)
            return s, "local_csv", mtime.replace(microsecond=0).isoformat(), []
        raise MarketDataUnavailable(
            f"No price source is configured for {info.underlying}. Use app.simulation.market.BackendMarket, "
            f"or save a CSV with Date,Close columns at "
            f"{os.path.join(self.data_dir, 'prices', safe_name(info.underlying) + '.csv')}.")
