"""
Historical rolling-window replay (Section 6.5).

For a product with tenor T months, window n = round(tenor_months * 21) trading days.
For each start index i, take path close[i : i+n+1], compute:
  x = close[i+n] / close[i]
  path_min_x = min(path) / close[i]
  final = payoff(x, path_min_x)

Crisis presets: GFC, COVID, 2022, INR2013 (FX only).
"""
from __future__ import annotations

import logging
from typing import List, Optional

import numpy as np
import pandas as pd

from app.core.config import get_products_config
from app.payoff.base import annualised_return, net_return
from app.payoff.dcd import DCDPayoff
from app.payoff.registry import get_engine
from app.schemas.analysis import CrisisPreset, HistogramBin, ReplayResult

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


def _nearest_trading_day(df: pd.DataFrame, target: str) -> Optional[int]:
    """Return index position of the trading day nearest to target date."""
    ts = pd.Timestamp(target)
    if ts < df.index[0] or ts > df.index[-1]:
        return None
    diffs = pd.Series(df.index - ts).abs().values
    return int(diffs.argmin())


def run_replay(
    config: object,
    close_series: pd.Series,
    s0: Optional[float] = None,
) -> ReplayResult:
    """
    Run rolling-window replay on a price series.

    config: product config (ELNConfig | CPNConfig | DCDConfig)
    close_series: pd.Series with DatetimeIndex and float values
    s0: for DCD, the initial spot level (defaults to first observation)
    """
    cfg_global = get_products_config()
    n_bins = cfg_global["replay"]["histogram_bins"]
    cvar_tail = cfg_global["replay"]["cvar_tail_pct"]
    td_per_month = cfg_global["replay"]["trading_days_per_month"]
    crisis_defs = cfg_global["crisis_presets"]

    tenor_months = config.tenor_months  # type: ignore[attr-defined]
    P = config.principal  # type: ignore[attr-defined]
    T = tenor_months / 12.0
    n = round(tenor_months * td_per_month)

    close = close_series.values.astype(float)
    dates = close_series.index

    engine = get_engine(config.product_type)  # type: ignore[attr-defined]
    is_dcd = config.product_type == "DCD"  # type: ignore[attr-defined]
    is_daily = (
        hasattr(config, "barrier_monitoring")
        and config.barrier_monitoring == "daily"  # type: ignore[attr-defined]
    )

    finals: List[float] = []
    net_returns: List[float] = []
    breach_flags: List[bool] = []
    window_starts: List[str] = []

    total = len(close)
    if total < n + 2:
        logger.warning("Insufficient history for replay: %d rows, need %d", total, n + 2)
        return ReplayResult(
            n_windows=0,
            n_independent=0,
            p_loss=float("nan"),
            breach_frequency=float("nan"),
            worst_loss_pct=float("nan"),
            median_annualised_return=float("nan"),
            cvar5_loss_pct=float("nan"),
            crisis_presets=[],
            histogram=[],
        )

    for i in range(total - n):
        path = close[i : i + n + 1]
        if len(path) < n + 1:
            break
        s_start = path[0]
        s_end = path[-1]
        x = s_end / s_start
        path_min_x = float(np.min(path)) / s_start

        if is_dcd:
            dcd_engine: DCDPayoff = engine  # type: ignore[assignment]
            final = float(
                dcd_engine.final_value_with_s0(
                    config,  # type: ignore[arg-type]
                    np.array([x]),
                    s0=s_start,
                )[0]
            )
            breach = False  # DCD has no "breach" concept; conversion is normal
        else:
            pmx = path_min_x if is_daily else None
            final = float(engine.final_value(config, np.array([x]), pmx)[0])  # type: ignore[arg-type]
            # Determine breach for ELN
            if hasattr(config, "barrier_pct"):
                if is_daily:
                    breach = path_min_x < config.barrier_pct  # type: ignore[attr-defined]
                else:
                    breach = x < config.barrier_pct  # type: ignore[attr-defined]
            else:
                breach = False

        finals.append(final)
        net_returns.append(float(net_return(np.array([final]), P)[0]))
        breach_flags.append(bool(breach))
        window_starts.append(str(dates[i].date()))

    if not finals:
        return ReplayResult(
            n_windows=0,
            n_independent=0,
            p_loss=float("nan"),
            breach_frequency=float("nan"),
            worst_loss_pct=float("nan"),
            median_annualised_return=float("nan"),
            cvar5_loss_pct=float("nan"),
            crisis_presets=[],
            histogram=[],
        )

    finals_arr = np.array(finals)
    nr_arr = np.array(net_returns)
    n_windows = len(finals_arr)
    n_independent = int(np.floor(total / n))
    p_loss = float(np.mean(finals_arr < P))
    breach_freq = float(np.mean(breach_flags))
    loss_vals = 1.0 - finals_arr / P
    worst_loss_pct = float(np.max(np.maximum(loss_vals, 0.0)))

    ann_ret = annualised_return(finals_arr, P, T)
    median_ann = float(np.median(ann_ret))

    # CVaR5: mean of worst 5% by outcome (loss)
    tail_k = max(1, int(np.floor(cvar_tail * n_windows)))
    sorted_loss = np.sort(loss_vals)[::-1][:tail_k]  # highest losses first
    cvar5 = float(np.mean(np.maximum(sorted_loss, 0.0)))

    histogram = _histogram(nr_arr, n_bins)

    # ── Crisis presets ────────────────────────────────────────────────────────
    crisis_results: List[CrisisPreset] = []
    is_fx = is_dcd

    for crisis_key, crisis_meta in crisis_defs.items():
        if crisis_meta.get("fx_only") and not is_fx:
            crisis_results.append(
                CrisisPreset(name=crisis_key, label=crisis_meta["label"], available=False)
            )
            continue

        idx = _nearest_trading_day(close_series, crisis_meta["start"])
        if idx is None or idx + n >= total:
            crisis_results.append(
                CrisisPreset(name=crisis_key, label=crisis_meta["label"], available=False)
            )
            continue

        path = close[idx : idx + n + 1]
        s_start = path[0]
        s_end = path[-1]
        cx = s_end / s_start
        c_path_min_x = float(np.min(path)) / s_start

        if is_dcd:
            dcd_engine2: DCDPayoff = engine  # type: ignore[assignment]
            c_final = float(
                dcd_engine2.final_value_with_s0(
                    config, np.array([cx]), s0=s_start  # type: ignore[arg-type]
                )[0]
            )
            c_breach = False
        else:
            c_pmx = c_path_min_x if is_daily else None
            c_final = float(engine.final_value(config, np.array([cx]), c_pmx)[0])  # type: ignore[arg-type]
            if hasattr(config, "barrier_pct"):
                c_breach = (c_path_min_x if is_daily else cx) < config.barrier_pct  # type: ignore[attr-defined]
            else:
                c_breach = False

        c_nr = float(net_return(np.array([c_final]), P)[0])
        c_ar = float(annualised_return(np.array([c_final]), P, T)[0])
        end_idx = min(idx + n, total - 1)

        crisis_results.append(
            CrisisPreset(
                name=crisis_key,
                label=crisis_meta["label"],
                start_date=str(dates[idx].date()),
                end_date=str(dates[end_idx].date()),
                x=round(cx, 6),
                final=round(c_final, 2),
                net_return=round(c_nr, 6),
                annualised_return=round(c_ar, 6),
                breach=c_breach,
                available=True,
            )
        )

    return ReplayResult(
        n_windows=n_windows,
        n_independent=n_independent,
        p_loss=round(p_loss, 6),
        breach_frequency=round(breach_freq, 6),
        worst_loss_pct=round(worst_loss_pct, 6),
        median_annualised_return=round(median_ann, 6),
        cvar5_loss_pct=round(cvar5, 6),
        crisis_presets=crisis_results,
        histogram=histogram,
    )
