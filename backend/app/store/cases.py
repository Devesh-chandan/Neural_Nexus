"""
Case persistence (create, get, 8-char ID generator).
"""
from __future__ import annotations

import json
import random
import string
from datetime import datetime, timezone
from typing import Optional

from app.store.db import get_connection

# 8-char ID: uppercase letters + digits, excluding ambiguous chars
_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def _gen_case_id() -> str:
    return "".join(random.choices(_CHARS, k=8))


def normalize_profile(raw: dict, client_name: str = "") -> dict:
    """Convert a seeded raw client record (clients_india.json shape) into a ClientProfile dict."""
    if not isinstance(raw, dict) or "primary_information" not in raw:
        return raw if isinstance(raw, dict) else {}
    primary = raw.get("primary_information") or {}
    fin = raw.get("financial_information") or {}
    suit = raw.get("suitability_profile") or {}
    exposure = fin.get("previous_investment_exposure") or []

    net_worth = float(fin.get("liquid_net_worth_inr") or 0) or 1_000_000.0
    # Seed data has no ticket size; assume 10% of liquid net worth, rounded to the nearest lakh.
    ticket = max(100_000.0, round(net_worth * 0.10 / 100_000) * 100_000)
    horizon = int(round(float(suit.get("investment_horizon_years") or 1) * 12))
    loss_tol = float(suit.get("loss_tolerance_pct") or 0)
    if loss_tol <= 1:
        loss_tol *= 100
    n_exp = len(exposure)
    experience = "experienced" if n_exp >= 4 else "intermediate" if n_exp >= 2 else "novice"
    tax_id = primary.get("national_tax_id")

    return {
        "client_name": primary.get("legal_name") or client_name,
        "risk_appetite": (suit.get("risk_appetite") or "moderate").lower(),
        "horizon_months": min(120, max(3, horizon)),
        "loss_tolerance_pct": min(100.0, max(0.0, loss_tol)),
        "investable_assets": net_worth,
        "investment_amount": ticket,
        "existing_exposure_underlying_pct": round(float(suit.get("current_portfolio_concentration_pct") or 0) * 100, 2),
        "existing_structured_pct": 10.0 if any("STRUCTURED" in str(e) for e in exposure) else 0.0,
        "experience": experience,
        "date_of_birth": primary.get("date_of_birth"),
        "employment_status": (primary.get("employment_status") or "").lower() or None,
        "national_tax_id": tax_id.get("value") if isinstance(tax_id, dict) else tax_id,
        "liquid_net_worth": net_worth,
        "annual_income": float(fin.get("annual_income_inr") or 0) or None,
        "source_of_funds": (fin.get("source_of_funds") or "").lower() or None,
        "kyc_verified": (raw.get("kyc_import") or {}).get("kyc_status") == "VERIFIED",
    }


def create_case(
    profile_json: dict,
    client_name: str,
    owner_user_id: Optional[str] = None,
    product_config: Optional[dict] = None,
) -> str:
    conn = get_connection()
    case_id = _gen_case_id()
    now = datetime.now(timezone.utc).isoformat()
    with conn:
        conn.execute(
            """INSERT INTO cases
               (case_id, client_name, profile_json, created_at, owner_user_id, product_config_json)
               VALUES (%s, %s, %s, %s, %s, %s)""",
            (case_id, client_name, json.dumps(profile_json), now, owner_user_id,
             json.dumps(product_config) if product_config else None),
        )
    conn.close()
    return case_id


def update_case_profile(case_id: str, profile: dict) -> None:
    conn = get_connection()
    with conn:
        conn.execute(
            "UPDATE cases SET profile_json = %s, client_name = %s WHERE case_id = %s",
            (json.dumps(profile), profile.get("client_name") or "Unknown", case_id),
        )
    conn.close()


def update_case_product_config(case_id: str, product_config: dict) -> None:
    conn = get_connection()
    with conn:
        conn.execute(
            "UPDATE cases SET product_config_json = %s WHERE case_id = %s",
            (json.dumps(product_config), case_id),
        )
    conn.close()


def delete_case(case_id: str) -> None:
    conn = get_connection()
    try:
        with conn:
            conn.execute("DELETE FROM cases WHERE case_id = %s", (case_id,))
    finally:
        conn.close()


def get_case(case_id: str) -> Optional[dict]:
    conn = get_connection()
    row = conn.execute(
        "SELECT * FROM cases WHERE case_id = %s", (case_id,)
    ).fetchone()
    conn.close()
    if row is None:
        return None
    return dict(row)


def update_recommendation_id(case_id: str, recommendation_id: str) -> None:
    conn = get_connection()
    with conn:
        conn.execute(
            "UPDATE cases SET latest_recommendation_id = %s WHERE case_id = %s",
            (recommendation_id, case_id),
        )
    conn.close()


def list_cases(owner_user_id: Optional[str] = None) -> list[dict]:
    conn = get_connection()
    if owner_user_id is None:
        rows = conn.execute("SELECT * FROM cases ORDER BY created_at DESC").fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM cases WHERE owner_user_id = %s ORDER BY created_at DESC",
            (owner_user_id,),
        ).fetchall()
    conn.close()
    res = []
    for r in rows:
        d = dict(r)
        try:
            d["profile"] = normalize_profile(json.loads(d.pop("profile_json")), d.get("client_name", ""))
        except Exception:
            d["profile"] = {}
        try:
            raw = d.pop("product_config_json", None)
            d["product_config"] = json.loads(raw) if raw else None
        except Exception:
            d["product_config"] = None
        res.append(d)
    return res
