import json
import os
import urllib.error
import urllib.parse
import urllib.request
import uuid
from typing import Any
import psycopg2

from dotenv import load_dotenv

load_dotenv()
load_dotenv("../.env")

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
    db_url = os.getenv("DATABASE_URL", "")
    
    if not base_url or not service_key or not db_url:
        raise SystemExit(
            "Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and DATABASE_URL in backend/.env first."
        )

    print("Cleaning up existing demo users in Supabase...")
    users = api_request(base_url, service_key, "/auth/v1/admin/users?per_page=1000").get("users", [])
    for u in users:
        # Don't delete real emails, maybe just delete all since it's a demo
        api_request(base_url, service_key, f"/auth/v1/admin/users/{u['id']}", method="DELETE")
        
    print("Cleaning up Postgres database...")
    conn = psycopg2.connect(db_url)
    cur = conn.cursor()
    tables = [
        "runs", "run_finalisations", "audit_log", "rm_registration_audit",
        "client_accounts", "relationship_managers", "cases"
    ]
    for table in tables:
        cur.execute(f"DELETE FROM {table}")
    conn.commit()

    # Load RM data
    with open("../relationship_managers_india.json", "r", encoding="utf-8") as f:
        rm_data = json.load(f)
        
    print(f"Seeding {len(rm_data['relationship_managers'])} Relationship Managers...")
    for rm in rm_data["relationship_managers"]:
        rm_id = str(uuid.uuid4()).replace("-", "")[:16].upper()
        email = rm["corporate_email"]
        
        # 1. Supabase Auth
        auth_payload = {
            "email": email,
            "password": rm["credentials"]["demo_password"],
            "email_confirm": True,
            "app_metadata": {"user_type": "rm"},
            "user_metadata": {"legal_name": rm["full_legal_name"], "rm_id": rm_id}
        }
        auth_user = api_request(base_url, service_key, "/auth/v1/admin/users", method="POST", payload=auth_payload)
        user_id = auth_user["id"]
        
        # 2. Supabase User Profile
        profile_payload = {
            "id": user_id,
            "user_type": "rm",
            "legal_name": rm["full_legal_name"],
            "rm_id": rm_id,
            "employee_id": rm["employee_id"],
            "institution": rm["institution_name"],
            "branch_code": rm["branch_code"],
            "department": rm["department"],
            "access_tier": rm["access_tier"],
            "operating_jurisdiction": rm["operating_jurisdiction"]
        }
        api_request(
            base_url, service_key, "/rest/v1/user_profiles?on_conflict=id",
            method="POST", payload=profile_payload, prefer="resolution=merge-duplicates,return=minimal"
        )
        
        # 3. Postgres relationship_managers table
        cur.execute(
            """INSERT INTO relationship_managers 
               (rm_id, legal_name, corporate_email, email_domain, employee_id, regulatory_registration_number, 
               operating_jurisdiction, institution, branch_code, department, access_tier, authorised_product_types_json, created_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (
                rm_id, rm["full_legal_name"], email, email.split("@")[1], rm["employee_id"], 
                rm["regulatory_registration"].get("registration_number", "N/A") or "N/A", 
                rm["operating_jurisdiction"], rm["institution_name"], rm["branch_code"], 
                rm["department"], rm["access_tier"], "[]", rm["created_at"]
            )
        )
    conn.commit()
    
    # Load Client data
    with open("../clients_india.json", "r", encoding="utf-8") as f:
        client_data = json.load(f)
        
    print(f"Seeding {len(client_data)} Clients...")
    for client in client_data:
        case_id = client["client_id"]
        email = client["credentials"]["email"]
        
        # 1. Supabase Auth
        auth_payload = {
            "email": email,
            "password": client["credentials"]["demo_password"],
            "email_confirm": True,
            "app_metadata": {"user_type": "client"},
            "user_metadata": {"legal_name": client["primary_information"]["legal_name"], "demo_user": True}
        }
        auth_user = api_request(base_url, service_key, "/auth/v1/admin/users", method="POST", payload=auth_payload)
        user_id = auth_user["id"]
        
        # 2. Supabase User Profile
        profile_payload = {
            "id": user_id,
            "user_type": "client",
            "legal_name": client["primary_information"]["legal_name"],
            "date_of_birth": client["primary_information"]["date_of_birth"],
            "employment_status": (client["primary_information"].get("employment_status") or "").lower(),
            "national_tax_id": (client["primary_information"].get("national_tax_id") or {}).get("value") if isinstance(client["primary_information"].get("national_tax_id"), dict) else None,
            "liquid_net_worth": client["financial_information"].get("liquid_net_worth_inr") if client["financial_information"].get("liquid_net_worth_inr") else None,
            "annual_income": client["financial_information"].get("annual_income_inr") if client["financial_information"].get("annual_income_inr") else None,
            "source_of_funds": (client["financial_information"].get("source_of_funds") or "").lower(),
            "risk_appetite": (client["suitability_profile"].get("risk_appetite") or "").lower(),
            "investment_horizon_years": min(client["suitability_profile"].get("investment_horizon_years") or 5.0, 10.0)
        }
        api_request(
            base_url, service_key, "/rest/v1/user_profiles?on_conflict=id",
            method="POST", payload=profile_payload, prefer="resolution=merge-duplicates,return=minimal"
        )
        
        # 3. Postgres cases and client_accounts tables
        cur.execute(
            """INSERT INTO cases (case_id, client_name, profile_json, created_at, owner_user_id)
               VALUES (%s, %s, %s, %s, %s)""",
            (case_id, client["primary_information"]["legal_name"], json.dumps(client), client["created_at"], user_id)
        )
        
        acc_id = str(uuid.uuid4()).replace("-", "")[:16].upper()
        cur.execute(
            """INSERT INTO client_accounts (account_id, case_id, client_name, email, password_hash, created_at)
               VALUES (%s, %s, %s, %s, %s, %s)""",
            (acc_id, case_id, client["primary_information"]["legal_name"], email, client["credentials"]["password_hash"], client["created_at"])
        )
        
    conn.commit()
    conn.close()
    print("Seeding completed successfully!")

if __name__ == "__main__":
    main()
