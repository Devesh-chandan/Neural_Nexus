"""
Full metrics bundle assembly (Section 6.8).

Orchestrates: payoff curve, scenario table, stress loss, FD baseline,
cliff detection, volatility, replay, Monte Carlo (optional), pricing.
"""
from __future__ import annotations

import logging
import math
import uuid
from typing import List, Optional

import numpy as np
import pandas as pd

from app.analytics.montecarlo import run_monte_carlo
from app.analytics.pricing import compute_pricing
from app.analytics.replay import run_replay
from app.analytics.scenarios import build_scenario_table
from app.analytics.vol import compute_vol
from app.core.config import get_products_config, get_underlyings
from app.core.errors import AppError
from app.payoff import annualised_return, DCDPayoff, get_engine, net_return
from app.schemas.analysis import (
    IssuerCreditInfo,
    CliffInfo,
    FDBaseline,
    MetricsBundle,
    PayoffPoint,
    VolatilityInfo,
)

logger = logging.getLogger(__name__)

DISCLAIMER = (
    "Illustrative analysis using historical data and statistical models. "
    "Past performance does not predict future results. Issuer credit risk is shown only as a "
    "generic illustrative assumption. Notes are held to maturity (no early redemption is offered) "
    "and liquidity risk is not modelled. This is a decision-support tool and not "
    "investment advice; suitability must be confirmed by a qualified person."
)


# Sanity band for a DCD strike relative to current spot (rejects typos / wrong-unit strikes).
DCD_STRIKE_RATIO_MIN = 0.5
DCD_STRIKE_RATIO_MAX = 2.0


def _payoff_curve(config: object, s0: float) -> List[PayoffPoint]:
    """Generate 101-point payoff curve."""
    cfg = get_products_config()
    pc_cfg = cfg["payoff_curve"]
    underlyings = get_underlyings()
    underlying_key = config.underlying  # type: ignore[attr-defined]
    asset_type = underlyings[underlying_key]["type"] if underlying_key in underlyings else "equity"

    if asset_type == "fx":
        x_min = pc_cfg["fx_x_min"]
        x_max = pc_cfg["fx_x_max"]
    else:
        x_min = pc_cfg["equity_x_min"]
        x_max = pc_cfg["equity_x_max"]

    xs = np.linspace(x_min, x_max, pc_cfg["n_points"])
    engine = get_engine(config.product_type)  # type: ignore[attr-defined]
    P = config.principal  # type: ignore[attr-defined]
    T = config.tenor_months / 12.0  # type: ignore[attr-defined]
    is_dcd = config.product_type == "DCD"  # type: ignore[attr-defined]

    if is_dcd:
        dcd_engine: DCDPayoff = engine  # type: ignore[assignment]
        finals = dcd_engine.final_value_with_s0(config, xs, s0=s0)  # type: ignore[arg-type]
    else:
        finals = engine.final_value(config, xs)  # type: ignore[arg-type]

    nr = net_return(finals, P)
    return [
        PayoffPoint(x=round(float(xs[i]), 4), final=round(float(finals[i]), 2), net_return=round(float(nr[i]), 6))
        for i in range(len(xs))
    ]


def _max_gain_loss(config: object, payoff_curve: List[PayoffPoint]) -> tuple:  # (max_gain | None, max_loss)
    """Compute theoretical max gain and max loss from the payoff curve."""
    P = config.principal  # type: ignore[attr-defined]
    finals = [p.final for p in payoff_curve]
    max_final = max(finals)
    min_final = min(finals)
    max_gain_pct = (max_final - P) / P
    max_loss_pct = max(0.0, (P - min_final) / P)
    if config.product_type == "CPN" and config.cap_pct is None:  # type: ignore[attr-defined]
        max_gain_pct = None  # uncapped participation: the plotted curve edge is not a real maximum
    if config.product_type in ("ELN", "CPN"):  # type: ignore[attr-defined]
        # The displayed curve only spans x in [0.4, 1.6]; the true worst case for these
        # products is a total collapse of the underlying (x = 0), which the curve omits.
        engine = get_engine(config.product_type)  # type: ignore[attr-defined]
        pmx = 0.0 if getattr(config, "barrier_monitoring", None) == "daily" else None
        worst_final = float(engine.final_value(config, np.array([0.0]), pmx)[0])  # type: ignore[arg-type]
        max_loss_pct = max(max_loss_pct, max(0.0, (P - worst_final) / P))
    return (None if max_gain_pct is None else round(max_gain_pct, 6)), round(max_loss_pct, 6)


