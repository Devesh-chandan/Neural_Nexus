"""Market Data Adapter: provider -> cache -> clean, normalised price series.

Where prices come from, in order:
  1. data/prices/<UNDERLYING>.csv   your own file (e.g. downloaded from NSE); always wins
  2. data/cache/<TICKER>.csv        saved copy of an earlier download, if fresh enough
  3. Yahoo Finance (yfinance, then Yahoo's chart API as a backup), saved to the cache
  4. If the live download fails, an older cached copy is used and a warning is added.
     With no cached copy, the run stops with MARKET_DATA_UNAVAILABLE. Stale data is
     never presented as fresh.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import re
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np
import pandas as pd

from .config import (BREAKER_COOLDOWN_SECONDS, BREAKER_FAILURES, CACHE_MAX_AGE_HOURS,
                     HTTP_TIMEOUT_SECONDS, MIN_PRICE_POINTS, SPIKE_THRESHOLD, STALE_AFTER_DAYS)
from .errors import MarketDataUnavailable
from .underlyings import UnderlyingInfo


# --------------------------------------------------------------------------- helpers
def safe_name(text: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]", "_", text)


def _utc_now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


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


# --------------------------------------------------------------------------- circuit breaker
class CircuitBreaker:
    """After N straight live-data failures, stop calling the provider for a cool-down."""

    def __init__(self, failures: int = BREAKER_FAILURES, cooldown: float = BREAKER_COOLDOWN_SECONDS):
        self.failures_allowed = failures
        self.cooldown = cooldown
        self.failures = 0
        self.open_until = 0.0

    def allow(self) -> bool:
        return time.monotonic() >= self.open_until

    def record_success(self) -> None:
        self.failures = 0
        self.open_until = 0.0

    def record_failure(self) -> None:
        self.failures += 1
        if self.failures >= self.failures_allowed:
            self.open_until = time.monotonic() + self.cooldown
            self.failures = 0

    def reset(self) -> None:
        self.record_success()


BREAKER = CircuitBreaker()


# --------------------------------------------------------------------------- providers
class ProviderError(Exception):
    pass


class YFinanceProvider:
    name = "yahoo/yfinance"

    def available(self) -> bool:
        try:
            import yfinance  # noqa: F401
            return True
        except ImportError:
            return False

    def fetch(self, ticker: str) -> pd.Series:
        import yfinance as yf
        df = yf.Ticker(ticker).history(period="max", interval="1d", auto_adjust=False, actions=False)
        if df is None or df.empty or "Close" not in df.columns:
            raise ProviderError(f"no data returned for {ticker}")
        # 'Close' is split-adjusted but not dividend-adjusted: right for barriers and strikes.
        return pd.Series(df["Close"].values, index=_to_naive_dates(df.index))


class YahooChartProvider:
    name = "yahoo/chart-api"
    URL = ("https://query2.finance.yahoo.com/v8/finance/chart/{sym}"
           "?period1=0&period2={now}&interval=1d&events=history")

    def available(self) -> bool:
        return True

    def fetch(self, ticker: str) -> pd.Series:
        url = self.URL.format(sym=urllib.parse.quote(ticker, safe=""), now=int(time.time()))
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) sim-engine/1.0",
            "Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_SECONDS) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        chart = payload.get("chart") or {}
        if chart.get("error"):
            raise ProviderError(str(chart["error"].get("description") or chart["error"]))
        result = (chart.get("result") or [None])[0]
        if not result or not result.get("timestamp"):
            raise ProviderError(f"no data returned for {ticker}")
        offset = int((result.get("meta") or {}).get("gmtoffset") or 0)
        ts = np.asarray(result["timestamp"], dtype="int64") + offset
        closes = np.asarray(result["indicators"]["quote"][0]["close"], dtype=float)
        return pd.Series(closes, index=pd.to_datetime(ts, unit="s").normalize())


DEFAULT_PROVIDERS: Sequence[Any] = (YFinanceProvider(), YahooChartProvider())


# --------------------------------------------------------------------------- service
@dataclass
class PriceData:
    prices: pd.Series                 # clean daily closes, in the pair's own quote units
    info: UnderlyingInfo
    source: str                       # "local_csv" | "cache" | "yahoo/yfinance" | "yahoo/chart-api"
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
    def __init__(self, data_dir: str = "data", offline: bool = False, refresh: bool = False,
                 max_age_hours: float = CACHE_MAX_AGE_HOURS, providers: Optional[Sequence[Any]] = None,
                 today: Optional[dt.date] = None):
        self.data_dir = data_dir
        self.offline = offline
        self.refresh = refresh
        self.max_age_hours = max_age_hours
        self.providers = list(providers) if providers is not None else list(DEFAULT_PROVIDERS)
        self.today = today
        self._memo: Dict[str, Tuple[PriceData, float]] = {}   # in-process copy, expires like the cache

    # -- paths
    def _cache_paths(self, ticker: str) -> Tuple[str, str]:
        base = os.path.join(self.data_dir, "cache", safe_name(ticker))
        return base + ".csv", base + ".meta.json"

    def _local_csv(self, info: UnderlyingInfo) -> Optional[str]:
        folder = os.path.join(self.data_dir, "prices")
        for stem in (safe_name(info.underlying), safe_name(info.ticker)):
            path = os.path.join(folder, stem + ".csv")
            if os.path.exists(path):
                return path
        return None

    # -- cache
    def _read_cache(self, ticker: str) -> Tuple[Optional[pd.Series], Dict[str, Any]]:
        csv_path, meta_path = self._cache_paths(ticker)
        if not os.path.exists(csv_path):
            return None, {}
        try:
            s = read_price_csv(csv_path)
            meta: Dict[str, Any] = {}
            if os.path.exists(meta_path):
                with open(meta_path, "r", encoding="utf-8") as f:
                    meta = json.load(f)
            return s, meta
        except (OSError, ValueError):
            return None, {}

    def _write_cache(self, ticker: str, s: pd.Series, source: str, fetched_at: str) -> None:
        csv_path, meta_path = self._cache_paths(ticker)
        os.makedirs(os.path.dirname(csv_path), exist_ok=True)
        df = pd.DataFrame({"date": s.index.strftime("%Y-%m-%d"), "close": s.values})
        tmp = csv_path + ".tmp"
        df.to_csv(tmp, index=False)
        os.replace(tmp, csv_path)
        meta = {"ticker": ticker, "source": source, "fetched_at": fetched_at, "rows": int(len(s)),
                "first_date": df["date"].iloc[0], "last_date": df["date"].iloc[-1]}
        with open(meta_path + ".tmp", "w", encoding="utf-8") as f:
            json.dump(meta, f, indent=2)
        os.replace(meta_path + ".tmp", meta_path)

    @staticmethod
    def _age_hours(meta: Dict[str, Any]) -> float:
        try:
            fetched = dt.datetime.fromisoformat(str(meta["fetched_at"]))
            if fetched.tzinfo is None:
                fetched = fetched.replace(tzinfo=dt.timezone.utc)
            return (dt.datetime.now(dt.timezone.utc) - fetched).total_seconds() / 3600.0
        except (KeyError, ValueError, TypeError):
            return float("inf")

    # -- main entry
    def get(self, info: UnderlyingInfo) -> PriceData:
        memo_key = f"{info.underlying}|{info.ticker}|{info.quote_unit}"
        hit = self._memo.get(memo_key)
        if hit is not None and (self.offline or time.monotonic() - hit[1] < self.max_age_hours * 3600):
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

        cached, meta = self._read_cache(info.ticker)
        if cached is not None and not self.refresh and (
                self.offline or self._age_hours(meta) < self.max_age_hours):
            return cached, "cache", meta.get("fetched_at"), []

        fix = (f"Fix: check your internet, correct the ticker in {os.path.join(self.data_dir, 'underlyings.json')}, "
               f"or save a CSV with Date,Close columns at "
               f"{os.path.join(self.data_dir, 'prices', safe_name(info.underlying) + '.csv')}.")
        if self.offline:
            raise MarketDataUnavailable(
                f"Offline mode and no saved prices for {info.underlying} ({info.ticker}). "
                f"Run 'python -m sim_engine fetch {info.underlying}' while online. {fix}")

        errors: List[str] = []
        if not BREAKER.allow():
            errors.append("live provider paused after repeated failures (circuit breaker)")
        else:
            for provider in self.providers:
                if not provider.available():
                    continue
                try:
                    s = provider.fetch(info.ticker)
                    s = s[np.isfinite(s.values)]
                    if len(s) == 0:
                        raise ProviderError("no usable rows")
                    fetched_at = _utc_now_iso()
                    BREAKER.record_success()
                    try:
                        self._write_cache(info.ticker, s, provider.name, fetched_at)
                    except OSError:
                        pass  # caching is best-effort
                    return s, provider.name, fetched_at, []
                except Exception as exc:  # provider libraries raise many types
                    errors.append(f"{provider.name}: {str(exc)[:160]}")
            BREAKER.record_failure()

        if cached is not None:
            return cached, "cache", meta.get("fetched_at"), [{
                "code": "PROVIDER_FAILED_USING_CACHE",
                "message": f"Live prices for {info.ticker} failed ({'; '.join(errors) or 'no provider'}). "
                           f"Using saved prices fetched {meta.get('fetched_at', 'earlier')}."}]
        raise MarketDataUnavailable(
            f"Could not get prices for {info.underlying} ({info.ticker}): "
            f"{'; '.join(errors) or 'no provider available'}. {fix}")
