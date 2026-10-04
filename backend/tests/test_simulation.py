"""
Offline tests for the module2_simulation_engine bridge (app.simulation.*).

Exercises the adapter (product config -> sim_engine payload) and the real sim_engine
run_simulation() call end-to-end against a synthetic local price CSV, so no network access
is required - consistent with module2_simulation_engine's own "56 tests, run offline" ethos.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from app.schemas.product import parse_product_dict
from app.simulation.adapter import to_sim_engine_payload
from app.simulation.bridge import Settings, run_simulation


@pytest.fixture
def synthetic_price_dir(tmp_path):
    """A data_dir with data/prices/NIFTY50.csv so sim_engine never hits the network."""
    prices_dir = tmp_path / "prices"
    prices_dir.mkdir()
    dates = pd.bdate_range("2015-01-01", periods=3000)
    rng = np.random.default_rng(42)
    rets = rng.normal(0.0003, 0.012, len(dates))
    closes = 100 * np.cumprod(1 + rets)
    pd.DataFrame({"Date": dates.strftime("%Y-%m-%d"), "Close": closes}).to_csv(
        prices_dir / "NIFTY50.csv", index=False
    )
    return str(tmp_path)


class TestAdapter:
    def test_eln_maps_strike_to_1(self):
        config = parse_product_dict({
            "product_type": "ELN", "underlying": "NIFTY50", "tenor_months": 12,
            "principal": 1_000_000, "barrier_pct": 0.7, "coupon_pa": 0.1,
        })
        raw = to_sim_engine_payload(config)
        assert raw["strike_pct"] == 1.0
        assert raw["notional"] == 1_000_000
        assert raw["tenor"] == 12
        assert raw["barrier_pct"] == 0.7

    def test_cpn_defaults_missing_coupon_to_zero(self):
        config = parse_product_dict({
            "product_type": "CPN", "underlying": "NIFTY50", "tenor_months": 12,
            "principal": 1_000_000, "protection_pct": 1.0, "participation_pct": 0.8,
        })
        raw = to_sim_engine_payload(config)
        assert raw["coupon_pa"] == 0.0
        assert raw["cap_pct"] is None

    def test_dcd_underlying_becomes_slash_pair(self):
        config = parse_product_dict({
            "product_type": "DCD", "underlying": "USDINR", "tenor_months": 6,
            "principal": 500_000, "currency": "USD", "strike": 83.5,
            "interest_pa": 0.05, "base_currency": "USD", "alt_currency": "INR",
        })
        raw = to_sim_engine_payload(config)
        assert raw["underlying"] == "USD/INR"
        assert raw["strike_rate"] == 83.5
        assert raw["alt_currency"] == "INR"


class TestRunSimulation:
    def test_eln_returns_20_dated_scenarios(self, synthetic_price_dir):
        config = parse_product_dict({
            "product_type": "ELN", "underlying": "NIFTY50", "tenor_months": 12,
            "principal": 1_000_000, "barrier_pct": 0.7, "coupon_pa": 0.1,
        })
        result = run_simulation(
            to_sim_engine_payload(config), settings=Settings(), data_dir=synthetic_price_dir
        )
        scenarios = result["scenarios"]
        assert len(scenarios) == 20
        assert {s["id"] for s in scenarios} == set(range(1, 21))
        for s in scenarios:
            assert "start" in s["period"] and "end" in s["period"]
            assert isinstance(s["barrier_hit"], bool)
            assert isinstance(s["money_back"], float)
            assert isinstance(s["story"], str) and s["story"]
        assert result["audit"]["market_data"]["fingerprint"].startswith("sha256:")
        assert result["currency"] == "INR"
