"""One engine: the payoff formulas, the replay windows and the suitability verdict must agree
everywhere they are used (analysis API, assessment API, simulation, recommendations)."""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

import app.main as main
from app.analytics.metrics import compute_metrics
from app.analytics.replay import run_replay
from app.assessment.service import case_profile
from app.payoff import accrual_days, CPNPayoff, DCDPayoff, ELNPayoff
from app.schemas.product import parse_product_dict
from app.simulation.adapter import to_sim_engine_payload
from app.simulation.sim_engine import Settings, run_simulation
from app.simulation.sim_engine.payoffs import cpn_payoff, dcd_payoff, eln_payoff

N = 1_000_000
RNG = np.random.default_rng(7)


def random_path(n=60):
    steps = RNG.normal(0.0, 0.03, n)
    return np.concatenate([[1.0], np.exp(np.cumsum(steps))])


class TestPayoffFormulasAreShared:
    """The path functions (replay scenarios) and the vector adapters (analytics) never diverge."""

    @pytest.mark.parametrize("monitoring", ["daily", "maturity"])
    @pytest.mark.parametrize("conditional", [False, True])
    def test_eln_random_paths(self, monitoring, conditional):
        cfg = parse_product_dict(dict(product_type="ELN", underlying="NIFTY50", tenor_months=12,
                                      principal=N, barrier_pct=0.75, strike_pct=0.9, coupon_pa=0.1,
                                      barrier_monitoring=monitoring, coupon_conditional=conditional))
        engine = ELNPayoff()
        for _ in range(300):
            path = random_path()
            expected = eln_payoff(path, N, 0.1, 12, 0.9, 0.75, monitoring, conditional)
            got = engine.final_value(cfg, path[-1], path.min())[0]
            assert got == pytest.approx(expected.money_back, abs=1e-6)
            assert bool(engine.barrier_hit(cfg, path[-1], path.min())[0]) == expected.barrier_hit

    def test_cpn_random_paths(self):
        cfg = parse_product_dict(dict(product_type="CPN", underlying="NIFTY50", tenor_months=24,
                                      principal=N, protection_pct=0.95, participation_pct=0.8, cap_pct=0.3))
        for _ in range(300):
            path = random_path()
            expected = cpn_payoff(path, N, 0.0, 24, 0.95, 0.8, 0.3).money_back
            assert CPNPayoff().final_value(cfg, path[-1])[0] == pytest.approx(expected, abs=1e-6)

    def test_dcd_random_paths(self):
        cfg = parse_product_dict(dict(product_type="DCD", underlying="USDINR", tenor_months=6, principal=100_000,
                                      strike=88.0, interest_pa=0.07, start_date="2026-03-01"))
        days = accrual_days(cfg)
        for _ in range(300):
            path = random_path(20)
            expected = dcd_payoff(path, 100_000, 0.07, days, 85.0, 88.0, 1.0, False).money_back
            assert DCDPayoff().final_value(cfg, path[-1], s0=85.0)[0] == pytest.approx(expected, abs=1e-6)

    def test_percent_moves_are_relative_and_notional_scales_money_not_return(self):
        small = parse_product_dict(dict(product_type="ELN", underlying="NIFTY50", tenor_months=12,
                                        principal=1_000, barrier_pct=0.75, coupon_pa=0.1))
        big = small.model_copy(update={"principal": 1_000_000_000.0})
        a, b = ELNPayoff().final_value(small, 0.6)[0], ELNPayoff().final_value(big, 0.6)[0]
        assert b / big.principal == pytest.approx(a / small.principal)
        assert b == pytest.approx(a * 1_000_000)


def synthetic_series(n=3000, seed=11):
    idx = pd.bdate_range("2012-01-02", periods=n)
    rng = np.random.default_rng(seed)
    return pd.Series(100 * np.cumprod(1 + rng.normal(0.0003, 0.013, n)), index=idx)


PRODUCTS = [
    dict(product_type="ELN", underlying="NIFTY50", tenor_months=12, principal=N, barrier_pct=0.75, coupon_pa=0.1),
    dict(product_type="ELN", underlying="NIFTY50", tenor_months=6, principal=N, barrier_pct=0.6, coupon_pa=0.08,
         barrier_monitoring="maturity", coupon_conditional=True),
    dict(product_type="CPN", underlying="NIFTY50", tenor_months=24, principal=N, protection_pct=0.9,
         participation_pct=0.8),
    dict(product_type="DCD", underlying="USDINR", tenor_months=6, principal=100_000, strike=None,
         interest_pa=0.08),
]


