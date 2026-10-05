"""Feeds the replay engine from the backend's own market-data service.

`app.market.service.get_history` (live yfinance -> disk cache -> bundled seed CSV) is the single
price source of the backend. The replay engine normally has its own loader; this adapter makes it
read the very same cleaned series, so `/api/analyze`, `/api/recommend`, `/api/simulate` and
`/api/assess` can never disagree because they looked at different prices.

A local CSV under `<data_dir>/prices/` still takes priority (the engine's documented override, also
what the offline tests use).
"""
from __future__ import annotations

import datetime as dt
from typing import Dict, List, Optional, Tuple

import pandas as pd

from app.core.config import get_underlyings
from app.market.service import get_history
from app.simulation.sim_engine.config import STALE_AFTER_DAYS
from app.simulation.sim_engine.errors import MarketDataUnavailable
from app.simulation.sim_engine.market_data import MarketDataService, PriceData, fingerprint
from app.simulation.sim_engine.underlyings import UnderlyingInfo


def backend_key(info: UnderlyingInfo) -> Optional[str]:
    """Backend underlying key (config/underlyings.yaml) for an engine underlying name."""
    underlyings = get_underlyings()
    name = info.underlying.upper()
    if name in underlyings:
        return name
    for key, meta in underlyings.items():  # the engine's "NIFTY" -> the backend's "NIFTY50"
        if meta.get("ticker") == info.ticker and meta.get("asset_class") != "fx":
            return key
    if info.asset_class == "fx" and info.base and info.quote:
        for key, meta in underlyings.items():
            if meta.get("asset_class") == "fx" and meta.get("base_currency") == info.base \
                    and meta.get("currency") == info.quote:
                return key
    return None


class BackendMarket(MarketDataService):
    """MarketDataService whose network/cache layer is the backend's `get_history`."""

    def _load_raw(self, info: UnderlyingInfo) -> Tuple[pd.Series, str, Optional[str], List[Dict[str, str]]]:
        if self._local_csv(info):
            return super()._load_raw(info)
        key = backend_key(info)
        if key is None:
            raise MarketDataUnavailable(f"{info.underlying} is not a configured underlying.")
        try:
            df, source, as_of, _ = get_history(key)
        except ValueError as exc:
            raise MarketDataUnavailable(str(exc)) from exc
        # `source` is "live", "cache" or "seed"; the engine labels it so audits show where prices came from.
        return df["close"].astype(float), f"backend/{source}", dt.datetime.now(dt.timezone.utc).replace(
            microsecond=0).isoformat(), []


__all__ = ["BackendMarket", "backend_key", "PriceData", "fingerprint", "STALE_AFTER_DAYS"]
