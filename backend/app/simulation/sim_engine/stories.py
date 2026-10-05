"""One plain sentence per scenario, from fixed templates (no AI involved)."""

from __future__ import annotations

from typing import Optional

import pandas as pd

from .payoffs import PayoffResult


def fmt_money(x: float, currency: str) -> str:
    """INR in Indian grouping (Rs 11,00,000); other currencies as 'USD 43,500.00'."""
    neg = x < 0
    x = abs(x)
    if currency == "INR":
        whole = int(round(x)) if abs(x - round(x)) < 0.005 else None
        if whole is not None:
            digits, frac = str(whole), ""
        else:
            digits, frac = f"{x:.2f}".split(".")
            frac = "." + frac
        if len(digits) > 3:
            head, tail = digits[:-3], digits[-3:]
            groups = []
            while len(head) > 2:
                groups.insert(0, head[-2:])
                head = head[:-2]
            if head:
                groups.insert(0, head)
            digits = ",".join(groups) + "," + tail
        return ("-" if neg else "") + "₹" + digits + frac
    return ("-" if neg else "") + f"{currency} {x:,.2f}"


def _pct(x: float, decimals: int = 1) -> str:
    return f"{x * 100:+.{decimals}f}%"


def _moved(name: str, move: float, decimals: int = 1) -> str:
    if abs(move) < 0.0005:
        return f"{name} ended flat"
    verb = "rose" if move > 0 else "fell"
    return f"{name} {verb} {abs(move) * 100:.{decimals}f}%"


def eln_story(name: str, r: PayoffResult, strike_pct: float, barrier_pct: Optional[float],
              hit_date: Optional[pd.Timestamp], money: str) -> str:
    move = r.info["final"] - 1.0
    if barrier_pct is None:
        if r.info["below_strike"]:
            return (f"{_moved(name, move)}, ending below the strike ({_pct(strike_pct - 1, 0)}), "
                    f"so the fall was passed on and you got back {money}.")
        return (f"{_moved(name, move)} and ended at or above the strike ({_pct(strike_pct - 1, 0)}), "
                f"so you got back {money}.")
    if not r.barrier_hit:
        low = r.info["low"] - 1.0
        if low > -0.0005:
            return (f"{_moved(name, move)} and never closed below its start, so the barrier at "
                    f"{_pct(barrier_pct - 1, 0)} was never touched and you got back {money}.")
        return (f"{_moved(name, move)}; its lowest close was {_pct(low)}, never below the barrier at "
                f"{_pct(barrier_pct - 1, 0)}, so you got back {money}.")
    when = hit_date.strftime("%d %b %Y") if hit_date is not None else "during the period"
    if r.info["below_strike"]:
        return (f"{name} broke the barrier on {when} and ended {_pct(move)}, below the strike, "
                f"so the fall was passed on and you got back {money}.")
    return (f"{name} broke the barrier on {when} but recovered to end {_pct(move)}, not below the "
            f"strike, so you got back {money}.")


def cpn_story(name: str, r: PayoffResult, protection_pct: float, participation_pct: float,
              cap_pct: Optional[float], money: str) -> str:
    move = r.info["final"] - 1.0
    extra = " including the coupon" if r.info["coupon"] > 0 else ""
    if move <= 0:
        return (f"{_moved(name, move)}, so only the {protection_pct * 100:.0f}% capital protection paid "
                f"out and you got back {money}{extra}.")
    if r.info["capped"]:
        return (f"{_moved(name, move)}, but gains are capped at {cap_pct * 100:.1f}%, "
                f"so you got back {money}{extra}.")
    return (f"{_moved(name, move)}; at {participation_pct * 100:.0f}% participation you earned "
            f"{r.info['upside'] * 100:.1f}%, so you got back {money}{extra}.")


def dcd_story(pair: str, r: PayoffResult, strike_rate: float, alt_currency: str, money: str) -> str:
    move = r.info["final"] - 1.0
    rate = f"{r.info['final_rate']:.2f}"
    if r.barrier_hit:
        alt_amt = fmt_money(r.info["alt_amount"], alt_currency)
        return (f"{_moved(pair, move, 2)} to {rate}, past the {strike_rate:.2f} strike, so you were "
                f"repaid {alt_amt}, worth {money} at that rate.")
    return (f"{_moved(pair, move, 2)} to {rate}, staying on the safe side of the {strike_rate:.2f} "
            f"strike, so you got back {money} with interest.")
