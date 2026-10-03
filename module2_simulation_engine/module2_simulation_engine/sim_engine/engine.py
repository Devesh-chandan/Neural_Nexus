"""Module 2 entry point: one product in -> 20 historical scenarios out.

    from sim_engine import run_simulation
    result = run_simulation({"product_type": "ELN", "underlying": "NIFTY", ...})

Steps
  1. Validate the product (schema.py)
  2. Load clean daily prices for the underlying (market_data.py)
  3. Cut history into every period of the product's length (windows.py)
  4. Pick 20 periods with the fixed slot rule (selector.py)
  5. Replay each period's % path on the product and compute money back (payoffs.py)
  6. Return scenarios + warnings + an audit block
"""

from __future__ import annotations

import datetime as dt
import json
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

from .config import ENGINE_VERSION, N_SCENARIOS, SPACING_TRADING_DAYS
from .errors import NotEnoughHistory, SimulationError, UnsupportedUnderlying
from .market_data import MarketDataService, PriceData
from .payoffs import PayoffResult, cpn_payoff, dcd_payoff, eln_payoff
from .schema import Product, canonical_product, parse_product, stable_id
from .selector import select_scenarios
from .stories import cpn_story, dcd_story, eln_story, fmt_money
from .underlyings import UnderlyingInfo, resolve_underlying
from .windows import add_tenor, build_windows, path_of

HISTORY_MODES = ("latest", "start_date")

PAYOFF_RULES = {
    "ELN": "coupon = notional x coupon_pa x tenor/12. If any daily close is strictly below the barrier "
           "and the final price is below the strike: notional x final/strike + coupon; otherwise "
           "notional + coupon. No barrier: the loss applies whenever final < strike.",
    "CPN": "notional x (protection + min(participation x max(0, final/start - 1), cap)) + "
           "notional x coupon_pa x tenor/12.",
    "DCD": "interest = notional x coupon_pa x days/365. Repaid in alt_currency at the strike when "
           "alt_currency is the weaker side of the strike at maturity, valued back at the final rate.",
}


@dataclass
class Settings:
    history_until: str = "latest"   # "latest": use all history | "start_date": only data up to start_date
    n_scenarios: int = N_SCENARIOS
    spacing: int = SPACING_TRADING_DAYS
    today: Optional[dt.date] = None

    def check(self) -> None:
        if self.history_until not in HISTORY_MODES:
            raise SimulationError("INVALID_SETTINGS", f"history_until must be one of {HISTORY_MODES}.")
        if not 1 <= int(self.n_scenarios) <= 100:
            raise SimulationError("INVALID_SETTINGS", "n_scenarios must be between 1 and 100.")
        if not 1 <= int(self.spacing) <= 500:
            raise SimulationError("INVALID_SETTINGS", "spacing must be between 1 and 500 trading days.")


def _r2(x: float) -> float:
    """Round to 2 decimals without ever returning -0.0."""
    return round(x, 2) + 0.0


def _dedupe(items: List[Dict[str, str]]) -> List[Dict[str, str]]:
    seen, out = set(), []
    for w in items:
        key = (w.get("code"), w.get("message"))
        if key not in seen:
            seen.add(key)
            out.append(w)
    return out


def _check_asset(product: Product, info: UnderlyingInfo) -> None:
    expected = "fx" if product.product_type == "DCD" else "equity"
    if info.asset_class != expected:
        kind = "a currency pair like USD/INR" if expected == "fx" else "a stock or index"
        raise UnsupportedUnderlying(f"A {product.product_type} needs {kind}; {product.underlying} is not.")


class _Context:
    """Everything needed to price one path for this product."""

    def __init__(self, product: Product, info: UnderlyingInfo, ref_price: float):
        self.p = product
        self.info = info
        self.ref_price = ref_price
        if product.product_type == "DCD":
            self.alt_is_base = product.alt_currency == info.base
            self.currency = info.quote if self.alt_is_base else info.base
            start = pd.Timestamp(product.start_date)
            self.accrual_days = max(1, int((add_tenor(start, product.tenor_months) - start).days))
        else:
            self.alt_is_base = False
            self.currency = info.currency
            self.accrual_days = 0

    def price(self, path: np.ndarray) -> PayoffResult:
        p = self.p
        if p.product_type == "ELN":
            return eln_payoff(path, p.notional, p.coupon_pa, p.tenor_months, p.strike_pct, p.barrier_pct)
        if p.product_type == "CPN":
            return cpn_payoff(path, p.notional, p.coupon_pa, p.tenor_months,
                              p.protection_pct, p.participation_pct, p.cap_pct)
        return dcd_payoff(path, p.notional, p.coupon_pa, self.accrual_days, self.ref_price,
                          p.strike_rate, self.info.quote_unit, self.alt_is_base)

    def story(self, r: PayoffResult, hit_date: Optional[pd.Timestamp]) -> str:
        p = self.p
        money = fmt_money(r.money_back, self.currency)
        if p.product_type == "ELN":
            return eln_story(self.info.name, r, p.strike_pct, p.barrier_pct, hit_date, money)
        if p.product_type == "CPN":
            return cpn_story(self.info.name, r, p.protection_pct, p.participation_pct, p.cap_pct, money)
        return dcd_story(self.info.name, r, p.strike_rate, p.alt_currency, money)


