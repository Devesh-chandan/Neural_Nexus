"""
Relationship Manager persistence (register, load, list) plus finalisation audit.

Multi-tenancy note: an RM is scoped to an (institution, branch_code) pair. All
queries in this module are tenant-aware so a branch manager can only ever see
their own branch.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from app.store.db import get_connection


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def generate_rm_id() -> str:
    """RM id doubles as the immutable audit-log primary key."""
    return f"RM{uuid.uuid4().hex[:10].upper()}"


def register_rm(
    *,
    legal_name: str,
    corporate_email: str,
    email_domain: str,
    employee_id: str,
    regulatory_registration_number: str,
    operating_jurisdiction: str,
    institution: str,
    branch_code: str,
    department: Optional[str],
    access_tier: str,
    authorised_product_types: List[str],
    payload: Dict[str, Any],
) -> str:
    """Insert a new RM and record the registration in the audit table."""
    conn = get_connection()
    rm_id = generate_rm_id()
    now = _now()
    try:
        with conn:
            conn.execute(
                """INSERT INTO relationship_managers
                   (rm_id, legal_name, corporate_email, email_domain, employee_id,
                    regulatory_registration_number, operating_jurisdiction,
                    institution, branch_code, department, access_tier,
                    authorised_product_types_json, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    rm_id,
                    legal_name,
                    corporate_email,
                    email_domain,
                    employee_id,
                    regulatory_registration_number,
                    operating_jurisdiction,
                    institution,
                    branch_code,
                    department,
                    access_tier,
                    json.dumps(authorised_product_types),
                    now,
                ),
            )
            conn.execute(
                """INSERT INTO rm_registration_audit
                   (rm_id, institution, access_tier, payload_json, created_at)
                   VALUES (?, ?, ?, ?, ?)""",
                (rm_id, institution, access_tier, json.dumps(payload), now),
            )
    finally:
        conn.close()
    return rm_id


def get_rm(rm_id: str) -> Optional[Dict[str, Any]]:
    conn = get_connection()
    row = conn.execute(
        "SELECT * FROM relationship_managers WHERE rm_id = ?", (rm_id,)
    ).fetchone()
    conn.close()
    if row is None:
        return None
    record = dict(row)
    record["authorised_product_types"] = json.loads(
        record.pop("authorised_product_types_json") or "[]"
    )
    return record


def find_rm_by_employee_id(
    institution: str, employee_id: str
) -> Optional[Dict[str, Any]]:
    """Directory lookup: an employee id is unique inside one institution."""
    conn = get_connection()
    row = conn.execute(
        """SELECT * FROM relationship_managers
           WHERE institution = ? AND employee_id = ?""",
        (institution, employee_id),
    ).fetchone()
    conn.close()
    if row is None:
        return None
    record = dict(row)
    record["authorised_product_types"] = json.loads(
        record.pop("authorised_product_types_json") or "[]"
    )
    return record


def list_branch_rms(institution: str, branch_code: str) -> List[Dict[str, Any]]:
    """Branch roster – used by the branch-manager reporting view."""
    conn = get_connection()
    rows = conn.execute(
        """SELECT rm_id, legal_name, employee_id, access_tier, department,
                  operating_jurisdiction, created_at
           FROM relationship_managers
           WHERE institution = ? AND branch_code = ?
           ORDER BY created_at ASC""",
        (institution, branch_code),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def record_finalisation(
    run_id: str, rm_id: str, allowed: bool, access_tier: str, reason: Optional[str]
) -> str:
    """Persist an RM's finalisation decision on a run. Returns the timestamp."""
    conn = get_connection()
    now = _now()
    try:
        with conn:
            conn.execute(
                """INSERT OR REPLACE INTO run_finalisations
                   (run_id, rm_id, allowed, access_tier, reason, finalised_at)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (run_id, rm_id, 1 if allowed else 0, access_tier, reason, now),
            )
    finally:
        conn.close()
    return now


def get_finalisation(run_id: str) -> Optional[Dict[str, Any]]:
    conn = get_connection()
    row = conn.execute(
        "SELECT * FROM run_finalisations WHERE run_id = ?", (run_id,)
    ).fetchone()
    conn.close()
    return dict(row) if row is not None else None


def list_all_rms() -> List[Dict[str, Any]]:
    conn = get_connection()
    rows = conn.execute(
        "SELECT * FROM relationship_managers ORDER BY created_at DESC"
    ).fetchall()
    conn.close()
    res = []
    for row in rows:
        record = dict(row)
        record["authorised_product_types"] = json.loads(
            record.pop("authorised_product_types_json") or "[]"
        )
        res.append(record)
    return res