def _break_even_x(config: object) -> Optional[float]:
    """Analytical break-even x for ELN breach case only."""
    pt = config.product_type  # type: ignore[attr-defined]
    P = config.principal  # type: ignore[attr-defined]
    T = config.tenor_months / 12.0  # type: ignore[attr-defined]

    if pt == "ELN":
        coupon_total = P * config.coupon_pa * T  # type: ignore[attr-defined]
        # Break-even in breach case: P*x + coupon_paid = P → x* = 1 - coupon_total/P
        # Only meaningful if coupon is paid on breach (unconditional coupon)
        if not config.coupon_conditional:  # type: ignore[attr-defined]
            return round(1.0 - coupon_total / P, 4)
    elif pt == "CPN":
        prot = config.protection_pct  # type: ignore[attr-defined]
        part = config.participation_pct  # type: ignore[attr-defined]
        if prot < 1.0:
            return round(1.0 + (1.0 - prot) / part, 4)
        return 1.0
    return None


def _cliff(config: object) -> Optional[CliffInfo]:
    """Detect the ELN barrier cliff."""
    if config.product_type != "ELN":  # type: ignore[attr-defined]
        return None
    P = config.principal  # type: ignore[attr-defined]
    T = config.tenor_months / 12.0  # type: ignore[attr-defined]
    barrier = config.barrier_pct  # type: ignore[attr-defined]
    coupon_total = P * config.coupon_pa * T  # type: ignore[attr-defined]

    # Just above barrier: final = P + coupon_total; at barrier (holds): same
    # Just below barrier: final = P * x + coupon_paid(breach)
    eps = 0.001
    x_above = barrier
    x_below = barrier - eps

    engine = get_engine("ELN")
    final_above = float(engine.final_value(config, np.array([x_above]))[0])  # type: ignore[arg-type]
    final_below = float(engine.final_value(config, np.array([x_below]))[0])  # type: ignore[arg-type]

    jump = (final_above - final_below) / P * 100  # percentage points
    return CliffInfo(x_level=round(barrier, 4), loss_jump_pct_points=round(jump, 2))


def _stress_loss(config: object, s0: float) -> float:
    """Section 6.8 stress loss at configured stress shock."""
    cfg = get_products_config()
    underlyings = get_underlyings()
    key = config.underlying  # type: ignore[attr-defined]
    asset_type = underlyings.get(key, {}).get("type", "equity")
    stress_shock = cfg["stress_shocks"].get(asset_type, -0.30)

    engine = get_engine(config.product_type)  # type: ignore[attr-defined]
    P = config.principal  # type: ignore[attr-defined]
    T = config.tenor_months / 12.0  # type: ignore[attr-defined]
    x = 1.0 + stress_shock
    is_dcd = config.product_type == "DCD"  # type: ignore[attr-defined]

    if is_dcd:
        dcd_engine: DCDPayoff = engine  # type: ignore[assignment]
        final = float(dcd_engine.final_value_with_s0(config, np.array([x]), s0=s0)[0])  # type: ignore[arg-type]
    else:
        pmx = min(1.0, x) if hasattr(config, "barrier_monitoring") and config.barrier_monitoring == "daily" else None  # type: ignore[attr-defined]
        final = float(engine.final_value(config, np.array([x]), pmx)[0])  # type: ignore[arg-type]

    return round(max(0.0, 1.0 - final / P), 6)