@pytest.mark.parametrize("spec", PRODUCTS, ids=["eln_daily", "eln_maturity_conditional", "cpn", "dcd"])
def test_replay_statistics_and_scenarios_agree(spec, tmp_path):
    """The 20-scenario replay's worst slot equals the worst window of the statistics (same data)."""
    series = synthetic_series()
    key = "NIFTY50" if spec["product_type"] != "DCD" else "USD/INR"
    prices = tmp_path / "prices"
    prices.mkdir()
    pd.DataFrame({"Date": series.index.strftime("%Y-%m-%d"), "Close": series.values}).to_csv(
        prices / ("NIFTY50.csv" if key == "NIFTY50" else "USD_INR.csv"), index=False)
    spec = dict(spec)
    if spec["product_type"] == "DCD":
        spec["strike"] = round(float(series.iloc[-1]) * 1.03, 4)
    cfg = parse_product_dict(spec)
    cfg = cfg.model_copy(update={"start_date": series.index[-1].date()}) if spec["product_type"] == "DCD" else cfg

    sim = run_simulation(to_sim_engine_payload(cfg), Settings(today=series.index[-1].date()), data_dir=str(tmp_path))
    stats = run_replay(cfg, series, s0=float(series.iloc[-1]))
    worst_sim = min(s["return_pct"] for s in sim["scenarios"])
    assert worst_sim == pytest.approx(stats.worst_return_pct * 100, abs=0.01)
    assert stats.n_windows == sim["audit"]["selection"]["periods_available"]


def test_suitability_does_not_mutate_inputs():
    from app.suitability.engine import evaluate_suitability
    from tests.test_suitability import _conservative, _eln, _make_metrics
    cfg, profile, metrics = _eln(), _conservative(), _make_metrics()
    before = (cfg.model_dump(), profile.model_dump(), metrics.model_dump())
    evaluate_suitability(cfg, profile, metrics)
    assert before == (cfg.model_dump(), profile.model_dump(), metrics.model_dump())


def test_changing_client_risk_profile_never_changes_the_payoff():
    from app.suitability.engine import evaluate_suitability
    from tests.test_suitability import _aggressive, _conservative, _eln, _make_metrics
    cfg, metrics = _eln(), _make_metrics()
    before = cfg.model_dump()
    a = evaluate_suitability(cfg, _conservative(), metrics)
    b = evaluate_suitability(cfg, _aggressive(), metrics)
    assert cfg.model_dump() == before and a.verdict != b.verdict


# ── API level: /api/analyze and /api/assess must give the same verdict ──────────

SEEDED = {
    "client_id": "CLT-IN-9001",
    "primary_information": {"legal_name": "Test Client", "date_of_birth": "1985-01-01"},
    "financial_information": {"liquid_net_worth_inr": 20_000_000, "annual_income_inr": 4_000_000,
                              "previous_investment_exposure": ["DIRECT_EQUITY", "MUTUAL_FUNDS"]},
    "suitability_profile": {"risk_appetite": "AGGRESSIVE", "investment_horizon_years": 5,
                            "loss_tolerance_pct": 0.60, "current_portfolio_concentration_pct": 0.04},
    "_meta": {"aml_risk": "LOW", "vulnerable_client": False, "fatca_us_person": False, "profile_stale": False},
}
LEGACY = {"SUITABLE": "SUITABLE", "REVIEW_REQUIRED": "CONDITIONALLY_SUITABLE", "NOT_SUITABLE": "NOT_SUITABLE"}


@pytest.fixture
def api(monkeypatch):
    import json
    from app.api import routes_analyze, routes_assessment
    case = {"case_id": "CLT-IN-9001", "client_name": "Test Client", "owner_user_id": None,
            "profile_json": json.dumps(SEEDED)}
    monkeypatch.setattr(main, "verify_access_token", lambda t: {"id": "rm-1", "user_type": "rm"})
    for mod in (routes_analyze, routes_assessment):
        monkeypatch.setattr(mod, "get_case", lambda cid: case)
        monkeypatch.setattr(mod, "append_audit", lambda **kw: None)
    monkeypatch.setattr(routes_analyze, "init_db", lambda: None)
    monkeypatch.setattr(routes_analyze, "save_run", lambda **kw: None)
    from app.core.config import get_settings
    monkeypatch.setattr(get_settings(), "llm_provider", "none")
    return TestClient(main.app), case


