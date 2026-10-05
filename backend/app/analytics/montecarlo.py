"""
Block-bootstrap Monte Carlo (Section 6.6).

2000 paths, block size 10, fixed seed 42, demean=True (zero-drift).
Returns fan percentiles and distribution metrics.
"""
from __future__ import annotations

import logging
from typing import List

import numpy as np
import pandas as pd

from app.core.config import get_products_config
from app.analytics.replay import window_outcomes
from app.payoff import annualised_return, net_return
from app.schemas.analysis import HistogramBin, MonteCarloResult
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
            frequency=round(float(counts[i]) / total, 6),
        )
        for i in range(len(counts))
    ]


def run_monte_carlo(
    config: object,
    close_series: pd.Series,
    s0: float | None = None,
) -> MonteCarloResult:
    """
    Block-bootstrap Monte Carlo simulation.
    """
    cfg_global = get_products_config()
    mc_cfg = cfg_global["monte_carlo"]
    n_paths: int = mc_cfg["n_paths"]
    block_size: int = mc_cfg["block_size"]
    seed: int = mc_cfg["seed"]
    demean: bool = mc_cfg["demean"]
    fan_pcts: List[int] = mc_cfg["fan_percentiles"]
    fan_n: int = mc_cfg["fan_n_points"]
    n_bins: int = cfg_global["replay"]["histogram_bins"]
    cvar_tail: float = cfg_global["replay"]["cvar_tail_pct"]

    tenor_months = config.tenor_months  # type: ignore[attr-defined]
    P = config.principal  # type: ignore[attr-defined]
    T = tenor_months / 12.0

    close = close_series.values.astype(float)
    dates = pd.DatetimeIndex(close_series.index)
    # Path length = trading days in one tenor, measured the same way as the historical windows.
    win = build_windows(dates, close, tenor_months)
    n_steps = int(np.median(win.end - win.start)) if len(win) else round(tenor_months * 21)
    n_steps = max(1, n_steps)

    log_ret = np.diff(np.log(close))
    if demean:
        log_ret = log_ret - log_ret.mean()

    # Build blocks
    n_blocks_needed = int(np.ceil(n_steps / block_size))
    n_ret = len(log_ret)

    rng = np.random.default_rng(seed)
    # For each path sample n_blocks_needed block start indices
    starts = rng.integers(0, max(1, n_ret - block_size + 1), size=(n_paths, n_blocks_needed))

    if s0 is None:
        s0 = float(close[-1])

    # Fan: sample at ~fan_n evenly-spaced time points
    fan_times = np.linspace(0, n_steps, fan_n, dtype=int)
    fan_paths_matrix = np.zeros((n_paths, len(fan_times)))
    x_end = np.zeros(n_paths)
    x_low = np.zeros(n_paths)

    for p_idx in range(n_paths):
        path_ret = np.concatenate([log_ret[int(b): int(b) + block_size] for b in starts[p_idx]])[:n_steps]
        price_path = np.exp(np.concatenate([[0.0], np.cumsum(path_ret)]))  # ratio relative to s0
        fan_paths_matrix[p_idx] = price_path[np.minimum(fan_times, len(price_path) - 1)]
        x_end[p_idx] = price_path[-1]
        x_low[p_idx] = price_path.min()

    # Money back for every path through the shared payoff formulas (same as the replay).
    strike_ratio = (config.strike / s0) if config.product_type == "DCD" else 1.0  # type: ignore[attr-defined]
    finals_arr, breach_flags = window_outcomes(config, x_end, x_low, strike_ratio)
    nr_arr = net_return(finals_arr, P)
    ann_ret = annualised_return(finals_arr, P, T)

    p_loss = float(np.mean(finals_arr < P))
    breach_freq = float(np.mean(breach_flags))

    loss_vals = 1.0 - finals_arr / P
    worst_loss_pct = float(np.max(np.maximum(loss_vals, 0.0)))
    median_ann = float(np.median(ann_ret))

    tail_k = max(1, int(np.floor(cvar_tail * n_paths)))
    sorted_loss = np.sort(loss_vals)[::-1][:tail_k]
    cvar5 = float(np.mean(np.maximum(sorted_loss, 0.0)))

    # Fan percentile paths (as payoff amounts, not ratios)
    fan_pct_paths: List[List[float]] = []
    for pct in fan_pcts:
        pct_vals = np.percentile(fan_paths_matrix * s0 * (P / s0), pct, axis=0)
        # Actually we want payoff fan expressed as portfolio value in currency
        # fan_paths_matrix is price ratio; map to payoff at each time step is complex.
        # Simpler: report the price ratio fan (multiply by S0 for abs level).
        ratio_pct = np.percentile(fan_paths_matrix, pct, axis=0)
        fan_pct_paths.append([round(float(v), 6) for v in ratio_pct])

    histogram = _histogram(nr_arr, n_bins)
    fan_x_pts = [round(float(fan_times[i]) / n_steps, 4) for i in range(len(fan_times))]

    return MonteCarloResult(
        n_paths=n_paths,
        seed=seed,
        fan_percentiles=fan_pcts,
        fan_x_points=fan_x_pts,
        fan_paths=fan_pct_paths,
        p_loss=round(p_loss, 6),
        breach_frequency=round(breach_freq, 6),
        worst_loss_pct=round(worst_loss_pct, 6),
        median_annualised_return=round(median_ann, 6),
        cvar5_loss_pct=round(cvar5, 6),
        histogram=histogram,
    )