def _issuer_credit(config: object) -> IssuerCreditInfo:
    """Generic issuer default probability / expected loss over the tenor (reduced-form hazard model)."""
    cfg = get_products_config()["issuer_credit"]
    spread = cfg["credit_spread_bps"] / 10_000.0
    recovery = cfg["recovery_rate"]
    T = config.tenor_months / 12.0  # type: ignore[attr-defined]
    hazard = spread / (1.0 - recovery)
    pd_ = 1.0 - math.exp(-hazard * T)
    return IssuerCreditInfo(
        spread_bps=cfg["credit_spread_bps"],
        recovery_rate=recovery,
        default_probability=round(pd_, 6),
        expected_loss_pct=round(pd_ * (1.0 - recovery), 6),
    )


def _fd_baseline(config: object) -> FDBaseline:
    """Fixed deposit comparison baseline."""
    cfg = get_products_config()
    rate_pa = cfg["fd_baseline_rate"]
    P = config.principal  # type: ignore[attr-defined]
    T = config.tenor_months / 12.0  # type: ignore[attr-defined]
    final = P * (1.0 + rate_pa * T)
    ann_ret = (final / P) ** (1.0 / T) - 1.0
    return FDBaseline(
        rate_pa=rate_pa,
        final=round(final, 2),
        annualised_return=round(ann_ret, 6),
    )


def compute_metrics(
    config: object,
    close_series: pd.Series,
    include_monte_carlo: bool = False,
) -> MetricsBundle:
    """Assemble the full metrics bundle for a product config."""
    s0 = float(close_series.iloc[-1])
    P = config.principal  # type: ignore[attr-defined]
    T = config.tenor_months / 12.0  # type: ignore[attr-defined]

    if config.product_type == "DCD":  # type: ignore[attr-defined]
        lo = DCD_STRIKE_RATIO_MIN
        hi = DCD_STRIKE_RATIO_MAX
        ratio = config.strike / s0  # type: ignore[attr-defined]
        if not (lo <= ratio <= hi):
            raise AppError(
                422, "VALIDATION_ERROR",
                f"DCD strike {config.strike:g} is {ratio:.2f}x the current spot {s0:g}; "  # type: ignore[attr-defined]
                f"it must be between {lo:g}x and {hi:g}x spot.",
            )

    # Payoff curve
    curve = _payoff_curve(config, s0)
    max_gain_pct, max_loss_pct = _max_gain_loss(config, curve)

    # Scenarios
    scenarios = build_scenario_table(config, s0)

    # Stress loss
    stress_loss = _stress_loss(config, s0)

    # FD baseline
    fd = _fd_baseline(config)

    # Break-even
    be_x = _break_even_x(config)

    # Cliff
    cliff = _cliff(config)

    # Volatility
    vol_dict = compute_vol(close_series)
    vol_info = VolatilityInfo(
        ewma=round(vol_dict["ewma"] if not np.isnan(vol_dict["ewma"]) else 0.0, 6),
        realised_1y=round(vol_dict["realised_1y"] if not np.isnan(vol_dict["realised_1y"]) else 0.0, 6),
    )

    # Replay
    replay = run_replay(config, close_series, s0=s0)

    # Monte Carlo (optional)
    mc = run_monte_carlo(config, close_series, s0=s0) if include_monte_carlo else None

    # Pricing
    sigma = vol_info.ewma if vol_info.ewma > 0 else vol_info.realised_1y
    pricing = compute_pricing(config, sigma, s0)

    return MetricsBundle(
        max_gain_pct=max_gain_pct,
        max_gain_label=(f"Uncapped · {config.participation_pct:.0%} of any rise"  # type: ignore[attr-defined]
                        if max_gain_pct is None and config.product_type == "CPN" else None),  # type: ignore[attr-defined]
        max_loss_pct=max_loss_pct,
        break_even_x=be_x,
        scenario_table=scenarios,
        stress_loss_pct=stress_loss,
        replay=replay,
        monte_carlo=mc,
        volatility=vol_info,
        fd_baseline=fd,
        payoff_curve=curve,
        cliff=cliff,
        pricing=pricing,
        issuer_credit=_issuer_credit(config),
    )
