"""
INR conversion for product amounts, using the latest FX close from the market service.

Client wealth (liquid net worth, income) is held in INR, while a product can be
denominated in its underlying's currency (USD for S&P 500, the base currency for a
DCD). Comparing the two needs a real exchange rate, so the rate is read from the FX
underlyings in config/underlyings.yaml: directly (USD/INR) or crossed through USD
(USD/INR ÷ USD/JPY for JPY).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from app.core.config import get_underlyings
from app.core.errors import AppError
from app.market.service import get_history

HOME_CURRENCY = "INR"


@dataclass(frozen=True)
class FxQuote:
    currency: str
    inr_per_unit: float
    as_of: Optional[str]
    source: str
    pairs: tuple

    def as_dict(self) -> dict:
        return {
            "currency": self.currency,
            "inr_per_unit": round(self.inr_per_unit, 6),
            "as_of": self.as_of,
            "source": self.source,
            "pairs": list(self.pairs),
        }


def _fx_key(base: str, quote: str) -> Optional[str]:
    for key, meta in get_underlyings().items():
        if meta.get("asset_class") == "fx" and meta.get("base_currency") == base and meta.get("currency") == quote:
            return key
    return None


def _last_close(key: str) -> tuple:
    try:
        df, source, as_of, _ = get_history(key)
    except ValueError as exc:
        raise AppError(502, "FX_RATE_UNAVAILABLE", f"No market data for {key}: {exc}") from exc
    return float(df["close"].iloc[-1]), source, as_of


def inr_rate(currency: str) -> FxQuote:
    """INR per one unit of `currency`, from the latest available FX close."""
    ccy = (currency or HOME_CURRENCY).upper()
    if ccy == HOME_CURRENCY:
        return FxQuote(ccy, 1.0, None, "identity", ())

    direct = _fx_key(ccy, HOME_CURRENCY)
    if direct:
        rate, source, as_of = _last_close(direct)
        return FxQuote(ccy, rate, as_of, source, (direct,))

    usd_inr = _fx_key("USD", HOME_CURRENCY)
    usd_ccy = _fx_key("USD", ccy)
    if usd_inr and usd_ccy:
        a, source_a, as_of_a = _last_close(usd_inr)
        b, source_b, as_of_b = _last_close(usd_ccy)
        return FxQuote(ccy, a / b, min(as_of_a, as_of_b), f"{source_a}/{source_b}", (usd_inr, usd_ccy))

    raise AppError(
        422, "FX_RATE_UNAVAILABLE",
        f"No FX series converts {ccy} to {HOME_CURRENCY}; add one to config/underlyings.yaml.",
    )


def principal_in_inr(config: object) -> float:
    """The product's principal expressed in INR."""
    return float(config.principal) * inr_rate(config.currency).inr_per_unit  # type: ignore[attr-defined]