def _dcd_checks(product: Product, ctx: _Context, ref_date: pd.Timestamp) -> List[Dict[str, str]]:
    out: List[Dict[str, str]] = []
    k, s = product.strike_rate, ctx.ref_price
    crossed = s < k if ctx.alt_is_base else s > k
    if crossed:
        side = "below" if ctx.alt_is_base else "above"
        out.append({"code": "STRIKE_ALREADY_CROSSED",
                    "message": f"On {ref_date.date().isoformat()} {product.underlying} was {s:.4f}, already "
                               f"{side} the {k:.4f} strike, so this deposit starts on the side where it is "
                               f"repaid in {product.alt_currency}. Check strike_rate and alt_currency."})
    if not 0.7 <= k / s <= 1.3:
        out.append({"code": "STRIKE_FAR_FROM_SPOT",
                    "message": f"strike_rate {k} is {abs(k / s - 1) * 100:.0f}% away from the rate of {s:.4f} "
                               f"on {ref_date.date().isoformat()}. Check the quote unit."})
    return out


def _reference(dates: pd.DatetimeIndex, values: np.ndarray, product: Product
               ) -> Tuple[int, List[Dict[str, str]]]:
    """Reference point = last trading day on or before start_date (sets the DCD strike's moneyness)."""
    i = int(dates.searchsorted(pd.Timestamp(product.start_date), side="right")) - 1
    notes: List[Dict[str, str]] = []
    if i < 0:
        i = 0
        if product.product_type == "DCD":
            notes.append({"code": "START_BEFORE_DATA",
                          "message": f"start_date {product.start_date} is before the first price "
                                     f"({dates[0].date()}); the first available rate is used as reference."})
    return i, notes


def run_simulation(raw: Dict[str, Any], settings: Optional[Settings] = None,
                   market: Optional[MarketDataService] = None, data_dir: str = "data") -> Dict[str, Any]:
    settings = settings or Settings()
    settings.check()
    today = settings.today or dt.date.today()

    product, warnings = parse_product(raw, today)
    market = market or MarketDataService(data_dir=data_dir, today=today)
    info = resolve_underlying(product.underlying, market.data_dir)
    _check_asset(product, info)
    pdata: PriceData = market.get(info)
    warnings += pdata.warnings

    prices = pdata.prices
    if settings.history_until == "start_date":
        prices = prices[prices.index <= pd.Timestamp(product.start_date)]
        if len(prices) < 2:
            raise NotEnoughHistory(f"No {info.underlying} prices on or before start_date {product.start_date}.")
    dates = prices.index
    values = prices.values.astype(float)

    ref_i, ref_notes = _reference(dates, values, product)
    warnings += ref_notes
    ctx = _Context(product, info, float(values[ref_i]))
    if product.product_type == "DCD":
        warnings += _dcd_checks(product, ctx, dates[ref_i])

    win = build_windows(dates, values, product.tenor_months)
    if len(win) == 0:
        raise NotEnoughHistory(
            f"{info.underlying} prices run from {dates[0].date()} to {dates[-1].date()}, which has no "
            f"complete {product.tenor_months:g}-month period.")
    picks, spacing_used, notes = select_scenarios(win, values, info.asset_class,
                                                  settings.n_scenarios, settings.spacing)
    warnings += notes

    scenarios: List[Dict[str, Any]] = []
    for n, pick in enumerate(picks, start=1):
        s, e = int(win.start[pick.w]), int(win.end[pick.w])
        path = path_of(values, s, e)
        r = ctx.price(path)
        hit_idx = r.info.get("hit_index")
        hit_date = dates[s + hit_idx] if hit_idx is not None else None
        money = round(float(r.money_back), 2)
        scenarios.append({
            "id": n,
            "situation": pick.label,
            "period": {"start": dates[s].date().isoformat(), "end": dates[e].date().isoformat()},
            "market_move_pct": _r2(float(win.move[pick.w]) * 100),
            "barrier_hit": bool(r.barrier_hit),
            "money_back": money,
            "return_pct": _r2((float(r.money_back) - product.notional) / product.notional * 100),
            "story": ctx.story(r, hit_date),
        })

    data_as_of = dates[-1].date().isoformat()
    run_key = json.dumps({"product": canonical_product(product), "data": pdata.fingerprint,
                          "as_of": data_as_of, "engine": ENGINE_VERSION,
                          "settings": [settings.history_until, settings.n_scenarios, settings.spacing]},
                         sort_keys=True)
    return {
        "run_id": stable_id("sim", run_key),
        "product_id": product.product_id,
        "data_as_of": data_as_of,
        "currency": ctx.currency,
        "scenarios": scenarios,
        "warnings": _dedupe(warnings),
        "audit": {
            "engine_version": ENGINE_VERSION,
            "created_at": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
            "product": product.to_dict(),
            "underlying": info.to_dict(),
            "market_data": pdata.audit(),
            "reference": {"date": dates[ref_i].date().isoformat(), "price": round(float(values[ref_i]), 6)},
            "selection": {
                "periods_available": len(win), "scenarios": len(scenarios),
                "spacing_trading_days": spacing_used, "history_until": settings.history_until,
                "history_used": {"from": dates[0].date().isoformat(), "to": data_as_of},
                "rule": "worst, best, closest to -10%, calmest near 0%, most recent, "
                        "then evenly spaced along the line-up",
            },
            "payoff_rule": PAYOFF_RULES[product.product_type],
            "note": "Historical replay of real past periods. Not a forecast.",
        },
    }


