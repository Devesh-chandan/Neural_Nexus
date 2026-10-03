"""
Suitability engine tests – 8 required personas (Section 7.5).
Uses synthetic metrics (no network required).
"""
from __future__ import annotations

import numpy as np
import pytest

from app.schemas.analysis import (
    CliffInfo, FDBaseline, MetricsBundle, MonteCarloResult, PayoffPoint,
    PricingInfo, ReplayResult, ScenarioRow, VolatilityInfo,
)
from app.schemas.client import ClientProfile
from app.schemas.product import ELNConfig, CPNConfig, DCDConfig
from app.suitability.engine import evaluate_suitability


def _make_replay(p_loss=0.0, breach_freq=0.0, worst_loss=0.0, median_ann=0.08, cvar5=0.0, n_windows=500):
    return ReplayResult(
        n_windows=n_windows,
        n_independent=50,
        p_loss=p_loss,
        breach_frequency=breach_freq,
        worst_loss_pct=worst_loss,
        median_annualised_return=median_ann,
        cvar5_loss_pct=cvar5,
        crisis_presets=[],
        histogram=[],
    )


def _make_metrics(
    max_loss_pct=0.30,
    stress_loss_pct=0.25,
    replay_kwargs=None,
    pricing_flag="ok",
    indicative=0.10,
) -> MetricsBundle:
    rk = replay_kwargs or {}
    return MetricsBundle(
        max_gain_pct=0.12,
        max_loss_pct=max_loss_pct,
        break_even_x=0.88,
        scenario_table=[
            ScenarioRow(shock=-0.10, x=0.90, final=1_120_000, net_return=0.12,
                        annualised_return=0.12, label="10% drop", is_ps_scenario=True)
        ],
        stress_loss_pct=stress_loss_pct,
        replay=_make_replay(**rk),
        monte_carlo=None,
        volatility=VolatilityInfo(ewma=0.20, realised_1y=0.18),
        fd_baseline=FDBaseline(rate_pa=0.07, final=1_070_000, annualised_return=0.07),
        payoff_curve=[PayoffPoint(x=1.0, final=1_120_000, net_return=0.12)],
        cliff=CliffInfo(x_level=0.70, loss_jump_pct_points=25.0),
        pricing=PricingInfo(indicative=indicative, flag=pricing_flag),
    )


def _eln(tenor=12, barrier=0.70, coupon=0.12, principal=1_000_000, underlying="NIFTY50"):
    return ELNConfig(
        underlying=underlying, tenor_months=tenor, principal=principal,
        currency="INR", barrier_pct=barrier, coupon_pa=coupon,
        coupon_conditional=False, barrier_monitoring="maturity",
    )


def _cpn(tenor=24, protection=1.00, participation=0.80, principal=1_000_000):
    return CPNConfig(
        underlying="NIFTY50", tenor_months=tenor, principal=principal,
        currency="INR", protection_pct=protection, participation_pct=participation,
        cap_pct=None,
    )


# ─── Persona helpers ──────────────────────────────────────────────────────────

def _conservative(assets=10_000_000, invest=500_000, horizon=12, tolerance=5.0):
    return ClientProfile(
        client_name="Conservative Client",
        risk_appetite="conservative",
        horizon_months=horizon,
        loss_tolerance_pct=tolerance,
        investable_assets=assets,
        investment_amount=invest,
        existing_exposure_underlying_pct=0.0,
        existing_structured_pct=0.0,
        experience="novice",
    )


def _aggressive(assets=10_000_000, invest=500_000, horizon=36, tolerance=40.0):
    return ClientProfile(
        client_name="Aggressive Client",
        risk_appetite="aggressive",
        horizon_months=horizon,
        loss_tolerance_pct=tolerance,
        investable_assets=assets,
        investment_amount=invest,
        existing_exposure_underlying_pct=0.0,
        existing_structured_pct=0.0,
        experience="experienced",
    )


# ─── Tests ────────────────────────────────────────────────────────────────────

