"""
Seed the India dataset (clients_india.json, relationship_managers_india.json)
into Supabase Auth, Supabase `user_profiles` and the Postgres app tables.

Idempotent: existing Supabase users are updated in place (matched by email) and
Postgres rows are upserted, so re-running it repairs data instead of wiping it.
Nothing outside the dataset is deleted. Client case profiles are only inserted,
never overwritten, so edits made in the app survive a re-seed.

Usage (from backend/):
    python scripts/seed_india_data.py
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional

import psycopg2
from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent
load_dotenv(BACKEND_DIR / ".env")

sys.path.insert(0, str(BACKEND_DIR))
from app.store.cases import is_dataset_record, merge_profile_edit  # noqa: E402
from app.store.db import init_db  # noqa: E402


def api_request(
    base_url: str,
    service_key: str,
    path: str,
    *,
    method: str = "GET",
    payload: Any = None,
    prefer: Optional[str] = None,
) -> Any:
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(f"{base_url}{path}", data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            body = response.read()
            return json.loads(body) if body else None
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Supabase request failed ({exc.code}) {method} {path}: {detail}") from exc


def list_auth_users(base_url: str, service_key: str) -> Dict[str, Dict[str, Any]]:
    """All Supabase auth users keyed by lower-cased email (paginated)."""
    users: Dict[str, Dict[str, Any]] = {}
    page = 1
    while True:
        batch = api_request(base_url, service_key, f"/auth/v1/admin/users?per_page=1000&page={page}")
        rows = (batch or {}).get("users", [])
        for u in rows:
            if u.get("email"):
                users[u["email"].lower()] = u
        if len(rows) < 1000:
            return users
        page += 1


def upsert_auth_user(
    base_url: str, service_key: str, existing: Dict[str, Dict[str, Any]], attributes: Dict[str, Any]
) -> str:
    current = existing.get(attributes["email"].lower())
    if current:
        # Existing accounts keep their current password; only metadata is refreshed.
        update = {k: v for k, v in attributes.items() if k != "password"}
        user = api_request(
            base_url, service_key,
            f"/auth/v1/admin/users/{urllib.parse.quote(current['id'], safe='')}",
            method="PUT", payload=update,
        )
    else:
        user = api_request(base_url, service_key, "/auth/v1/admin/users", method="POST", payload=attributes)
    return user["id"]


def upsert_profile(base_url: str, service_key: str, profile: Dict[str, Any]) -> None:
    api_request(
        base_url, service_key, "/rest/v1/user_profiles?on_conflict=id",
        method="POST", payload=profile, prefer="resolution=merge-duplicates,return=minimal",
    )


def allowed_products(rm_data: Dict[str, Any]) -> Dict[str, List[str]]:
    """Jurisdiction code -> product types the dataset marks ALLOWED."""
    return {
        j["code"]: [pt for pt, rule in j.get("product_rules_demo", {}).items() if rule.get("status") == "ALLOWED"]
        for j in rm_data.get("jurisdictions", [])
    }


def stable_rm_id(institution_id: str, employee_id: str) -> str:
    digest = hashlib.sha1(f"{institution_id}:{employee_id}".encode()).hexdigest()
    return f"RM{digest[:10].upper()}"


def pct(fraction: Optional[float]) -> Optional[float]:
    return None if fraction is None else round(float(fraction) * 100, 2)


def seed_rms(cur, base_url: str, service_key: str, users: Dict[str, Dict[str, Any]], rm_data: Dict[str, Any]) -> None:
    products_by_jurisdiction = allowed_products(rm_data)
    rms = rm_data["relationship_managers"]
    print(f"Seeding {len(rms)} relationship managers...")
    for rm in rms:
        email = rm["corporate_email"].lower()
        tier = rm["access_tier"].strip().lower()
        jurisdiction = rm["operating_jurisdiction"]
        authorised = products_by_jurisdiction.get(jurisdiction, [])
        registration = rm.get("regulatory_registration") or {}
        reg_number = registration.get("registration_number") or ""

        cur.execute(
            "SELECT rm_id FROM relationship_managers WHERE institution = %s AND employee_id = %s",
            (rm["institution_name"], rm["employee_id"]),
        )
        row = cur.fetchone()
        rm_id = row[0] if row else stable_rm_id(rm["institution_id"], rm["employee_id"])

        user_id = upsert_auth_user(base_url, service_key, users, {
            "email": email,
            "password": rm["credentials"]["demo_password"],
            "email_confirm": True,
            "app_metadata": {"user_type": "rm"},
            "user_metadata": {"legal_name": rm["full_legal_name"], "rm_id": rm_id},
        })
        upsert_profile(base_url, service_key, {
            "id": user_id,
            "user_type": "rm",
            "legal_name": rm["full_legal_name"],
            "rm_id": rm_id,
            "employee_id": rm["employee_id"],
            "institution": rm["institution_name"],
            "branch_code": rm["branch_code"],
            "department": rm.get("department"),
            "access_tier": tier,
            "operating_jurisdiction": jurisdiction,
            "authorised_product_types": authorised,
        })
        cur.execute(
            """INSERT INTO relationship_managers
               (rm_id, legal_name, corporate_email, email_domain, employee_id,
                regulatory_registration_number, operating_jurisdiction, institution,
                branch_code, department, access_tier, authorised_product_types_json, created_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
               ON CONFLICT (rm_id) DO UPDATE SET
                 legal_name=EXCLUDED.legal_name, corporate_email=EXCLUDED.corporate_email,
                 email_domain=EXCLUDED.email_domain,
                 regulatory_registration_number=EXCLUDED.regulatory_registration_number,
                 operating_jurisdiction=EXCLUDED.operating_jurisdiction,
                 institution=EXCLUDED.institution, branch_code=EXCLUDED.branch_code,
                 department=EXCLUDED.department, access_tier=EXCLUDED.access_tier,
                 authorised_product_types_json=EXCLUDED.authorised_product_types_json""",
            (
                rm_id, rm["full_legal_name"], email, email.split("@")[1], rm["employee_id"],
                reg_number, jurisdiction, rm["institution_name"], rm["branch_code"],
                rm.get("department"), tier, json.dumps(authorised), rm["created_at"],
            ),
        )
        if not reg_number:
            print(f"  note: {rm['employee_id']} has no regulatory registration number in the dataset "
                  f"({rm.get('account_status')}).")


def drop_old_estimates(flat: Dict[str, Any], client: Dict[str, Any]) -> Dict[str, Any]:
    """Remove values the previous profile loader estimated rather than read from the record:
    a ticket of 10% of net worth (rounded to a lakh, min 1 lakh) and experience from a
    count of holdings. A value that differs from the estimate was entered by the client."""
    flat = dict(flat)
    fin = client["financial_information"]
    net_worth = float(fin.get("liquid_net_worth_inr") or 0) or 1_000_000.0
    if flat.get("investment_amount") == max(100_000.0, round(net_worth * 0.10 / 100_000) * 100_000):
        flat["investment_amount"] = None
    n = len(fin.get("previous_investment_exposure") or [])
    if flat.get("experience") == ("experienced" if n >= 4 else "intermediate" if n >= 2 else "novice"):
        flat["experience"] = None
    flat.pop("existing_structured_pct", None)
    return flat


def seed_clients(cur, base_url: str, service_key: str, users: Dict[str, Dict[str, Any]], clients: List[Dict[str, Any]]) -> None:
    print(f"Seeding {len(clients)} clients...")
    for client in clients:
        case_id = client["client_id"]
        email = client["credentials"]["email"].lower()
        primary = client["primary_information"]
        fin = client["financial_information"]
        suit = client["suitability_profile"]
        tax_id = primary.get("national_tax_id")

        user_id = upsert_auth_user(base_url, service_key, users, {
            "email": email,
            "password": client["credentials"]["demo_password"],
            "email_confirm": True,
            "app_metadata": {"user_type": "client"},
            "user_metadata": {"legal_name": primary["legal_name"]},
        })
        horizon = suit.get("investment_horizon_years")
        upsert_profile(base_url, service_key, {
            "id": user_id,
            "user_type": "client",
            "legal_name": primary["legal_name"],
            "case_id": case_id,
            "date_of_birth": primary.get("date_of_birth"),
            "employment_status": (primary.get("employment_status") or "").lower() or None,
            "national_tax_id": tax_id.get("value") if isinstance(tax_id, dict) else tax_id,
            "liquid_net_worth": fin.get("liquid_net_worth_inr") or None,
            "annual_income": fin.get("annual_income_inr") or None,
            "source_of_funds": (fin.get("source_of_funds") or "").lower() or None,
            "risk_appetite": (suit.get("risk_appetite") or "").lower() or None,
            # user_profiles caps the horizon at 10 years; the case record keeps the exact value.
            "investment_horizon_years": None if horizon is None else min(max(float(horizon), 0.25), 10.0),
            "loss_tolerance_pct": pct(suit.get("loss_tolerance_pct")),
            "current_portfolio_concentration_pct": pct(suit.get("current_portfolio_concentration_pct")),
        })
        # The full dataset record (including _meta compliance flags) is the case profile.
        record = {k: v for k, v in client.items() if k != "credentials"}
        cur.execute("SELECT profile_json FROM cases WHERE case_id = %s", (case_id,))
        row = cur.fetchone()
        if row is not None:
            stored = json.loads(row[0])
            if not is_dataset_record(stored):
                # An older profile save replaced the record with a flat profile and lost the
                # KYC/compliance data: rebuild it from the dataset, keeping the client's edits
                # but not the values the old loader made up.
                record = merge_profile_edit(record, drop_old_estimates(stored, client), reviewed_now=False)
                cur.execute("UPDATE cases SET profile_json = %s WHERE case_id = %s",
                            (json.dumps(record), case_id))
                print(f"  repaired {case_id}: restored dataset record, kept the client's edits")
        cur.execute(
            """INSERT INTO cases (case_id, client_name, profile_json, created_at, owner_user_id)
               VALUES (%s, %s, %s, %s, %s)
               ON CONFLICT (case_id) DO UPDATE SET owner_user_id = EXCLUDED.owner_user_id""",
            (case_id, primary["legal_name"], json.dumps(record), client["created_at"], user_id),
        )


def main() -> None:
    base_url = os.getenv("SUPABASE_URL", "").rstrip("/")
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    db_url = os.getenv("DATABASE_URL", "")
    if not base_url or not service_key or not db_url:
        raise SystemExit("Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and DATABASE_URL in backend/.env first.")

    with open(REPO_ROOT / "relationship_managers_india.json", encoding="utf-8") as fh:
        rm_data = json.load(fh)
    with open(REPO_ROOT / "clients_india.json", encoding="utf-8") as fh:
        clients = json.load(fh)

    init_db()
    users = list_auth_users(base_url, service_key)
    conn = psycopg2.connect(db_url)
    try:
        with conn, conn.cursor() as cur:
            seed_rms(cur, base_url, service_key, users, rm_data)
        with conn, conn.cursor() as cur:
            seed_clients(cur, base_url, service_key, users, clients)
    finally:
        conn.close()
    print("Seeding completed.")


if __name__ == "__main__":
    main()
