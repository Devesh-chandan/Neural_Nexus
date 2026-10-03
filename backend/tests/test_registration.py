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

client = TestClient(app)


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

    def test_import_kyc_kite(self):
        req = {"provider": "kite", "handle": "AB1234"}
        res = client.post("/api/kyc/import", json=req)
        assert res.status_code == 200
        data = res.json()
        assert data["provider"] == "kite"
        assert data["provider_label"] == "Kite by Zerodha"
        assert "legal_name" in data["identity"]
        assert "liquid_net_worth" in data["financials"]
        assert "risk_appetite" in data["fields_still_required"]


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
