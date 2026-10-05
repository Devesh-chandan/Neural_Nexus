"""
Indicative fair-value check (Section 6.7).

Uses Black-Scholes / Garman-Kohlhagen with EWMA vol, configured risk-free rates,
per-underlying dividend yield (config/underlyings.yaml), 15% issuer margin haircut. Exposes:
  - indicative_coupon (or participation / interest) p.a.
  - pricing_flag: "ok" or "coupon_above_indicative"

Labelled everywhere: "Indicative, model-based sanity check, not an issuer quote."
"""
from __future__ import annotations

import math
from typing import Optional

import numpy as np
from scipy.stats import norm

from app.core.config import get_products_config, get_underlyings
from app.schemas.analysis import PricingInfo


def _bs_call(S: float, K: float, r: float, sigma: float, T: float, q: float = 0.0) -> float:
    """Black-Scholes call price (Garman-Kohlhagen with q as foreign rate)."""
    if T <= 0 or sigma <= 0:
        return max(0.0, S * math.exp(-q * T) - K * math.exp(-r * T))
    d1 = (math.log(S / K) + (r - q + 0.5 * sigma**2) * T) / (sigma * math.sqrt(T))
    d2 = d1 - sigma * math.sqrt(T)
    return S * math.exp(-q * T) * norm.cdf(d1) - K * math.exp(-r * T) * norm.cdf(d2)


def _bs_put(S: float, K: float, r: float, sigma: float, T: float, q: float = 0.0) -> float:
    """Black-Scholes put price."""
    if T <= 0 or sigma <= 0:
        return max(0.0, K * math.exp(-r * T) - S * math.exp(-q * T))
    d1 = (math.log(S / K) + (r - q + 0.5 * sigma**2) * T) / (sigma * math.sqrt(T))
    d2 = d1 - sigma * math.sqrt(T)
    return K * math.exp(-r * T) * norm.cdf(-d2) - S * math.exp(-q * T) * norm.cdf(-d1)


def _cash_or_nothing_put(
    S: float, K: float, r: float, sigma: float, T: float, q: float = 0.0
) -> float:
    """Cash-or-Nothing put: pays $1 if S_T < K."""
    if T <= 0 or sigma <= 0:
        return math.exp(-r * T) if S < K else 0.0
    d2 = (math.log(S / K) + (r - q - 0.5 * sigma**2) * T) / (sigma * math.sqrt(T))
    return math.exp(-r * T) * norm.cdf(-d2)


def _get_rf_rate(currency: str) -> float:
    cfg = get_products_config()
    return cfg["risk_free_rates"].get(currency, 0.065)


def _dividend_yield(config: object) -> float:
    """Continuous dividend yield of the underlying (0 if not configured)."""
    meta = get_underlyings().get(config.underlying, {})  # type: ignore[attr-defined]
    return float(meta.get("dividend_yield", 0.0) or 0.0)


def _get_margin() -> float:
    return get_products_config()["issuer_margin_haircut"]


def indicative_eln(config: object, sigma: float, s0: float) -> PricingInfo:
    """ELN indicative coupon per Section 6.7."""
    r = _get_rf_rate(config.currency)  # type: ignore[attr-defined]
    margin = _get_margin()
    T = config.tenor_months / 12.0  # type: ignore[attr-defined]
    B = config.barrier_pct * s0  # type: ignore[attr-defined]

    # Short put + cash-or-nothing put premium
    q = _dividend_yield(config)
    put_val = _bs_put(s0, B, r, sigma, T, q)
    con_put_val = _cash_or_nothing_put(s0, B, r, sigma, T, q)
    # Combined: Put(K=B) + (S0 - B)*CashOrNothing(K=B), normalised by S0
    premium_fraction = (put_val + (s0 - B) * con_put_val) / s0

    indicative_coupon_over_tenor = (
        (math.exp(r * T) - 1) + premium_fraction * (1 - margin) * math.exp(r * T)
    )
    indicative_pa = indicative_coupon_over_tenor / T

    client_coupon_pa = config.coupon_pa  # type: ignore[attr-defined]
    flag = "ok"
    if client_coupon_pa > indicative_pa * 1.25:
        flag = "coupon_above_indicative"

    return PricingInfo(
        indicative=round(indicative_pa, 6),
        flag=flag,  # type: ignore[arg-type]
    )


def indicative_cpn(config: object, sigma: float, s0: float) -> PricingInfo:
    """CPN affordable participation per Section 6.7."""
    r = _get_rf_rate(config.currency)  # type: ignore[attr-defined]
    margin = _get_margin()
    T = config.tenor_months / 12.0  # type: ignore[attr-defined]
    protection_pct = config.protection_pct  # type: ignore[attr-defined]
    cap_pct = config.cap_pct  # type: ignore[attr-defined]

    option_budget = 1.0 - protection_pct * math.exp(-r * T)

    # ATM call (or call spread to cap if capped)
    q = _dividend_yield(config)
    atm_call = _bs_call(s0, s0, r, sigma, T, q)
    if cap_pct is not None:
        cap_call = _bs_call(s0, s0 * (1.0 + cap_pct), r, sigma, T, q)
        call_val = atm_call - cap_call
    else:
        call_val = atm_call

    call_fraction = call_val / s0 if s0 > 0 else 1e-6
    call_fraction = max(call_fraction, 1e-6)

    indicative_participation = option_budget * (1 - margin) / call_fraction
    client_participation = config.participation_pct  # type: ignore[attr-defined]
    flag = "ok"
    if client_participation > indicative_participation * 1.25:
        flag = "coupon_above_indicative"

    return PricingInfo(
        indicative=round(indicative_participation, 6),
        flag=flag,  # type: ignore[arg-type]
    )


def indicative_dcd(config: object, sigma: float, s0: float) -> PricingInfo:
    """DCD indicative interest rate per Section 6.7."""
    # For DCD: indicative interest = r_base + short_call_premium * (1-margin) / T
    r_base = _get_rf_rate(config.base_currency)  # type: ignore[attr-defined]
    r_quote = _get_rf_rate(config.alt_currency)  # type: ignore[attr-defined]
    margin = _get_margin()
    T = config.tenor_months / 12.0  # type: ignore[attr-defined]
    K = config.strike  # type: ignore[attr-defined]

    # Garman-Kohlhagen: S is quoted in the alt currency per unit of base, so the domestic rate is
    # the alt-currency rate and the foreign rate (the "dividend yield") is the base-currency rate.
    call_val = _bs_call(s0, K, r_quote, sigma, T, q=r_base)
    call_fraction = call_val / s0 if s0 > 0 else 0.0

    indicative_interest = r_base + call_fraction * (1 - margin) / T
    client_interest = config.interest_pa  # type: ignore[attr-defined]
    flag = "ok"
    if client_interest > indicative_interest * 1.25:
        flag = "coupon_above_indicative"

    return PricingInfo(
        indicative=round(indicative_interest, 6),
        flag=flag,  # type: ignore[arg-type]
    )


def compute_pricing(config: object, sigma: float, s0: float) -> PricingInfo:
    """Dispatch to the appropriate indicative pricer."""
    pt = config.product_type  # type: ignore[attr-defined]
    if pt == "ELN":
        return indicative_eln(config, sigma, s0)
    elif pt == "CPN":
        return indicative_cpn(config, sigma, s0)
    elif pt == "DCD":
        return indicative_dcd(config, sigma, s0)
    else:
        raise ValueError(f"Unknown product type: {pt}")
