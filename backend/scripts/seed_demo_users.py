"""Seed ten fictitious client accounts into Supabase using the Auth Admin API."""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from dotenv import load_dotenv

load_dotenv()

DEMO_PASSWORD = "NeuralDemo123!"
USERS: list[dict[str, Any]] = [
    {"legal_name": "Aarav Sharma", "email": "demo.aarav@example.test", "date_of_birth": "1988-03-14", "employment_status": "salaried", "national_tax_id": "DEMO-TAX-0001", "liquid_net_worth": 8500000, "annual_income": 1800000, "source_of_funds": "salary", "previous_investment_exposure_pct": 12, "risk_appetite": "moderate", "investment_horizon_years": 5, "loss_tolerance_pct": 18, "current_portfolio_concentration_pct": 14},
    {"legal_name": "Diya Patel", "email": "demo.diya@example.test", "date_of_birth": "1992-07-22", "employment_status": "professional", "national_tax_id": "DEMO-TAX-0002", "liquid_net_worth": 5200000, "annual_income": 1450000, "source_of_funds": "salary", "previous_investment_exposure_pct": 8, "risk_appetite": "conservative", "investment_horizon_years": 3, "loss_tolerance_pct": 8, "current_portfolio_concentration_pct": 10},
    {"legal_name": "Kabir Mehta", "email": "demo.kabir@example.test", "date_of_birth": "1984-11-09", "employment_status": "business_owner", "national_tax_id": "DEMO-TAX-0003", "liquid_net_worth": 24000000, "annual_income": 4200000, "source_of_funds": "business_income", "previous_investment_exposure_pct": 28, "risk_appetite": "aggressive", "investment_horizon_years": 8, "loss_tolerance_pct": 35, "current_portfolio_concentration_pct": 30},
    {"legal_name": "Ananya Rao", "email": "demo.ananya@example.test", "date_of_birth": "1995-01-31", "employment_status": "self_employed", "national_tax_id": "DEMO-TAX-0004", "liquid_net_worth": 3100000, "annual_income": 950000, "source_of_funds": "freelance", "previous_investment_exposure_pct": 5, "risk_appetite": "moderate", "investment_horizon_years": 4, "loss_tolerance_pct": 15, "current_portfolio_concentration_pct": 7},
    {"legal_name": "Ishaan Kapoor", "email": "demo.ishaan@example.test", "date_of_birth": "1979-05-18", "employment_status": "professional", "national_tax_id": "DEMO-TAX-0005", "liquid_net_worth": 16500000, "annual_income": 3300000, "source_of_funds": "investment_proceeds", "previous_investment_exposure_pct": 20, "risk_appetite": "moderate", "investment_horizon_years": 6, "loss_tolerance_pct": 20, "current_portfolio_concentration_pct": 22},
    {"legal_name": "Meera Iyer", "email": "demo.meera@example.test", "date_of_birth": "1968-09-03", "employment_status": "retired", "national_tax_id": "DEMO-TAX-0006", "liquid_net_worth": 11200000, "annual_income": 900000, "source_of_funds": "investment_proceeds", "previous_investment_exposure_pct": 4, "risk_appetite": "conservative", "investment_horizon_years": 2, "loss_tolerance_pct": 5, "current_portfolio_concentration_pct": 6},
    {"legal_name": "Arjun Nair", "email": "demo.arjun@example.test", "date_of_birth": "1990-12-27", "employment_status": "salaried", "national_tax_id": "DEMO-TAX-0007", "liquid_net_worth": 6700000, "annual_income": 2100000, "source_of_funds": "salary", "previous_investment_exposure_pct": 16, "risk_appetite": "aggressive", "investment_horizon_years": 7, "loss_tolerance_pct": 30, "current_portfolio_concentration_pct": 18},
    {"legal_name": "Sara Khan", "email": "demo.sara@example.test", "date_of_birth": "1987-04-11", "employment_status": "business_owner", "national_tax_id": "DEMO-TAX-0008", "liquid_net_worth": 19500000, "annual_income": 3800000, "source_of_funds": "business_income", "previous_investment_exposure_pct": 32, "risk_appetite": "aggressive", "investment_horizon_years": 9, "loss_tolerance_pct": 40, "current_portfolio_concentration_pct": 35},
    {"legal_name": "Rohan Desai", "email": "demo.rohan@example.test", "date_of_birth": "1998-08-06", "employment_status": "student", "national_tax_id": "DEMO-TAX-0009", "liquid_net_worth": 950000, "annual_income": 420000, "source_of_funds": "gift", "previous_investment_exposure_pct": 0, "risk_appetite": "conservative", "investment_horizon_years": 1, "loss_tolerance_pct": 5, "current_portfolio_concentration_pct": 0},
    {"legal_name": "Nisha Verma", "email": "demo.nisha@example.test", "date_of_birth": "1982-02-19", "employment_status": "homemaker", "national_tax_id": "DEMO-TAX-0010", "liquid_net_worth": 7800000, "annual_income": 1250000, "source_of_funds": "inheritance", "previous_investment_exposure_pct": 10, "risk_appetite": "moderate", "investment_horizon_years": 5, "loss_tolerance_pct": 15, "current_portfolio_concentration_pct": 12},
]


def api_request(
    base_url: str,
    service_key: str,
    path: str,
    *,
    method: str = "GET",
    payload: dict[str, Any] | list[dict[str, Any]] | None = None,
    prefer: str | None = None,
) -> Any:
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(
        f"{base_url}{path}", data=data, headers=headers, method=method
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            body = response.read()
            return json.loads(body) if body else None
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Supabase request failed ({exc.code}): {detail}") from exc


def main() -> None:
    base_url = os.getenv("SUPABASE_URL", "").rstrip("/")
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    if not base_url or not service_key:
        raise SystemExit(
            "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend/.env first."
        )

    users = api_request(base_url, service_key, "/auth/v1/admin/users?per_page=1000").get("users", [])
    by_email = {user.get("email", "").lower(): user for user in users}
    for row in USERS:
        email = row["email"]
        auth_user = by_email.get(email)
        attributes = {
            "email": email,
            "password": DEMO_PASSWORD,
            "email_confirm": True,
            "app_metadata": {"user_type": "client"},
            "user_metadata": {"legal_name": row["legal_name"], "demo_user": True},
        }
        if auth_user:
            auth_user = api_request(
                base_url,
                service_key,
                f"/auth/v1/admin/users/{urllib.parse.quote(auth_user['id'], safe='')}",
                method="PUT",
                payload=attributes,
            )
        else:
            auth_user = api_request(
                base_url,
                service_key,
                "/auth/v1/admin/users",
                method="POST",
                payload=attributes,
            )
        user_id = auth_user["id"]
        profile = {
            "id": user_id,
            "user_type": "client",
            **row,
            "investment_horizon_years": row["investment_horizon_years"],
        }
        profile.pop("email", None)
        api_request(
            base_url,
            service_key,
            "/rest/v1/user_profiles?on_conflict=id",
            method="POST",
            payload=profile,
            prefer="resolution=merge-duplicates,return=minimal",
        )
        print(f"Seeded {email} ({row['legal_name']})")

    print(f"Seeded {len(USERS)} demo users. Shared demo password: {DEMO_PASSWORD}")


if __name__ == "__main__":
    main()
