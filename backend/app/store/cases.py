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


def create_case(profile_json: dict, client_name: str) -> str:
    conn = get_connection()
    case_id = _gen_case_id()
    now = datetime.now(timezone.utc).isoformat()
    with conn:
        conn.execute(
            "INSERT INTO cases (case_id, client_name, profile_json, created_at) VALUES (?, ?, ?, ?)",
            (case_id, client_name, json.dumps(profile_json), now),
        )
    conn.close()
    return case_id


def get_case(case_id: str) -> Optional[dict]:
    conn = get_connection()
    row = conn.execute(
        "SELECT * FROM cases WHERE case_id = ?", (case_id,)
    ).fetchone()
    conn.close()
    if row is None:
        return None
    return dict(row)


def update_recommendation_id(case_id: str, recommendation_id: str) -> None:
    conn = get_connection()
    with conn:
        conn.execute(
            "UPDATE cases SET latest_recommendation_id = ? WHERE case_id = ?",
            (recommendation_id, case_id),
        )
    conn.close()
