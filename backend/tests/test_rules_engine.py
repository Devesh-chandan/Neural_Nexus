"""Unit tests for the deterministic suitability rules."""
import copy
import json
from pathlib import Path

import pytest


from app.assessment.rules_engine import SuitabilityEngine, _is_index  # noqa: E402

CLIENTS_PATH = Path(__file__).resolve().parents[2] / "clients_india.json"


def make_client(**overrides):
    client = {
        "client_id": "CLT-TEST",
        "financial_information": {"liquid_net_worth_inr": 10_000_000},
        "suitability_profile": {
            "risk_appetite": "MODERATE",
            "investment_horizon_years": 3,
            "loss_tolerance_pct": 0.20,
            "current_portfolio_concentration_pct": 0.0,
        },
        "_meta": {"aml_risk": "LOW", "vulnerable_client": False,
                  "fatca_us_person": False, "profile_stale": False},
    }
    for key, value in overrides.items():
        section, _, field = key.partition("__")
        if field:
            client[section][field] = value
        else:
            client[section] = value
    return client


def make_sim(product=None, returns=(5.0, 2.0, -3.0)):
    product = product or {"product_type": "CPN", "underlying": "NIFTY50", "notional": 1_000_000,
                          "tenor": 12, "protection_pct": 1.0, "barrier_pct": None}
    return {
        "run_id": "sim_test",
        "product_id": "prod_test",
        "scenarios": [{"id": i + 1, "return_pct": r} for i, r in enumerate(returns)],
        "audit": {"product": product},
    }


def eln(barrier, underlying="NIFTY50", tenor=12, notional=1_000_000):
    return {"product_type": "ELN", "underlying": underlying, "notional": notional,
            "tenor": tenor, "barrier_pct": barrier, "strike_pct": 1.0}


@pytest.fixture
def engine():
    return SuitabilityEngine()


class TestOverall:
    def test_clean_case_is_suitable(self, engine):
        out = engine.run_assessment(make_client(), make_sim(returns=(5.0, 1.0)))
        assert out["overall_status"] == "SUITABLE"
        assert out["simulation_run_id"] == "sim_test"
        assert out["product_id"] == "prod_test"
        assert out["timestamp"].endswith("Z") and "+00:00" not in out["timestamp"]

    def test_any_fail_means_not_suitable(self, engine):
        client = make_client(suitability_profile__investment_horizon_years=0.5)
        out = engine.run_assessment(client, make_sim())
        assert out["checks"]["investment_horizon"]["status"] == "FAIL"
        assert out["overall_status"] == "NOT_SUITABLE"

    def test_review_without_fail_means_review_required(self, engine):
        client = make_client(_meta={"aml_risk": "MEDIUM"})
        out = engine.run_assessment(client, make_sim(returns=(5.0, 1.0)))
        assert out["overall_status"] == "REVIEW_REQUIRED"

    def test_empty_scenarios_raise(self, engine):
        with pytest.raises(ValueError):
            engine.run_assessment(make_client(), make_sim(returns=()))


class TestComplianceGates:
    @pytest.mark.parametrize("flag", ["vulnerable_client", "profile_stale", "fatca_us_person"])
    def test_flags_trigger_review(self, engine, flag):
        flags = engine._evaluate_compliance_gates(make_client(_meta={flag: True}))
        assert flags[flag]["status"] == "REVIEW"

    @pytest.mark.parametrize("level,status", [("LOW", "PASS"), ("MEDIUM", "REVIEW"),
                                              ("HIGH", "FAIL"), ("UNKNOWN", "REVIEW")])
    def test_aml_levels(self, engine, level, status):
        flags = engine._evaluate_compliance_gates(make_client(_meta={"aml_risk": level}))
        assert flags["aml_risk"]["status"] == status