def run_batch(items: List[Any], settings: Optional[Settings] = None,
              market: Optional[MarketDataService] = None, data_dir: str = "data") -> List[Dict[str, Any]]:
    """Run many products; one bad product never stops the others."""
    settings = settings or Settings()
    market = market or MarketDataService(data_dir=data_dir, today=settings.today)
    out: List[Dict[str, Any]] = []
    for i, raw in enumerate(items):
        try:
            out.append({"index": i, "status": "ok", "result": run_simulation(raw, settings, market)})
        except SimulationError as exc:
            out.append({"index": i, "status": "error", "error": exc.to_dict()})
        except Exception as exc:  # never leak a stack trace to callers
            out.append({"index": i, "status": "error",
                        "error": {"code": "INTERNAL_ERROR", "message": f"{type(exc).__name__}: {exc}"[:300]}})
    return out


def payoff_curve(raw: Dict[str, Any], market: Optional[MarketDataService] = None,
                 data_dir: str = "data", today: Optional[dt.date] = None) -> Dict[str, Any]:
    """Money back for every possible ending (for the payoff chart). Pure formula, same rules.

    ELN with a barrier has two lines: barrier never touched / touched.
    DCD needs the reference rate on start_date, so it reads market data.
    """
    product, _ = parse_product(raw, today or dt.date.today())
    ref = 1.0
    info: Optional[UnderlyingInfo] = None
    if product.product_type == "DCD":
        market = market or MarketDataService(data_dir=data_dir, today=today)
        info = resolve_underlying(product.underlying, market.data_dir)
        _check_asset(product, info)
        pdata = market.get(info)
        i, _ = _reference(pdata.prices.index, pdata.prices.values, product)
        ref = float(pdata.prices.values[i])
        moves = np.round(np.arange(-10.0, 10.0001, 0.25), 2)
    else:
        info = UnderlyingInfo(product.underlying, "", product.underlying, "equity")
        moves = np.arange(-60, 61, 1).astype(float)
    ctx = _Context(product, info, ref)

    points = []
    for m in moves:
        final = 1.0 + m / 100.0
        point: Dict[str, Any] = {"move_pct": float(m)}
        if product.product_type == "ELN" and product.barrier_pct is not None:
            b = product.barrier_pct
            point["barrier_not_touched"] = (round(ctx.price(np.array([1.0, final])).money_back, 2)
                                            if final >= b else None)
            point["barrier_touched"] = round(ctx.price(np.array([1.0, min(final, b) - 1e-6, final])).money_back, 2)
        else:
            point["money_back"] = round(ctx.price(np.array([1.0, final])).money_back, 2)
        points.append(point)
    return {"product_id": product.product_id, "currency": ctx.currency, "reference_rate": ref
            if product.product_type == "DCD" else None, "points": points}