@pytest.mark.parametrize("spec", [
    dict(product_type="ELN", underlying="NIFTY50", tenor_months=12, principal=500_000, barrier_pct=0.7, coupon_pa=0.1),
    dict(product_type="ELN", underlying="NIFTY50", tenor_months=36, principal=500_000, barrier_pct=0.9, coupon_pa=0.2),
    dict(product_type="CPN", underlying="NIFTY50", tenor_months=24, principal=500_000, protection_pct=1.0,
         participation_pct=0.8),
])
def test_analyze_and_assess_agree(api, spec):
    client, case = api
    headers = {"Authorization": "Bearer t"}
    profile = case_profile(case).model_dump(mode="json")
    analyzed = client.post("/api/analyze", headers=headers,
                           json={"product": spec, "profile": profile, "case_id": "CLT-IN-9001", "persist": False})
    assessed = client.post("/api/assess", headers=headers,
                           json={"client_id": "CLT-IN-9001", "product": spec, "explain": False})
    assert analyzed.status_code == 200, analyzed.text
    assert assessed.status_code == 200, assessed.text
    a, b = analyzed.json()["suitability"], assessed.json()["assessment"]
    assert a["verdict"] == LEGACY[b["overall_status"]]
    # Identical checks, numbers and reasons, not just the same headline.
    assert a["assessment"]["checks"] == b["checks"]
    assert a["assessment"]["compliance_flags"] == b["compliance_flags"]
    assert a["assessment"]["additional_checks"] == b["additional_checks"]


def test_uncapped_cpn_recommendation_does_not_crash(monkeypatch):
    """Regression: max gain is null for an uncapped CPN; the recommender must still rank it."""
    from app.recommend import engine as rec
    from app.schemas.client import ClientProfile
    monkeypatch.setattr(rec, "save_run", lambda **kw: None)
    profile = ClientProfile(client_name="R", risk_appetite="moderate", horizon_months=36, loss_tolerance_pct=30,
                            investable_assets=20_000_000, investment_amount=1_000_000, experience="intermediate")
    result = rec.run_recommendation(profile, filters={"product_types": ["CPN"]})
    assert result.ranking
    assert any(c.metrics_summary["max_gain_pct"] is None for c in result.ranking)


class TestEln:
    """Hand-worked ELN conventions shared by every pipeline."""

    def cfg(self, **kw):
        base = dict(product_type="ELN", underlying="NIFTY50", tenor_months=12, principal=N,
                    barrier_pct=0.7, coupon_pa=0.1)
        base.update(kw)
        return parse_product_dict(base)

    def test_default_monitoring_is_daily_like_the_replay_engine(self):
        assert self.cfg().barrier_monitoring == "daily"

    def test_breach_then_recovery_above_strike_returns_full_principal(self):
        # touched 0.6 (< barrier 0.7) but ended 1.05 (>= strike 1.0): principal back, coupon paid
        assert ELNPayoff().final_value(self.cfg(), 1.05, 0.6)[0] == pytest.approx(N + 100_000)

    def test_maturity_monitoring_ignores_the_path(self):
        cfg = self.cfg(barrier_monitoring="maturity")
        assert ELNPayoff().final_value(cfg, 1.05, 0.6)[0] == pytest.approx(N + 100_000)
        assert ELNPayoff().final_value(cfg, 0.65, 0.65)[0] == pytest.approx(N * 0.65 + 100_000)

    def test_lower_strike_scales_the_loss(self):
        cfg = self.cfg(barrier_pct=0.6, strike_pct=0.8)
        assert ELNPayoff().final_value(cfg, 0.5, 0.5)[0] == pytest.approx(N * 0.5 / 0.8 + 100_000)

    def test_conditional_coupon_is_forfeited_on_breach(self):
        cfg = self.cfg(coupon_conditional=True)
        assert ELNPayoff().final_value(cfg, 0.65, 0.65)[0] == pytest.approx(N * 0.65)
        assert ELNPayoff().final_value(cfg, 1.1, 0.95)[0] == pytest.approx(N + 100_000)


def test_dcd_interest_accrues_by_calendar_days():
    cfg = parse_product_dict(dict(product_type="DCD", underlying="USDINR", tenor_months=6, principal=100_000,
                                  strike=100.0, interest_pa=0.08, start_date="2026-01-01"))
    assert accrual_days(cfg) == 181
    assert DCDPayoff().final_value(cfg, 1.0, s0=95.0)[0] == pytest.approx(100_000 * (1 + 0.08 * 181 / 365))


def test_replay_engine_rejects_unknown_barrier_monitoring():
    from app.simulation.sim_engine.errors import InvalidProduct
    from app.simulation.sim_engine.schema import parse_product
    with pytest.raises(InvalidProduct):
        parse_product(dict(product_type="ELN", underlying="NIFTY", notional=1, tenor=12, coupon_pa=0.1,
                           strike_pct=1.0, barrier_monitoring="continuous"))