class TestRiskAppetite:
    def test_full_protection_cpn_is_conservative(self, engine):
        check = engine._evaluate_risk_appetite(
            make_client(suitability_profile__risk_appetite="CONSERVATIVE"),
            make_sim()["audit"]["product"], make_sim(returns=(3.0, 0.0)))
        assert check["product_value_category"] == "CONSERVATIVE"
        assert check["status"] == "PASS"

    def test_index_eln_with_low_barrier_is_moderate(self, engine):
        sim = make_sim(eln(0.60), returns=(4.0, -10.0))
        check = engine._evaluate_risk_appetite(make_client(), sim["audit"]["product"], sim)
        assert check["structural_category"] == "MODERATE"
        assert check["status"] == "PASS"

    @pytest.mark.parametrize("product", [eln(0.75), eln(0.60, underlying="RELIANCE"), eln(None)])
    def test_high_barrier_single_stock_or_no_barrier_eln_is_aggressive(self, engine, product):
        sim = make_sim(product, returns=(4.0,))
        check = engine._evaluate_risk_appetite(make_client(), product, sim)
        assert check["structural_category"] == "AGGRESSIVE"

    def test_worst_scenario_can_raise_the_level(self, engine):
        sim = make_sim(returns=(5.0, -20.0))  # CPN 100% protected, but history lost 20%
        check = engine._evaluate_risk_appetite(
            make_client(suitability_profile__risk_appetite="CONSERVATIVE"), sim["audit"]["product"], sim)
        assert check["historical_category"] == "AGGRESSIVE"
        assert check["status"] == "FAIL"  # two levels above the client

    def test_one_level_above_is_review(self, engine):
        sim = make_sim(returns=(5.0, -5.0))
        check = engine._evaluate_risk_appetite(
            make_client(suitability_profile__risk_appetite="CONSERVATIVE"), sim["audit"]["product"], sim)
        assert check["status"] == "REVIEW"

    def test_unknown_appetite_is_treated_as_conservative(self, engine):
        sim = make_sim(returns=(5.0, -20.0))
        check = engine._evaluate_risk_appetite(
            make_client(suitability_profile__risk_appetite="???"), sim["audit"]["product"], sim)
        assert check["client_limit_category"] == "CONSERVATIVE"
        assert check["status"] == "FAIL"


class TestHorizon:
    def test_tenor_within_horizon_passes(self, engine):
        check = engine._evaluate_investment_horizon(make_client(), {"tenor": 36})
        assert check["status"] == "PASS"

    def test_tenor_beyond_horizon_fails(self, engine):
        check = engine._evaluate_investment_horizon(make_client(), {"tenor": 48})
        assert check["status"] == "FAIL"
        assert check["product_value_years"] == 4.0


class TestLossTolerance:
    def test_loss_within_tolerance_passes(self, engine):
        check = engine._evaluate_loss_tolerance(make_client(), make_sim(returns=(3.0, -19.9)))
        assert check["status"] == "PASS"
        assert check["product_value_pct"] == -0.199

    def test_loss_beyond_tolerance_fails(self, engine):
        check = engine._evaluate_loss_tolerance(make_client(), make_sim(returns=(3.0, -25.0)))
        assert check["status"] == "FAIL"
        assert check["client_limit_pct"] == -0.2


class TestConcentration:
    @pytest.mark.parametrize("notional,status", [(1_500_000, "PASS"), (2_000_000, "REVIEW"),
                                                 (3_000_000, "FAIL")])
    def test_moderate_thresholds(self, engine, notional, status):
        check = engine._evaluate_concentration(make_client(), {"notional": notional})
        assert check["status"] == status

    def test_existing_concentration_is_added(self, engine):
        client = make_client(suitability_profile__current_portfolio_concentration_pct=10)  # 10 as percent
        check = engine._evaluate_concentration(client, {"notional": 1_000_000})
        assert check["product_value_pct"] == 0.2
        assert check["status"] == "REVIEW"

    def test_notional_above_net_worth_fails(self, engine):
        check = engine._evaluate_concentration(make_client(), {"notional": 20_000_000})
        assert check["status"] == "FAIL"

    def test_zero_net_worth_fails_without_crashing(self, engine):
        client = make_client(financial_information={"liquid_net_worth_inr": 0})
        check = engine._evaluate_concentration(client, {"notional": 1})
        assert check["status"] == "FAIL"


def test_is_index_covers_backend_keys():
    assert _is_index("NIFTY50") and _is_index("BANKNIFTY") and _is_index("SP500")
    assert not _is_index("RELIANCE") and not _is_index("AAPL")


@pytest.mark.skipif(not CLIENTS_PATH.exists(), reason="clients_india.json not present")
def test_every_seeded_client_assesses(engine):
    clients = json.loads(CLIENTS_PATH.read_text(encoding="utf-8"))
    sim = make_sim(eln(0.70), returns=(8.0, 1.0, -12.0, -30.0))
    statuses = {engine.run_assessment(copy.deepcopy(c), sim)["overall_status"] for c in clients}
    assert statuses <= {"SUITABLE", "REVIEW_REQUIRED", "NOT_SUITABLE"}
