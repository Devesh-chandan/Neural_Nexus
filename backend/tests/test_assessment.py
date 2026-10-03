"""
Offline tests for the Module 3 integration (app.assessment.*, POST /api/assess).

Module 2 runs for real against a synthetic local price CSV, as in test_simulation.py, so the
Module 2 -> Module 3 hand-off is exercised end to end without network access.
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

import app.main as main_module
from app.api import routes_assessment
from app.assessment.service import assess_case, to_module3_client
from app.simulation import service as simulation_service

SEEDED_CLIENT = {
    "client_id": "CLT-IN-0001",
    "financial_information": {"liquid_net_worth_inr": 10_000_000},
    "suitability_profile": {
        "risk_appetite": "AGGRESSIVE",
        "investment_horizon_years": 5,
        "loss_tolerance_pct": 0.35,
        "current_portfolio_concentration_pct": 0.04,
    },
    "_meta": {"aml_risk": "LOW", "vulnerable_client": False,
              "fatca_us_person": False, "profile_stale": False},
}

ELN_PRODUCT = {
    "product_type": "ELN", "underlying": "NIFTY", "tenor_months": 12,
    "principal": 1_000_000, "barrier_pct": 0.7, "coupon_pa": 0.1,
}


@pytest.fixture(autouse=True)
def no_real_llm(monkeypatch):
    """Never call Groq from tests, whatever backend/.env says; tests opt in via groq_settings."""
    from app.core.config import get_settings
    monkeypatch.setattr(get_settings(), "llm_provider", "none")


def seeded_case(client=SEEDED_CLIENT, owner="user-1"):
    return {"case_id": client["client_id"], "profile_json": json.dumps(client), "owner_user_id": owner}


@pytest.fixture
def synthetic_prices(tmp_path, monkeypatch):
    prices_dir = tmp_path / "prices"
    prices_dir.mkdir()
    dates = pd.bdate_range("2015-01-01", periods=3000)
    rng = np.random.default_rng(42)
    closes = 100 * np.cumprod(1 + rng.normal(0.0003, 0.012, len(dates)))
    pd.DataFrame({"Date": dates.strftime("%Y-%m-%d"), "Close": closes}).to_csv(
        prices_dir / "NIFTY.csv", index=False
    )
    monkeypatch.setattr(simulation_service, "MODULE2_DATA_DIR", str(tmp_path))


class TestClientAdapter:
    def test_seeded_record_passes_through(self):
        client, gaps = to_module3_client(seeded_case())
        assert client["_meta"]["aml_risk"] == "LOW"
        assert client["suitability_profile"]["loss_tolerance_pct"] == 0.35
        assert gaps == []

    def test_normalised_profile_is_mapped_and_flags_missing_screening(self):
        case = {"case_id": "AB12CD34", "profile_json": json.dumps({
            "client_name": "Test", "risk_appetite": "moderate", "horizon_months": 18,
            "loss_tolerance_pct": 15, "investable_assets": 5_000_000,
            "investment_amount": 500_000, "existing_exposure_underlying_pct": 5,
        })}
        client, gaps = to_module3_client(case)
        suit = client["suitability_profile"]
        assert client["client_id"] == "AB12CD34"
        assert suit["risk_appetite"] == "MODERATE"
        assert suit["investment_horizon_years"] == 1.5
        assert suit["loss_tolerance_pct"] == 0.15
        assert suit["current_portfolio_concentration_pct"] == 0.05
        assert client["financial_information"]["liquid_net_worth_inr"] == 5_000_000
        assert client["_meta"]["aml_risk"] == "UNKNOWN"
        assert gaps


class TestAssessCase:
    def test_module2_output_feeds_module3(self, synthetic_prices):
        result = assess_case(seeded_case(), ELN_PRODUCT)
        sim, assessment = result["simulation"], result["assessment"]
        assert len(sim["scenarios"]) == 20
        assert assessment["simulation_run_id"] == sim["run_id"]
        assert assessment["product_id"] == sim["product_id"]
        assert assessment["client_id"] == "CLT-IN-0001"
        assert assessment["overall_status"] in {"SUITABLE", "REVIEW_REQUIRED", "NOT_SUITABLE"}
        worst = min(s["return_pct"] for s in sim["scenarios"])
        assert assessment["checks"]["risk_appetite"]["worst_simulated_return_pct"] == round(worst, 2)
        assert assessment["checks"]["loss_tolerance"]["product_value_pct"] == round(worst / 100, 4)

    def test_normalised_profile_never_comes_back_suitable(self, synthetic_prices):
        case = {"case_id": "AB12CD34", "profile_json": json.dumps({
            "risk_appetite": "aggressive", "horizon_months": 60, "loss_tolerance_pct": 90,
            "investable_assets": 100_000_000, "investment_amount": 1_000_000,
        })}
        result = assess_case(case, ELN_PRODUCT)
        assert result["assessment"]["compliance_flags"]["aml_risk"]["status"] == "REVIEW"
        assert result["assessment"]["overall_status"] != "SUITABLE"


class TestAssessRoute:
    @pytest.fixture
    def api(self, monkeypatch):
        users = {"token-rm": {"id": "rm-1", "user_type": "rm"},
                 "token-owner": {"id": "user-1", "user_type": "client"},
                 "token-other": {"id": "user-2", "user_type": "client"}}
        monkeypatch.setattr(main_module, "verify_access_token", lambda token: users[token])
        monkeypatch.setattr(routes_assessment, "get_case",
                            lambda cid: seeded_case() if cid == "CLT-IN-0001" else None)
        self.audit = []
        monkeypatch.setattr(routes_assessment, "append_audit", lambda **kw: self.audit.append(kw))
        return TestClient(main_module.app)

    def post(self, api, token, client_id="CLT-IN-0001"):
        return api.post("/api/assess", json={"client_id": client_id, "product": ELN_PRODUCT},
                        headers={"Authorization": f"Bearer {token}"})

    def test_rm_gets_assessment_and_it_is_audited(self, api, synthetic_prices):
        res = self.post(api, "token-rm")
        assert res.status_code == 200
        body = res.json()
        assert body["assessment"]["client_id"] == "CLT-IN-0001"
        assert body["disclaimer"]
        assert len(self.audit) == 1
        assert self.audit[0]["verdict"] == body["assessment"]["overall_status"]
        assert self.audit[0]["run_id"] == body["assessment"]["assessment_id"]

    def test_client_can_assess_own_case(self, api, synthetic_prices):
        assert self.post(api, "token-owner").status_code == 200

    def test_client_cannot_assess_someone_elses_case(self, api):
        res = self.post(api, "token-other")
        assert res.status_code == 404
        assert self.audit == []

    def test_unknown_case_is_404(self, api):
        assert self.post(api, "token-rm", client_id="NOPE").status_code == 404

    def test_requires_authentication(self, api):
        res = api.post("/api/assess", json={"client_id": "CLT-IN-0001", "product": ELN_PRODUCT})
        assert res.status_code == 401


# ── Explanation layer (Groq LLM + validation + template fallback) ─────────────

from app.assessment import explain as m3_explain  # noqa: E402
from app.core.config import get_settings  # noqa: E402
from app.explain import llm as llm_module  # noqa: E402


@pytest.fixture
def groq_settings(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "llm_provider", "groq")
    monkeypatch.setattr(settings, "groq_api_key", "test-key")
    monkeypatch.setattr(settings, "llm_model", "")
    return settings


@pytest.fixture
def assessed(synthetic_prices):
    return assess_case(seeded_case(), ELN_PRODUCT, explain=False)


def facts_for(assessed):
    client, gaps = to_module3_client(seeded_case())
    return m3_explain.build_facts(assessed["assessment"], assessed["simulation"], client, gaps)


def llm_reply_from_template(facts, audience):
    """A well-formed reply built from the template, i.e. one that should pass validation."""
    return (m3_explain.client_template if audience == "client" else m3_explain.rm_template)(facts)


class TestGroqConfig:
    def test_missing_key_means_no_call(self, groq_settings, monkeypatch):
        monkeypatch.setattr(groq_settings, "groq_api_key", "")
        assert llm_module.unavailable_reason() == "GROQ_API_KEY is not set."
        assert llm_module.call_llm_json("s", "u") is None

    def test_default_groq_model(self, groq_settings):
        assert llm_module.unavailable_reason() is None
        assert llm_module.active_model() == "llama-3.3-70b-versatile"

    def test_groq_uses_openai_compatible_endpoint(self, groq_settings, monkeypatch):
        seen = {}

        def fake(system, user, max_tokens, *, api_key, base_url, label):
            seen.update(api_key=api_key, base_url=base_url)
            return {"ok": True}

        monkeypatch.setattr(llm_module, "_call_openai_compatible", fake)
        assert llm_module.call_llm_json("s", "u") == {"ok": True}
        assert seen == {"api_key": "test-key", "base_url": "https://api.groq.com/openai/v1"}


class TestValidator:
    def test_templates_pass(self, assessed):
        client_facts, rm_facts = facts_for(assessed)
        assert m3_explain.validate_explanation(m3_explain.client_template(client_facts), client_facts, "client") == []
        assert m3_explain.validate_explanation(m3_explain.rm_template(rm_facts), rm_facts, "rm") == []

    def test_wrong_verdict_is_rejected(self, assessed):
        client_facts, _ = facts_for(assessed)
        reply = llm_reply_from_template(client_facts, "client")
        verdict = client_facts["verdict"]
        reply["headline"] = ("This product is suitable for you." if verdict != "SUITABLE"
                             else "This product is not suitable for you.")
        assert any("Verdict" in p for p in m3_explain.validate_explanation(reply, client_facts, "client"))

    def test_invented_number_is_rejected(self, assessed):
        client_facts, _ = facts_for(assessed)
        reply = llm_reply_from_template(client_facts, "client")
        reply["summary"] += " It would return 987.6% next year."
        assert any("987.6" in p for p in m3_explain.validate_explanation(reply, client_facts, "client"))

    def test_compliance_detail_never_reaches_client(self, assessed):
        client_facts, _ = facts_for(assessed)
        reply = llm_reply_from_template(client_facts, "client")
        reply["summary"] += " Your AML screening is pending."
        assert any("compliance" in p for p in m3_explain.validate_explanation(reply, client_facts, "client"))

    def test_failed_check_must_be_worded_as_failure(self, assessed):
        client_facts, _ = facts_for(assessed)
        client_facts["checks"]["investment_horizon"]["status"] = "FAIL"
        reply = llm_reply_from_template(client_facts, "client")
        reply["checks"]["investment_horizon"] = "The term works well with your plans."
        assert any("investment_horizon" in p for p in m3_explain.validate_explanation(reply, client_facts, "client"))

    def test_missing_check_is_rejected(self, assessed):
        _, rm_facts = facts_for(assessed)
        reply = llm_reply_from_template(rm_facts, "rm")
        del reply["checks"]["loss_tolerance"]
        assert m3_explain.validate_explanation(reply, rm_facts, "rm")


class TestExplainAssessment:
    def run(self, assessed):
        client, gaps = to_module3_client(seeded_case())
        return m3_explain.explain_assessment(assessed["assessment"], assessed["simulation"], client, gaps)

    def test_valid_llm_reply_is_used(self, assessed, groq_settings, monkeypatch):
        prompts = []

        def fake_llm(system, user, max_tokens=900):
            prompts.append((system, json.loads(user)))
            audience = "client" if system == m3_explain.CLIENT_SYSTEM_PROMPT else "rm"
            return llm_reply_from_template(json.loads(user), audience)

        monkeypatch.setattr(m3_explain, "call_llm_json", fake_llm)
        out = self.run(assessed)
        assert out["client"]["source"] == out["rm"]["source"] == "llm"
        assert out["model"] == "llama-3.3-70b-versatile"
        client_facts = next(f for s, f in prompts if s == m3_explain.CLIENT_SYSTEM_PROMPT)
        assert "compliance_flags" not in client_facts and "data_gaps" not in client_facts

    def test_invalid_llm_reply_falls_back_to_template(self, assessed, groq_settings, monkeypatch):
        monkeypatch.setattr(m3_explain, "call_llm_json", lambda *a, **k: {"headline": "Buy it, guaranteed!"})
        out = self.run(assessed)
        assert out["client"]["source"] == "template"
        assert out["client"]["fallback_reason"].startswith("LLM reply failed validation")
        assert out["model"] is None

    def test_no_key_uses_template_with_reason(self, assessed, groq_settings, monkeypatch):
        monkeypatch.setattr(groq_settings, "groq_api_key", "")
        out = self.run(assessed)
        assert out["client"]["source"] == out["rm"]["source"] == "template"
        assert out["rm"]["fallback_reason"] == "GROQ_API_KEY is not set."


class TestAssessRouteExplanation(TestAssessRoute):
    def test_rm_sees_both_explanations_and_compliance(self, api, synthetic_prices):
        body = self.post(api, "token-rm").json()
        assert set(body["explanation"]) >= {"client", "rm", "model", "prompt_version"}
        assert "compliance_flags" in body["assessment"]
        assert self.audit[0]["payload"]["explanation"] == body["explanation"]

    def test_client_sees_only_their_explanation(self, api, synthetic_prices):
        body = self.post(api, "token-owner").json()
        assert "rm" not in body["explanation"]
        assert "compliance_flags" not in body["assessment"]
        assert isinstance(body["assessment"]["additional_checks_required"], bool)
        assert body["data_gaps"] == []