class TestSuitabilityPersonas:

    def test_persona_1_conservative_eln_not_suitable(self):
        """Conservative, 12m, 5% tolerance vs ELN 12m barrier 70% → NOT_SUITABLE"""
        profile = _conservative()
        config = _eln()
        # Stress loss 25% >> 5% tolerance → R-LOSS RED
        metrics = _make_metrics(stress_loss_pct=0.25, replay_kwargs={"cvar5": 0.20, "p_loss": 0.30, "worst_loss": 0.40})
        result = evaluate_suitability(config, profile, metrics)
        assert result.verdict == "NOT_SUITABLE", f"Got {result.verdict}"
        rule_ids = {r.rule_id: r.status for r in result.rules}
        assert rule_ids["R-LOSS"] == "RED"

    def test_persona_2_aggressive_eln_suitable(self):
        """Aggressive, 36m, 40% tolerance vs same ELN → SUITABLE or CONDITIONALLY_SUITABLE (no RED)"""
        profile = _aggressive()
        config = _eln()
        metrics = _make_metrics(stress_loss_pct=0.25, replay_kwargs={"cvar5": 0.20, "p_loss": 0.25, "worst_loss": 0.30})
        result = evaluate_suitability(config, profile, metrics)
        assert result.verdict in ("SUITABLE", "CONDITIONALLY_SUITABLE"), f"Got {result.verdict}"
        rule_ids = {r.rule_id: r.status for r in result.rules}
        assert rule_ids.get("R-LOSS") != "RED"
        assert rule_ids.get("R-HORIZON") != "RED"

    def test_persona_3_moderate_cpn_24m_horizon_12m(self):
        """Moderate, horizon 12m, 20% tolerance vs CPN 24m → HORIZON rule at least AMBER"""
        profile = ClientProfile(
            client_name="Moderate",
            risk_appetite="moderate",
            horizon_months=12,
            loss_tolerance_pct=20.0,
            investable_assets=10_000_000,
            investment_amount=500_000,
            experience="intermediate",
        )
        config = _cpn(tenor=24)
        # CPN with full protection: minimal loss
        metrics = _make_metrics(
            max_loss_pct=0.0, stress_loss_pct=0.0,
            replay_kwargs={"cvar5": 0.0, "p_loss": 0.0, "worst_loss": 0.0},
        )
        result = evaluate_suitability(config, profile, metrics)
        rule_ids = {r.rule_id: r.status for r in result.rules}
        # Horizon: tenor 24 > 1.5 * horizon 12 = 18 → RED; or tenor > horizon = 24 > 12 → at least AMBER
        assert rule_ids["R-HORIZON"] in ("AMBER", "RED"), f"R-HORIZON should be triggered; got {rule_ids['R-HORIZON']}"
        # Verdict should not be SUITABLE due to horizon
        assert result.verdict in ("CONDITIONALLY_SUITABLE", "NOT_SUITABLE")

    def test_persona_4_high_concentration_red(self):
        """Any profile investing 35% of assets → R-CONC RED"""
        assets = 10_000_000
        invest = 3_500_000  # 35% of assets → single_product_pct=0.35 ≥ 0.30
        profile = ClientProfile(
            client_name="Concentrated",
            risk_appetite="moderate",
            horizon_months=24,
            loss_tolerance_pct=20.0,
            investable_assets=assets,
            investment_amount=invest,
            experience="intermediate",
        )
        config = _eln(principal=invest)
        metrics = _make_metrics(stress_loss_pct=0.10)
        result = evaluate_suitability(config, profile, metrics)
        rule_ids = {r.rule_id: r.status for r in result.rules}
        assert rule_ids["R-CONC"] == "RED", f"R-CONC should be RED; got {rule_ids['R-CONC']}"
        assert result.verdict == "NOT_SUITABLE"

    def test_persona_5_novice_dcd_at_least_amber(self):
        """Novice vs DCD → R-COMPLEX at least AMBER"""
        profile = ClientProfile(
            client_name="Novice",
            risk_appetite="moderate",
            horizon_months=12,
            loss_tolerance_pct=20.0,
            investable_assets=10_000_000,
            investment_amount=500_000,
            experience="novice",
        )
        dcd_config = DCDConfig(
            underlying="USDINR", tenor_months=6, principal=500_000,
            currency="USD", strike=86.0, interest_pa=0.08,
            base_currency="USD", alt_currency="INR",
        )
        metrics = _make_metrics(stress_loss_pct=0.05)
        result = evaluate_suitability(dcd_config, profile, metrics)
        rule_ids = {r.rule_id: r.status for r in result.rules}
        assert rule_ids["R-COMPLEX"] in ("AMBER", "RED"), f"Novice vs DCD should trigger R-COMPLEX"

    def test_persona_6_aggressive_zero_tolerance_eln_rloss_red(self):
        """Aggressive appetite but 0% tolerance → R-LOSS RED for any ELN with stress loss"""
        profile = ClientProfile(
            client_name="Contradictory",
            risk_appetite="aggressive",
            horizon_months=36,
            loss_tolerance_pct=0.0,  # zero tolerance
            investable_assets=10_000_000,
            investment_amount=500_000,
            experience="experienced",
        )
        config = _eln()
        metrics = _make_metrics(stress_loss_pct=0.25)
        result = evaluate_suitability(config, profile, metrics)
        rule_ids = {r.rule_id: r.status for r in result.rules}
        assert rule_ids["R-LOSS"] == "RED"
        assert result.verdict == "NOT_SUITABLE"

    def test_persona_7_cpn_full_protection_conservative(self):
        """CPN 100% protection, conservative, horizon 24m, tolerance 5% → SUITABLE or AMBER only"""
        profile = _conservative(horizon=24, tolerance=5.0)
        config = _cpn(tenor=24, protection=1.00)
        # Zero loss scenario
        metrics = _make_metrics(
            max_loss_pct=0.0,
            stress_loss_pct=0.0,
            replay_kwargs={"cvar5": 0.0, "p_loss": 0.0, "worst_loss": 0.0},
            pricing_flag="ok",
        )
        result = evaluate_suitability(config, profile, metrics)
        rule_ids = {r.rule_id: r.status for r in result.rules}
        # No RED on R-LOSS or R-HORIZON
        assert rule_ids.get("R-LOSS") != "RED", f"R-LOSS should not be RED"
        assert rule_ids.get("R-HORIZON") != "RED", f"R-HORIZON should not be RED"
        assert result.verdict in ("SUITABLE", "CONDITIONALLY_SUITABLE")

    def test_persona_8_same_eln_different_verdicts(self):
        """Same ELN config gives different verdicts for conservative vs aggressive"""
        config = _eln()
        metrics = _make_metrics(stress_loss_pct=0.25, replay_kwargs={"cvar5": 0.20, "p_loss": 0.30, "worst_loss": 0.40})
        conservative_result = evaluate_suitability(config, _conservative(), metrics)
        aggressive_result = evaluate_suitability(config, _aggressive(), metrics)
        assert conservative_result.verdict != aggressive_result.verdict, (
            f"Conservative: {conservative_result.verdict}, Aggressive: {aggressive_result.verdict} – should differ"
        )

    def test_red_on_loss_horizon_cannot_be_offset(self):
        """A RED on R-LOSS must always produce NOT_SUITABLE regardless of other scores"""
        profile = _conservative(tolerance=1.0)  # 1% tolerance
        config = _eln()
        metrics = _make_metrics(stress_loss_pct=0.30)  # massively over tolerance
        result = evaluate_suitability(config, profile, metrics)
        assert result.verdict == "NOT_SUITABLE"
        assert any(r.rule_id == "R-LOSS" and r.status == "RED" for r in result.rules)

    def test_score_decreases_with_worse_profile(self):
        """A worse profile should always produce a lower or equal score."""
        config = _eln()
        metrics = _make_metrics(stress_loss_pct=0.15, replay_kwargs={"cvar5": 0.10, "p_loss": 0.15, "worst_loss": 0.20})
        moderate = ClientProfile(
            client_name="Moderate", risk_appetite="moderate", horizon_months=12,
            loss_tolerance_pct=20.0, investable_assets=10_000_000,
            investment_amount=500_000, experience="intermediate",
        )
        conservative = _conservative(tolerance=5.0)
        res_mod = evaluate_suitability(config, moderate, metrics)
        res_con = evaluate_suitability(config, conservative, metrics)
        assert res_mod.score >= res_con.score, (
            f"Moderate score {res_mod.score} should be >= conservative score {res_con.score}"
        )
