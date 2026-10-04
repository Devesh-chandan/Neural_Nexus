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


# Holdings that mean the client has already owned a structured, leveraged or
# otherwise complex product; and holdings that are market-linked but plain.
_COMPLEX_HOLDINGS = {"MARKET_LINKED_DEBENTURES", "EQUITY_DERIVATIVES_FNO", "AIF", "PMS", "UNLISTED_SHARES"}
_MARKET_HOLDINGS = {
    "DIRECT_EQUITY", "MUTUAL_FUNDS", "INTERNATIONAL_EQUITY_LRS", "BONDS_NCDS",
    "CRYPTO", "INSURANCE_ULIP_ENDOWMENT", "NPS",
}


def experience_from_holdings(exposure: list) -> str:
    """Product experience evidenced by what the client has actually held."""
    held = {str(e).upper() for e in exposure}
    if held & _COMPLEX_HOLDINGS:
        return "experienced"
    if held & _MARKET_HOLDINGS:
        return "intermediate"
    return "novice"


def is_dataset_record(profile: dict) -> bool:
    """True for a full client record (clients_india.json shape), not a flat ClientProfile."""
    return isinstance(profile, dict) and "suitability_profile" in profile


def normalize_profile(raw: dict, client_name: str = "") -> dict:
    """Convert a full client record (clients_india.json shape) into a ClientProfile dict.

    Only values present in the record are returned. Anything the record does not hold
    (planned ticket size, existing structured-product share) is left as None rather
    than estimated.
    """
    if not is_dataset_record(raw):
        return raw if isinstance(raw, dict) else {}
    primary = raw.get("primary_information") or {}
    fin = raw.get("financial_information") or {}
    suit = raw.get("suitability_profile") or {}
    plan = raw.get("investment_plan") or {}
    exposure = fin.get("previous_investment_exposure") or []

    net_worth = fin.get("liquid_net_worth_inr")
    horizon_years = suit.get("investment_horizon_years")
    loss_tol = suit.get("loss_tolerance_pct")  # dataset stores fractions (0.35 = 35%)
    concentration = suit.get("current_portfolio_concentration_pct")
    tax_id = primary.get("national_tax_id")

    return {
        "client_name": primary.get("legal_name") or client_name,
        "risk_appetite": (suit.get("risk_appetite") or "").lower() or None,
        "horizon_months": None if horizon_years is None else min(120, max(3, int(round(float(horizon_years) * 12)))),
        "loss_tolerance_pct": None if loss_tol is None else round(float(loss_tol) * 100, 2),
        "investable_assets": float(net_worth) if net_worth else None,
        "investment_amount": plan.get("amount_inr"),
        "existing_exposure_underlying_pct": None if concentration is None else round(float(concentration) * 100, 2),
        "existing_structured_pct": None,
        "experience": suit.get("experience") or experience_from_holdings(exposure),
        "target_return_pa": plan.get("target_return_pa"),
        "preferred_underlying_types": plan.get("preferred_underlying_types"),
        "needs_liquidity_within_months": plan.get("needs_liquidity_within_months"),
        "date_of_birth": primary.get("date_of_birth"),
        "employment_status": (primary.get("employment_status") or "").lower() or None,
        "national_tax_id": tax_id.get("value") if isinstance(tax_id, dict) else tax_id,
        "liquid_net_worth": float(net_worth) if net_worth else None,
        "annual_income": float(fin.get("annual_income_inr") or 0) or None,
        "source_of_funds": (fin.get("source_of_funds") or "").lower() or None,
        "kyc_verified": (raw.get("kyc_import") or {}).get("kyc_status") == "VERIFIED",
    }


def merge_profile_edit(stored: dict, edited: dict, reviewed_now: bool = True) -> dict:
    """Apply a ClientProfile edit to the stored case profile.

    A full client record keeps its identity, KYC import and compliance screening
    (`_meta`); only the fields the client can answer are written back, in the
    record's own units. A flat profile is simply replaced. `reviewed_now` marks the
    profile as freshly reviewed (the client just re-answered the questions).
    """
    if not is_dataset_record(stored):
        return edited
    record = json.loads(json.dumps(stored))
    primary = record.setdefault("primary_information", {})
    fin = record.setdefault("financial_information", {})
    suit = record.setdefault("suitability_profile", {})

    def put(section: dict, key: str, value) -> None:
        if value is not None:
            section[key] = value

    put(primary, "legal_name", edited.get("client_name"))
    put(primary, "date_of_birth", edited.get("date_of_birth"))
    if edited.get("employment_status"):
        primary["employment_status"] = str(edited["employment_status"]).upper()
    if edited.get("national_tax_id"):
        current = primary.get("national_tax_id")
        tax_type = current.get("type") if isinstance(current, dict) else "PAN"
        primary["national_tax_id"] = {"type": tax_type, "value": edited["national_tax_id"]}

    put(fin, "liquid_net_worth_inr", edited.get("liquid_net_worth") or edited.get("investable_assets"))
    put(fin, "annual_income_inr", edited.get("annual_income"))
    if edited.get("source_of_funds"):
        fin["source_of_funds"] = str(edited["source_of_funds"]).upper()

    if edited.get("risk_appetite"):
        suit["risk_appetite"] = str(edited["risk_appetite"]).upper()
    if edited.get("horizon_months") is not None:
        suit["investment_horizon_years"] = round(float(edited["horizon_months"]) / 12.0, 4)
    if edited.get("loss_tolerance_pct") is not None:
        suit["loss_tolerance_pct"] = round(float(edited["loss_tolerance_pct"]) / 100.0, 4)
    if edited.get("existing_exposure_underlying_pct") is not None:
        suit["current_portfolio_concentration_pct"] = round(float(edited["existing_exposure_underlying_pct"]) / 100.0, 4)
    put(suit, "experience", edited.get("experience"))

    record["investment_plan"] = {
        **(record.get("investment_plan") or {}),
        "amount_inr": edited.get("investment_amount"),
        "target_return_pa": edited.get("target_return_pa"),
        "preferred_underlying_types": edited.get("preferred_underlying_types"),
        "needs_liquidity_within_months": edited.get("needs_liquidity_within_months"),
    }
    if reviewed_now:
        # The client has just re-answered the suitability questions, so the profile is current.
        record["profile_last_reviewed_at"] = datetime.now(timezone.utc).isoformat()
        record.setdefault("_meta", {})["profile_stale"] = False
    return record


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


def update_case_profile(case_id: str, profile: dict, client_name: str) -> None:
    conn = get_connection()
    with conn:
        conn.execute(
            "UPDATE cases SET profile_json = %s, client_name = %s WHERE case_id = %s",
            (json.dumps(profile), client_name, case_id),
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
