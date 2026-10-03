"""Analysis output schemas (metrics bundle, payoff, scenarios, replay, MC)."""
from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel


class ScenarioRow(BaseModel):
    shock: float
    x: float
    final: float
    net_return: float
    annualised_return: float
    label: str
    is_ps_scenario: bool = False  # True for the 3 named PS scenarios


class CrisisPreset(BaseModel):
    name: str
    label: str
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    x: Optional[float] = None
    final: Optional[float] = None
    net_return: Optional[float] = None
    annualised_return: Optional[float] = None
    breach: Optional[bool] = None
    available: bool = False


class HistogramBin(BaseModel):
    bin_start: float
    bin_end: float
    count: int
    frequency: float


class ReplayResult(BaseModel):
    n_windows: int
    n_independent: int
    p_loss: float
    breach_frequency: float
    worst_loss_pct: float
    median_annualised_return: float
    cvar5_loss_pct: float
    crisis_presets: List[CrisisPreset]
    histogram: List[HistogramBin]


class MonteCarloResult(BaseModel):
    n_paths: int
    seed: int
    fan_percentiles: List[int]
    fan_x_points: List[float]   # normalized time points 0..1
    fan_paths: List[List[float]]  # one list per percentile, payoff values
    p_loss: float
    breach_frequency: float
    worst_loss_pct: float
    median_annualised_return: float
    cvar5_loss_pct: float
    histogram: List[HistogramBin]


class VolatilityInfo(BaseModel):
    ewma: float
    realised_1y: float


class FDBaseline(BaseModel):
    rate_pa: float
    final: float
    annualised_return: float


class CliffInfo(BaseModel):
    x_level: float
    loss_jump_pct_points: float


class PricingInfo(BaseModel):
    indicative: float          # indicative coupon/participation/interest p.a.
    flag: Literal["ok", "coupon_above_indicative"]
    label: str = "Indicative, model-based sanity check, not an issuer quote."


class PayoffPoint(BaseModel):
    x: float
    final: float
    net_return: float


class MetricsBundle(BaseModel):
    max_gain_pct: float
    max_loss_pct: float
    break_even_x: Optional[float]
    scenario_table: List[ScenarioRow]
    stress_loss_pct: float
    replay: Optional[ReplayResult]
    monte_carlo: Optional[MonteCarloResult]
    volatility: VolatilityInfo
    fd_baseline: FDBaseline
    payoff_curve: List[PayoffPoint]
    cliff: Optional[CliffInfo]
    pricing: PricingInfo


class AnalyzeRequest(BaseModel):
    product: object  # discriminated union – typed at route level
    profile: Optional[object] = None
    include_monte_carlo: bool = False


class AnalyzeResponse(BaseModel):
    run_id: str
    metrics: MetricsBundle
    suitability: Optional[object] = None
    explanation: Optional[object] = None
    data_source: str
    as_of: str
    snapshot_id: str
    disclaimer: str = (
        "Illustrative analysis using historical data and statistical models. "
        "Past performance does not predict future results. Issuer credit risk "
        "and liquidity risk are not modelled. This is a decision-support tool "
        "and not investment advice; suitability must be confirmed by a qualified person."
    )
