"""Payoff rules at maturity: the single source of truth for every product formula in the backend.

Two layers share exactly the same arithmetic:

* vectorised cores (`eln_money`, `cpn_money`, `dcd_money`): arrays of final/low price ratios in,
  money back out. Used by the historical replay statistics, the Monte Carlo, the scenario table,
  the payoff curve and the recommendation engine.
* path functions (`eln_payoff`, `cpn_payoff`, `dcd_payoff`): one price path in, a `PayoffResult`
  (with story details) out. Used by the 20-scenario replay. They call the cores.

`path` is the period's daily closes divided by the first close (path[0] == 1.0).

ELN  coupon = N x coupon_pa x tenor/12
     If the barrier was breached (any daily close strictly below the barrier; or, with
     barrier_monitoring="maturity", the final close alone) and the final price is below the
     strike: N x final/strike + coupon. Otherwise: N + coupon.
     No barrier given: the loss applies whenever the final price is below the strike.
     coupon_conditional: the coupon is forfeited when the barrier is breached.

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
from typing import Any, Dict, Optional, Tuple, Union

import numpy as np

from .config import EPS

Array = Union[float, np.ndarray]


@dataclass
class PayoffResult:
    money_back: float
    barrier_hit: bool                     # ELN: barrier breached (or ended below strike if no barrier)
    info: Dict[str, Any] = field(default_factory=dict)   # CPN: always False; DCD: converted


# ── Vectorised cores ───────────────────────────────────────────────────────────

def eln_money(final: Array, low: Array, notional: float, coupon_pa: float, tenor_months: float,
              strike_pct: float, barrier_pct: Optional[float],
              coupon_conditional: bool = False) -> Tuple[np.ndarray, np.ndarray]:
    """Money back and barrier-hit flag for arrays of final and lowest price ratios.

    `low` is the lowest close of the period over the barrier-observation dates, relative to the
    start (it includes the start itself, so it never exceeds 1.0 for a real path).
    """
    final = np.atleast_1d(np.asarray(final, dtype=float))
    low = np.atleast_1d(np.asarray(low, dtype=float))
    coupon = notional * coupon_pa * tenor_months / 12.0
    below_strike = final < strike_pct - EPS
    if barrier_pct is None:
        hit = below_strike
        at_risk = np.ones_like(below_strike, dtype=bool)
    else:
        hit = low < barrier_pct - EPS
        at_risk = hit
    principal = np.where(at_risk & below_strike, notional * final / strike_pct, notional)
    paid = np.where(hit, 0.0, coupon) if coupon_conditional else coupon
    return principal + paid, hit


def cpn_money(final: Array, notional: float, coupon_pa: float, tenor_months: float,
              protection_pct: float, participation_pct: float, cap_pct: Optional[float]) -> np.ndarray:
    final = np.atleast_1d(np.asarray(final, dtype=float))
    coupon = notional * coupon_pa * tenor_months / 12.0
    raw_upside = participation_pct * np.maximum(0.0, final - 1.0)
    upside = np.minimum(raw_upside, cap_pct) if cap_pct is not None else raw_upside
    return notional * (protection_pct + upside) + coupon


def dcd_money(final: Array, notional: float, coupon_pa: float, accrual_days: int, ref_rate: float,
              strike_rate: float, quote_unit: float, alt_is_base: bool) -> Tuple[np.ndarray, np.ndarray]:
    """Money back (in the deposit currency) and conversion flag for arrays of final rate ratios."""
    final = np.atleast_1d(np.asarray(final, dtype=float))
    interest = notional * coupon_pa * accrual_days / 365.0
    total = notional + interest
    final_rate = ref_rate * final
    k = strike_rate / quote_unit          # per 1 unit of the base currency
    f = final_rate / quote_unit
    if alt_is_base:                       # deposit = quote ccy (e.g. INR), alt = base (e.g. USD)
        converted = final_rate < strike_rate - EPS
        money = np.where(converted, (total / k) * f, total)
    else:                                 # deposit = base ccy (e.g. USD), alt = quote (e.g. INR)
        converted = final_rate > strike_rate + EPS
        money = np.where(converted, (total * k) / f, total)
    return money, converted


# ── Path functions (story details for the replay scenarios) ────────────────────

def _first_below(path: np.ndarray, level: float) -> Optional[int]:
    idx = np.nonzero(path < level - EPS)[0]
    return int(idx[0]) if len(idx) else None


def eln_payoff(path: np.ndarray, notional: float, coupon_pa: float, tenor_months: float,
               strike_pct: float, barrier_pct: Optional[float],
               barrier_monitoring: str = "daily", coupon_conditional: bool = False) -> PayoffResult:
    final = float(path[-1])
    coupon = notional * coupon_pa * tenor_months / 12.0
    below_strike = final < strike_pct - EPS
    if barrier_monitoring == "maturity":
        observed_low = min(float(path[0]), final)
        hit_idx = (len(path) - 1) if barrier_pct is not None and final < barrier_pct - EPS else None
    else:
        observed_low = float(path.min())
        hit_idx = _first_below(path, barrier_pct) if barrier_pct is not None else None
    money, hit = eln_money(final, observed_low, notional, coupon_pa, tenor_months, strike_pct,
                           barrier_pct, coupon_conditional)
    return PayoffResult(float(money[0]), bool(hit[0]), {
        "final": final, "low": float(path.min()), "coupon": coupon, "hit_index": hit_idx,
        "below_strike": below_strike, "has_barrier": barrier_pct is not None})


def cpn_payoff(path: np.ndarray, notional: float, coupon_pa: float, tenor_months: float,
               protection_pct: float, participation_pct: float, cap_pct: Optional[float]) -> PayoffResult:
    final = float(path[-1])
    coupon = notional * coupon_pa * tenor_months / 12.0
    raw_upside = participation_pct * max(0.0, final - 1.0)
    upside = min(raw_upside, cap_pct) if cap_pct is not None else raw_upside
    money = cpn_money(final, notional, coupon_pa, tenor_months, protection_pct, participation_pct, cap_pct)
    return PayoffResult(float(money[0]), False, {
        "final": final, "coupon": coupon, "upside": upside,
        "capped": cap_pct is not None and raw_upside > cap_pct + EPS})


def dcd_payoff(path: np.ndarray, notional: float, coupon_pa: float, accrual_days: int,
               ref_rate: float, strike_rate: float, quote_unit: float, alt_is_base: bool) -> PayoffResult:
    interest = notional * coupon_pa * accrual_days / 365.0
    total = notional + interest
    final = float(path[-1])
    final_rate = ref_rate * final
    k = strike_rate / quote_unit
    money, converted = dcd_money(final, notional, coupon_pa, accrual_days, ref_rate, strike_rate,
                                 quote_unit, alt_is_base)
    did_convert = bool(converted[0])
    alt_amount = total / k if alt_is_base else total * k
    return PayoffResult(float(money[0]), did_convert, {
        "final": final, "final_rate": final_rate, "interest": interest,
        "alt_amount": alt_amount if did_convert else None})
