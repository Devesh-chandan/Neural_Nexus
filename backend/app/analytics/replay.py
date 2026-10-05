"""
Historical rolling-window replay statistics.

Uses the SAME period definition and payoff formulas as the 20-scenario replay engine
(`app.simulation.sim_engine`): every trading day that has a full calendar tenor after it is one
window (`build_windows`), the barrier is observed on the window's daily closes, and money back
comes from the shared vectorised payoff cores through `app.payoff`. This module only aggregates
all windows into statistics (loss probability, CVaR, histogram, crisis presets); the 20-scenario
engine's "worst" slot is therefore exactly `worst_return_pct` here.

Crisis presets: GFC, COVID, 2022, INR2013 (FX only).
"""
from __future__ import annotations

import logging
from typing import List, Optional

import numpy as np
import pandas as pd

from app.core.config import get_products_config
from app.payoff import annualised_return, DCDPayoff, ELNPayoff, get_engine, net_return
from app.schemas.analysis import CrisisPreset, HistogramBin, ReplayResult
from app.simulation.sim_engine.windows import build_windows

logger = logging.getLogger(__name__)


def _histogram(values: np.ndarray, n_bins: int) -> List[HistogramBin]:
    if len(values) == 0:
        return []
    counts, edges = np.histogram(values, bins=n_bins)
    total = float(len(values))
    return [
        HistogramBin(
            bin_start=round(float(edges[i]), 6),
            bin_end=round(float(edges[i + 1]), 6),
            count=int(counts[i]),
            frequency=round(float(counts[i]) / total, 6) if total > 0 else 0.0,
        )
        for i in range(len(counts))
    ]


def _nearest_trading_day(index: pd.DatetimeIndex, target: str) -> Optional[int]:
    """Return index position of the trading day nearest to target date."""
    ts = pd.Timestamp(target)
    if ts < index[0] or ts > index[-1]:
        return None
    diffs = np.abs((index - ts).values.astype("timedelta64[D]").astype(int))
    return int(diffs.argmin())


def _empty() -> ReplayResult:
    return ReplayResult(
        n_windows=0, n_independent=0, p_loss=float("nan"), breach_frequency=float("nan"),
        worst_loss_pct=float("nan"), median_annualised_return=float("nan"),
        cvar5_loss_pct=float("nan"), crisis_presets=[], histogram=[],
    )


def window_outcomes(config: object, x: np.ndarray, low: np.ndarray, strike_ratio: float):
    """Money back and breach/conversion flags for arrays of window outcomes (shared formulas)."""
    engine = get_engine(config.product_type)  # type: ignore[attr-defined]
    if config.product_type == "DCD":  # type: ignore[attr-defined]
        dcd: DCDPayoff = engine  # type: ignore[assignment]
        finals = dcd.final_value_rel(config, x, strike_ratio)  # type: ignore[arg-type]
        return finals, np.zeros(len(x), dtype=bool)
    if config.product_type == "ELN":  # type: ignore[attr-defined]
        eln: ELNPayoff = engine  # type: ignore[assignment]
        return eln.final_value(config, x, low), eln.barrier_hit(config, x, low)  # type: ignore[arg-type]
    return engine.final_value(config, x), np.zeros(len(x), dtype=bool)  # type: ignore[arg-type]


