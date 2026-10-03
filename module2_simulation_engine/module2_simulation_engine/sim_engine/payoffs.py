"""Payoff rules at maturity. Pure functions: a price path in, money back out.

`path` is the period's daily closes divided by the first close (path[0] == 1.0).

ELN  coupon = N x coupon_pa x tenor/12
     If the barrier was breached (any daily close strictly below barrier) and the final
     price is below the strike: N x final/strike + coupon. Otherwise: N + coupon.
     No barrier given: the loss applies whenever the final price is below the strike.

CPN  money = N x (protection + min(participation x max(0, final-1), cap)) + coupon
     (cap = maximum upside return; no cap if null; coupon optional)

DCD  interest = N x coupon_pa x days/365 (days = contractual calendar days)
     alt_currency is the currency the bank may repay you in; you deposit the other one.
     The bank repays in alt_currency when it has become the weaker one at maturity:
       alt is the pair's base (USD in USD/INR, deposit INR): converted if rate < strike
       alt is the pair's quote (INR in USD/INR, deposit USD): converted if rate > strike
     Converted money is valued back in your deposit currency at the final market rate.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Optional

import numpy as np

from .config import EPS


@dataclass
class PayoffResult:
    money_back: float
    barrier_hit: bool                     # ELN: barrier breached (or ended below strike if no barrier)
    info: Dict[str, Any] = field(default_factory=dict)   # CPN: always False; DCD: converted


def _first_below(path: np.ndarray, level: float) -> Optional[int]:
    idx = np.nonzero(path < level - EPS)[0]
    return int(idx[0]) if len(idx) else None


def eln_payoff(path: np.ndarray, notional: float, coupon_pa: float, tenor_months: float,
               strike_pct: float, barrier_pct: Optional[float]) -> PayoffResult:
    final = float(path[-1])
    coupon = notional * coupon_pa * tenor_months / 12.0
    below_strike = final < strike_pct - EPS
    if barrier_pct is None:
        hit_idx = None
        at_risk = True
        hit = below_strike
    else:
        hit_idx = _first_below(path, barrier_pct)
        at_risk = hit_idx is not None
        hit = at_risk
    if at_risk and below_strike:
        money = notional * final / strike_pct + coupon
    else:
        money = notional + coupon
    return PayoffResult(money, hit, {
        "final": final, "low": float(path.min()), "coupon": coupon, "hit_index": hit_idx,
        "below_strike": below_strike, "has_barrier": barrier_pct is not None})


def cpn_payoff(path: np.ndarray, notional: float, coupon_pa: float, tenor_months: float,
               protection_pct: float, participation_pct: float, cap_pct: Optional[float]) -> PayoffResult:
    final = float(path[-1])
    coupon = notional * coupon_pa * tenor_months / 12.0
    raw_upside = participation_pct * max(0.0, final - 1.0)
    upside = min(raw_upside, cap_pct) if cap_pct is not None else raw_upside
    money = notional * (protection_pct + upside) + coupon
    return PayoffResult(money, False, {
        "final": final, "coupon": coupon, "upside": upside,
        "capped": cap_pct is not None and raw_upside > cap_pct + EPS})


def dcd_payoff(path: np.ndarray, notional: float, coupon_pa: float, accrual_days: int,
               ref_rate: float, strike_rate: float, quote_unit: float, alt_is_base: bool) -> PayoffResult:
    interest = notional * coupon_pa * accrual_days / 365.0
    total = notional + interest
    final_rate = ref_rate * float(path[-1])
    k = strike_rate / quote_unit          # per 1 unit of the base currency
    f = final_rate / quote_unit
    if alt_is_base:                       # deposit = quote ccy (e.g. INR), alt = base (e.g. USD)
        converted = final_rate < strike_rate - EPS
        alt_amount = total / k
        money = alt_amount * f if converted else total
    else:                                 # deposit = base ccy (e.g. USD), alt = quote (e.g. INR)
        converted = final_rate > strike_rate + EPS
        alt_amount = total * k
        money = alt_amount / f if converted else total
    return PayoffResult(money, converted, {
        "final": float(path[-1]), "final_rate": final_rate, "interest": interest,
        "alt_amount": alt_amount if converted else None})
