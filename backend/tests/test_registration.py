"""
Registration tests for Client KYC Onboarding and Relationship Manager (RM) Registration.
Verifies all validation rules, provider imports, RBAC enforcement, and audit flags.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.schemas.registration import (
    ClientRegistration,
    KYCIdentity,
    KYCFinancials,
    SuitabilityAnswers,
    RMSRegistration,
    RMSIdentity,
    RMSCompliance,
    RMSAccess,
)
from app.kyc.providers import list_providers, import_kyc
from app.schemas.registration import KycImportRequest


import uuid
from datetime import datetime, timezone

client = TestClient(app)


@pytest.fixture(autouse=True)
def in_memory_store(monkeypatch):
    """Keep registrations out of the real database: tests must not leave rows behind."""
    from app.api import routes_registration as rr

    cases: dict = {}
    rms: dict = {}

    def create_case(profile, client_name, owner_user_id=None, product_config=None):
        case_id = f"TEST{len(cases):04d}"
        cases[case_id] = {"case_id": case_id, "client_name": client_name, "profile": profile}
        return case_id

    def register_rm(**kw):
        rm_id = f"RMTEST{len(rms):04d}"
        rms[rm_id] = {**kw, "rm_id": rm_id, "created_at": datetime.now(timezone.utc).isoformat()}
        return rm_id

    def find_rm_by_employee_id(institution, employee_id):
        return next((r for r in rms.values()
                     if r["institution"] == institution and r["employee_id"] == employee_id), None)

    monkeypatch.setattr(rr, "init_db", lambda: None)
    monkeypatch.setattr(rr, "create_case", create_case)
    monkeypatch.setattr(rr, "delete_case", lambda case_id: cases.pop(case_id, None))
    monkeypatch.setattr(rr, "register_rm", register_rm)
    monkeypatch.setattr(rr, "find_rm_by_employee_id", find_rm_by_employee_id)
    monkeypatch.setattr(rr, "get_rm", lambda rm_id: rms.get(rm_id))
    monkeypatch.setattr(rr, "delete_rm_registration", lambda rm_id: rms.pop(rm_id, None))


class TestClientRegistration:
    def test_valid_client_manual_registration(self):
        payload = {
            "identity": {
                "legal_name": "Aarav Sharma",
                "date_of_birth": "1990-05-15",
                "employment_status": "salaried",
                "national_tax_id": "ABCDE1234F",
            },
            "financials": {
                "liquid_net_worth": 10000000.0,
                "annual_income": 2500000.0,
                "source_of_funds": "salary",
                "previous_investment_exposure_pct": 10.0,
                "investment_amount": 1000000.0,
            },
            "suitability": {
                "risk_appetite": "moderate",
                "investment_horizon_years": 3.0,
                "loss_tolerance_pct": 15.0,
                "current_portfolio_concentration_pct": 10.0,
                "experience": "intermediate",
            },
            "consent_kyc": True,
            "consent_sof": True,
        }
        res = client.post("/api/registration/client", json=payload)
        assert res.status_code == 200, res.text
        data = res.json()
        assert data["client_name"] == "Aarav Sharma"
        assert data["kyc_source"] == "manual"
        assert data["kyc_verified"] is True
        assert "case_id" in data
        assert data["age_years"] >= 30

    def test_client_registration_requires_kyc_consent(self):
        payload = {
            "identity": {
                "legal_name": "Aarav Sharma",
                "date_of_birth": "1990-05-15",
            },
            "financials": {
                "liquid_net_worth": 10000000.0,
                "annual_income": 2500000.0,
                "investment_amount": 1000000.0,
            },
            "suitability": {
                "risk_appetite": "moderate",
                "investment_horizon_years": 3.0,
                "loss_tolerance_pct": 15.0,
                "current_portfolio_concentration_pct": 10.0,
            },
            "consent_kyc": False,  # Missing consent
        }
        res = client.post("/api/registration/client", json=payload)
        assert res.status_code == 422

    def test_investment_amount_exceeding_net_worth_fails(self):
        payload = {
            "identity": {
                "legal_name": "Aarav Sharma",
                "date_of_birth": "1990-05-15",
            },
            "financials": {
                "liquid_net_worth": 1000000.0,
                "annual_income": 500000.0,
                "investment_amount": 2000000.0,  # Exceeds liquid net worth!
            },
            "suitability": {
                "risk_appetite": "moderate",
                "investment_horizon_years": 3.0,
                "loss_tolerance_pct": 15.0,
                "current_portfolio_concentration_pct": 10.0,
            },
            "consent_kyc": True,
        }
        res = client.post("/api/registration/client", json=payload)
        assert res.status_code == 422


class TestKYCImport:
    def test_list_kyc_providers(self):
        res = client.get("/api/kyc/providers")
        assert res.status_code == 200
        data = res.json()
        provider_keys = [p["key"] for p in data["providers"]]
        assert "kite" in provider_keys
        assert "zerodha_console" in provider_keys
        assert "groww" in provider_keys
        assert "cred" in provider_keys

    def test_providers_report_not_connected(self):
        data = client.get("/api/kyc/providers").json()
        assert all(p["connected"] is False for p in data["providers"])

    def test_import_kyc_refused_without_connector(self):
        # No identity is ever synthesised: without a live connector the import is refused.
        res = client.post("/api/kyc/import", json={"provider": "kite", "handle": "AB1234"})
        assert res.status_code == 503
        assert res.json()["error"]["code"] == "PROVIDER_NOT_CONNECTED"


class TestRMRegistration:
    @pytest.fixture(autouse=True)
    def mock_supabase_admin(self, monkeypatch):
        from app.api import routes_registration

        monkeypatch.setattr(routes_registration, "create_auth_user", lambda **_: "test-auth-user")
        monkeypatch.setattr(routes_registration, "update_auth_profile", lambda *_args, **_kwargs: None)
        monkeypatch.setattr(routes_registration, "delete_auth_user", lambda *_args, **_kwargs: None)

    def test_validate_corporate_email_accepts_bank_domain(self):
        res = client.post("/api/registration/validate/email", json={"email": "priya@hdfcbank.com"})
        assert res.status_code == 200
        data = res.json()
        assert data["accepted"] is True
        assert data["is_public_provider"] is False

    def test_validate_corporate_email_rejects_public_domain(self):
        res = client.post("/api/registration/validate/email", json={"email": "priya@gmail.com"})
        assert res.status_code == 200
        data = res.json()
        assert data["accepted"] is False
        assert data["is_public_provider"] is True

    def test_register_rm_junior(self):
        uid = uuid.uuid4().hex[:6].upper()
        payload = {
            "identity": {
                "legal_name": "Rohan Gupta",
                "corporate_email": "rohan@icicibank.com",
                "employee_id": f"EMP-JUN-{uid}",
            },
            "compliance": {
                "regulatory_registration_number": "INZ000000001",
                "operating_jurisdiction": "IN",
                "product_types_authorised": ["ELN", "CPN"],
            },
            "access": {
                "institution": f"ICICI Wealth {uid}",
                "branch_code": "MUM-01",
                "department": "Private Banking",
                "access_tier": "junior_rm",
            },
            "password": "DemoRmPassword123!",
        }
        res = client.post("/api/registration/rm", json=payload)
        assert res.status_code == 200, res.text
        data = res.json()
        assert data["rm_id"].startswith("RM")
        assert data["access_tier"] == "junior_rm"
        assert data["rbac"]["can_finalise"] is False

    def test_register_rm_senior_advisor(self):
        uid = uuid.uuid4().hex[:6].upper()
        payload = {
            "identity": {
                "legal_name": "Meera Kapoor",
                "corporate_email": "meera@kotak.com",
                "employee_id": f"EMP-SNR-{uid}",
            },
            "compliance": {
                "regulatory_registration_number": "INZ000000002",
                "operating_jurisdiction": "IN",
                "product_types_authorised": ["ELN", "CPN", "DCD"],
            },
            "access": {
                "institution": f"Kotak Wealth {uid}",
                "branch_code": "DEL-02",
                "department": "Structured Products",
                "access_tier": "senior_advisor",
            },
            "password": "DemoRmPassword123!",
        }
        res = client.post("/api/registration/rm", json=payload)
        assert res.status_code == 200, res.text
        data = res.json()
        assert data["access_tier"] == "senior_advisor"
        assert data["rbac"]["can_finalise"] is True

    def test_duplicate_employee_id_conflict(self):
        uid = uuid.uuid4().hex[:6].upper()
        inst = f"Axis Bank {uid}"
        emp = f"EMP-DUP-{uid}"
        payload = {
            "identity": {
                "legal_name": "Vijay Nair",
                "corporate_email": "vijay@axisbank.com",
                "employee_id": emp,
            },
            "compliance": {
                "regulatory_registration_number": "INZ000000003",
                "operating_jurisdiction": "IN",
                "product_types_authorised": ["ELN"],
            },
            "access": {
                "institution": inst,
                "branch_code": "BLR-01",
                "access_tier": "junior_rm",
            },
            "password": "DemoRmPassword123!",
        }
        res1 = client.post("/api/registration/rm", json=payload)
        assert res1.status_code == 200
        res2 = client.post("/api/registration/rm", json=payload)
        assert res2.status_code == 409
        body = res2.json()
        errMsg = body.get("error", {}).get("message") or body.get("detail") or ""
        assert "already registered" in errMsg