def run_replay(
    config: object,
    close_series: pd.Series,
    s0: Optional[float] = None,
) -> ReplayResult:
    """
    Run the rolling-window replay on a price series.

    config: product config (ELNConfig | CPNConfig | DCDConfig)
    close_series: pd.Series with DatetimeIndex and float values
    s0: for DCD, today's spot the strike is quoted against (defaults to the last observation)
    """
    cfg_global = get_products_config()
    n_bins = cfg_global["replay"]["histogram_bins"]
    cvar_tail = cfg_global["replay"]["cvar_tail_pct"]
    crisis_defs = cfg_global["crisis_presets"]

    tenor_months = config.tenor_months  # type: ignore[attr-defined]
    P = config.principal  # type: ignore[attr-defined]
    T = tenor_months / 12.0
    is_dcd = config.product_type == "DCD"  # type: ignore[attr-defined]

    values = close_series.values.astype(float)
    dates = pd.DatetimeIndex(close_series.index)

    win = build_windows(dates, values, tenor_months)
    if len(win) < 2:
        logger.warning("Insufficient history for replay: %d rows, %d complete windows", len(values), len(win))
        return _empty()

    # DCD strike is quoted at today's spot level; historical windows start at other spot levels,
    # so the strike is re-struck at the same offset (K / S0) from each window start.
    strike_ratio = 1.0
    if is_dcd:
        ref_spot = s0 if s0 is not None else float(values[-1])
        if not ref_spot or ref_spot <= 0:
            raise ValueError("DCD replay needs a positive reference spot s0")
        strike_ratio = config.strike / ref_spot  # type: ignore[attr-defined]

    starts, ends = win.start, win.end
    x = values[ends] / values[starts]
    # Lowest close of each window (including its first close), relative to the window start.
    low = np.array([values[s:e + 1].min() for s, e in zip(starts, ends)]) / values[starts]

    finals, breach = window_outcomes(config, x, low, strike_ratio)
    net_returns = net_return(finals, P)
    n_windows = len(finals)
    avg_len = float(np.median(ends - starts))
    n_independent = int(np.floor(len(values) / avg_len)) if avg_len > 0 else 0

    p_loss = float(np.mean(finals < P))
    breach_freq = float(np.mean(breach))
    loss_vals = 1.0 - finals / P
    worst_loss_pct = float(np.max(np.maximum(loss_vals, 0.0)))
    worst_return_pct = float(np.min(net_returns))  # may be positive: the worst window still gained

    ann_ret = annualised_return(finals, P, T)
    median_ann = float(np.median(ann_ret))

    # CVaR5: mean of worst 5% by outcome (loss)
    tail_k = max(1, int(np.floor(cvar_tail * n_windows)))
    sorted_loss = np.sort(loss_vals)[::-1][:tail_k]
    cvar5 = float(np.mean(np.maximum(sorted_loss, 0.0)))

    histogram = _histogram(net_returns, n_bins)

    # ── Crisis presets ────────────────────────────────────────────────────────
    crisis_results: List[CrisisPreset] = []
    for crisis_key, crisis_meta in crisis_defs.items():
        if crisis_meta.get("fx_only") and not is_dcd:
            crisis_results.append(CrisisPreset(name=crisis_key, label=crisis_meta["label"], available=False))
            continue

        idx = _nearest_trading_day(dates, crisis_meta["start"])
        hit = np.nonzero(starts == idx)[0] if idx is not None else []
        if len(hit) == 0:
            crisis_results.append(CrisisPreset(name=crisis_key, label=crisis_meta["label"], available=False))
            continue
        w = int(hit[0])
        c_final = float(finals[w])
        c_nr = float(net_returns[w])
        c_ar = float(ann_ret[w])

        crisis_results.append(
            CrisisPreset(
                name=crisis_key,
                label=crisis_meta["label"],
                start_date=str(dates[starts[w]].date()),
                end_date=str(dates[ends[w]].date()),
                x=round(float(x[w]), 6),
                final=round(c_final, 2),
                net_return=round(c_nr, 6),
                annualised_return=round(c_ar, 6),
                breach=bool(breach[w]),
                available=True,
            )
        )

    return ReplayResult(
        n_windows=n_windows,
        n_independent=n_independent,
        p_loss=round(p_loss, 6),
        breach_frequency=round(breach_freq, 6),
        worst_loss_pct=round(worst_loss_pct, 6),
        worst_return_pct=round(worst_return_pct, 6),
        median_annualised_return=round(median_ann, 6),
        cvar5_loss_pct=round(cvar5, 6),
        crisis_presets=crisis_results,
        histogram=histogram,
    )
