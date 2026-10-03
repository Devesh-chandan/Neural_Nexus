"""
SQLite database initialisation and connection helper.
Uses CREATE TABLE IF NOT EXISTS for simple migrations.
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

from app.core.config import get_settings

_SCHEMA = """
CREATE TABLE IF NOT EXISTS cases (
    case_id TEXT PRIMARY KEY,
    client_name TEXT NOT NULL,
    profile_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    latest_recommendation_id TEXT
);

-- One row per Relationship Manager onboarding onto the platform.
-- Institution + branch_code scope the RM to one tenant.
CREATE TABLE IF NOT EXISTS relationship_managers (
    rm_id TEXT PRIMARY KEY,
    legal_name TEXT NOT NULL,
    corporate_email TEXT NOT NULL,
    email_domain TEXT NOT NULL,
    employee_id TEXT NOT NULL,
    regulatory_registration_number TEXT NOT NULL,
    operating_jurisdiction TEXT NOT NULL,
    institution TEXT NOT NULL,
    branch_code TEXT NOT NULL,
    department TEXT,
    access_tier TEXT NOT NULL,
    authorised_product_types_json TEXT NOT NULL,
    password_hash TEXT,
    created_at TEXT NOT NULL
);

-- Client portal accounts: one row per registered client (linked to cases)
CREATE TABLE IF NOT EXISTS client_accounts (
    account_id TEXT PRIMARY KEY,
    case_id TEXT NOT NULL,
    client_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (case_id) REFERENCES cases (case_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_client_accounts_email ON client_accounts (email);

CREATE INDEX IF NOT EXISTS idx_rm_tenant
    ON relationship_managers (institution, branch_code);

-- Audit of RM registrations, so an account cannot be silently created.
CREATE TABLE IF NOT EXISTS rm_registration_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rm_id TEXT NOT NULL,
    institution TEXT NOT NULL,
    access_tier TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- Explicit finalisation decisions taken by an RM on a run (RBAC enforcement).
CREATE TABLE IF NOT EXISTS run_finalisations (
    run_id TEXT NOT NULL,
    rm_id TEXT NOT NULL,
    allowed INTEGER NOT NULL,
    access_tier TEXT NOT NULL,
    reason TEXT,
    finalised_at TEXT NOT NULL,
    PRIMARY KEY (run_id)
);

CREATE TABLE IF NOT EXISTS runs (
    run_id TEXT PRIMARY KEY,
    case_id TEXT,
    product_json TEXT NOT NULL,
    metrics_json TEXT NOT NULL,
    suitability_json TEXT,
    explanation_json TEXT,
    data_source TEXT,
    as_of TEXT,
    snapshot_id TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    prev_hash TEXT NOT NULL,
    record_hash TEXT NOT NULL,
    model TEXT,
    prompt_version TEXT NOT NULL,
    rules_version TEXT NOT NULL,
    snapshot_id TEXT NOT NULL,
    verdict TEXT,
    data_source TEXT NOT NULL
);
"""


def _db_path() -> Path:
    settings = get_settings()
    p = Path(settings.db_path)
    if not p.is_absolute():
        p = Path(__file__).resolve().parent.parent.parent / settings.db_path
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(str(_db_path()), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    conn = get_connection()
    with conn:
        conn.executescript(_SCHEMA)
        # Live migrations: add columns that may not exist in older DBs
        try:
            conn.execute(
                "ALTER TABLE relationship_managers ADD COLUMN password_hash TEXT"
            )
        except Exception:
            pass  # Column already exists
    conn.close()
