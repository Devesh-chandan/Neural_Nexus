"""Map an underlying name to a market-data ticker.

Rules, in order:
1. data/underlyings.json (your own overrides; edit this if a ticker is wrong)
2. Built-in index list below
3. "XXX/YYY" currency pairs -> Yahoo FX tickers (USD/INR -> INR=X, EUR/INR -> EURINR=X)
4. Something that already looks like a Yahoo ticker (^NSEI, ITC.NS, EURINR=X) is used as-is
5. Anything else is treated as an NSE stock symbol -> SYMBOL.NS
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Dict, Optional

from .errors import UnsupportedUnderlying
from .schema import split_pair

INDEXES: Dict[str, Dict[str, str]] = {
    "NIFTY": {"ticker": "^NSEI", "name": "Nifty 50"},
    "NIFTY50": {"ticker": "^NSEI", "name": "Nifty 50"},
    "SENSEX": {"ticker": "^BSESN", "name": "Sensex"},
    "BANKNIFTY": {"ticker": "^NSEBANK", "name": "Nifty Bank"},
    "NIFTYIT": {"ticker": "^CNXIT", "name": "Nifty IT"},
    "NIFTYNXT50": {"ticker": "^NSMIDCP", "name": "Nifty Next 50"},
    "FINNIFTY": {"ticker": "NIFTY_FIN_SERVICE.NS", "name": "Nifty Financial Services"},
    "MIDCPNIFTY": {"ticker": "NIFTY_MID_SELECT.NS", "name": "Nifty Midcap Select"},
}

# Indian convention: JPY is quoted per 100 JPY (RBI reference rate), Yahoo quotes per 1 JPY.
PER_100_CURRENCIES = {"JPY"}


@dataclass(frozen=True)
class UnderlyingInfo:
    underlying: str          # as given, e.g. "NIFTY" or "USD/INR"
    ticker: str              # e.g. "^NSEI" or "INR=X"
    name: str                # display name used in stories
    asset_class: str         # "equity" or "fx"
    quote_unit: float = 1.0  # multiply provider prices by this (JPY/INR -> 100)
    currency: str = "INR"    # currency of the underlying's price (equity only)
    base: Optional[str] = None   # fx only: "USD" in USD/INR
    quote: Optional[str] = None  # fx only: "INR" in USD/INR

    def to_dict(self) -> Dict[str, object]:
        return {"underlying": self.underlying, "ticker": self.ticker, "name": self.name,
                "asset_class": self.asset_class, "quote_unit": self.quote_unit}


def _load_overrides(data_dir: Optional[str]) -> Dict[str, Dict[str, object]]:
    if not data_dir:
        return {}
    path = os.path.join(data_dir, "underlyings.json")
    if not os.path.exists(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            raw = json.load(f)
        return {str(k).upper(): v for k, v in raw.items() if isinstance(v, dict)}
    except (OSError, ValueError) as exc:
        raise UnsupportedUnderlying(f"Could not read {path}: {exc}") from exc


def resolve_underlying(underlying: str, data_dir: Optional[str] = None) -> UnderlyingInfo:
    u = underlying.strip().upper()
    if not u:
        raise UnsupportedUnderlying("Underlying is empty.")

    override = _load_overrides(data_dir).get(u)
    pair = split_pair(u)
    if override:
        asset = str(override.get("asset_class", "fx" if pair else "equity"))
        if asset not in ("equity", "fx"):
            raise UnsupportedUnderlying(f"asset_class for {u} must be 'equity' or 'fx'.")
        return UnderlyingInfo(
            underlying=u, ticker=str(override["ticker"]), name=str(override.get("name", u)),
            asset_class=asset, quote_unit=float(override.get("quote_unit", 1.0)),
            currency=str(override.get("currency", "INR")),
            base=pair[0] if pair else None, quote=pair[1] if pair else None)

    if u in INDEXES:
        return UnderlyingInfo(u, INDEXES[u]["ticker"], INDEXES[u]["name"], "equity")

    if pair:
        base, quote = pair
        if base == quote:
            raise UnsupportedUnderlying(f"{u} is not a valid currency pair.")
        ticker = "INR=X" if (base, quote) == ("USD", "INR") else f"{base}{quote}=X"
        unit = 100.0 if (base in PER_100_CURRENCIES and quote == "INR") else 1.0
        name = f"{base}/{quote}" + (" (per 100)" if unit != 1.0 else "")
        return UnderlyingInfo(u, ticker, name, "fx", unit, currency=quote, base=base, quote=quote)

    if u.startswith("^") or u.endswith((".NS", ".BO")):
        return UnderlyingInfo(u, u, u, "equity")
    if u.endswith("=X"):
        raise UnsupportedUnderlying(f"Write currency pairs as XXX/YYY (e.g. USD/INR), not {u}.")

    allowed = set("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789&-_")
    if not set(u) <= allowed or len(u) > 20:
        raise UnsupportedUnderlying(f"{u!r} does not look like an NSE symbol, index or currency pair.")
    return UnderlyingInfo(u, f"{u}.NS", u, "equity")
