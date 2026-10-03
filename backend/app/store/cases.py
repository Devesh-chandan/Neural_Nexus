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


def create_case(
    profile_json: dict,
    client_name: str,
    owner_user_id: Optional[str] = None,
) -> str:
    conn = get_connection()
    case_id = _gen_case_id()
    now = datetime.now(timezone.utc).isoformat()
    with conn:
        conn.execute(
            """INSERT INTO cases
               (case_id, client_name, profile_json, created_at, owner_user_id)
               VALUES (%s, %s, %s, %s, %s)""",
            (case_id, client_name, json.dumps(profile_json), now, owner_user_id),
        )
    conn.close()
    return case_id


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
            d["profile"] = json.loads(d.pop("profile_json"))
        except Exception:
            d["profile"] = {}
        res.append(d)
    return res
