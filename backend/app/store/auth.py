"""
Authentication persistence helpers.

Uses hashlib PBKDF2-HMAC-SHA256 (no extra deps) for password hashing.
Session tokens are opaque UUID4 strings stored in memory (simple map).
For production, replace the in-memory store with Redis or a sessions table.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from app.store.db import get_connection

# ── Password hashing ───────────────────────────────────────────────────────────

_ITERATIONS = 260_000  # OWASP 2023 recommendation for PBKDF2-HMAC-SHA256


def _hash_password(password: str, salt: Optional[str] = None) -> str:
    """Return 'salt$hash' string. salt is hex-encoded 16-byte random."""
    if salt is None:
        salt = os.urandom(16).hex()
    key = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        _ITERATIONS,
    )
    return f"{salt}${key.hex()}"


def _verify_password(password: str, stored: str) -> bool:
    try:
        salt, _ = stored.split("$", 1)
    except ValueError:
        return False
    expected = _hash_password(password, salt)
    return hmac.compare_digest(expected, stored)


# ── In-memory session store ────────────────────────────────────────────────────
# Maps token -> {"rm_id" | "case_id": ..., "role": "rm" | "client", ...}

_SESSIONS: Dict[str, Dict[str, Any]] = {}


def create_session(payload: Dict[str, Any]) -> str:
    token = uuid.uuid4().hex
    _SESSIONS[token] = payload
    return token


def get_session(token: str) -> Optional[Dict[str, Any]]:
    return _SESSIONS.get(token)


def destroy_session(token: str) -> None:
    _SESSIONS.pop(token, None)


# ── RM Authentication ──────────────────────────────────────────────────────────

def set_rm_password(rm_id: str, password: str) -> None:
    """Hash and store a password for an RM (called during registration)."""
    conn = get_connection()
    pw_hash = _hash_password(password)
    with conn:
        conn.execute(
            "UPDATE relationship_managers SET password_hash = %s WHERE rm_id = %s",
            (pw_hash, rm_id),
        )
    conn.close()


def rm_login(corporate_email: str, employee_id: str) -> Optional[Dict[str, Any]]:
    """
    Authenticate an RM by corporate_email + employee_id.
    Returns the RM record if found, else None.
    No password required for RM (employee_id is the credential as per user choice).
    """
    conn = get_connection()
    row = conn.execute(
        """SELECT * FROM relationship_managers
           WHERE LOWER(corporate_email) = LOWER(%s) AND LOWER(employee_id) = LOWER(%s)""",
        (corporate_email.strip(), employee_id.strip()),
    ).fetchone()
    conn.close()
    if row is None:
        return None
    import json
    record = dict(row)
    record["authorised_product_types"] = json.loads(
        record.pop("authorised_product_types_json", None) or "[]"
    )
    return record


# ── Client Account ─────────────────────────────────────────────────────────────

def _gen_account_id() -> str:
    return f"ACC{uuid.uuid4().hex[:10].upper()}"


def create_client_account(
    case_id: str,
    client_name: str,
    email: str,
    password: str,
) -> str:
    """Create a client portal account. Returns account_id."""
    conn = get_connection()
    account_id = _gen_account_id()
    pw_hash = _hash_password(password)
    now = datetime.now(timezone.utc).isoformat()
    with conn:
        conn.execute(
            """INSERT INTO client_accounts
               (account_id, case_id, client_name, email, password_hash, created_at)
               VALUES (%s, %s, %s, %s, %s, %s)""",
            (account_id, case_id, client_name, email.strip().lower(), pw_hash, now),
        )
    conn.close()
    return account_id


def get_client_account_by_email(email: str) -> Optional[Dict[str, Any]]:
    conn = get_connection()
    row = conn.execute(
        "SELECT * FROM client_accounts WHERE LOWER(email) = LOWER(%s)",
        (email.strip(),),
    ).fetchone()
    conn.close()
    return dict(row) if row else None


def client_login(email: str, password: str) -> Optional[Dict[str, Any]]:
    """
    Authenticate a client by email + password.
    Returns client account record merged with case profile if valid, else None.
    """
    account = get_client_account_by_email(email)
    if account is None:
        return None
    if not _verify_password(password, account["password_hash"]):
        return None
    return account
