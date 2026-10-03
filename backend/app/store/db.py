"""
PostgreSQL database initialisation and connection helper.
"""
from __future__ import annotations

import psycopg2
from psycopg2.extras import RealDictCursor

from app.core.config import get_settings

_SCHEMA = """
CREATE TABLE IF NOT EXISTS cases (
    case_id TEXT PRIMARY KEY,
    client_name TEXT NOT NULL,
    profile_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    latest_recommendation_id TEXT,
    owner_user_id TEXT
);

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

CREATE TABLE IF NOT EXISTS rm_registration_audit (
    id SERIAL PRIMARY KEY,
    rm_id TEXT NOT NULL,
    institution TEXT NOT NULL,
    access_tier TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

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
    id SERIAL PRIMARY KEY,
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

class PostgresConnection:
    def __init__(self, dsn):
        self._conn = psycopg2.connect(dsn, cursor_factory=RealDictCursor)

    def execute(self, sql, params=None):
        cur = self._conn.cursor()
        cur.execute(sql, params)
        return cur

    def commit(self):
        self._conn.commit()

    def close(self):
        self._conn.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_type is None:
            self._conn.commit()
        else:
            self._conn.rollback()


def get_connection() -> PostgresConnection:
    settings = get_settings()
    if not settings.database_url:
        raise RuntimeError("DATABASE_URL is not set")
    return PostgresConnection(settings.database_url)


def init_db() -> None:
    conn = get_connection()
    with conn:
        conn.execute(_SCHEMA)
    # Commit table creations before attempting migrations
    conn.commit()
    
    with conn:
        try:
            conn.execute("ALTER TABLE relationship_managers ADD COLUMN password_hash TEXT")
        except Exception:
            conn._conn.rollback()
            
    with conn:
        try:
            conn.execute("ALTER TABLE cases ADD COLUMN owner_user_id TEXT")
        except Exception:
            conn._conn.rollback()
    
    conn.close()
