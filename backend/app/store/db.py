"""
PostgreSQL database initialisation and connection helper.
"""
from __future__ import annotations

import psycopg2
from psycopg2.pool import ThreadedConnectionPool
from psycopg2.extras import RealDictCursor

from app.core.config import get_settings

_SCHEMA = """
CREATE TABLE IF NOT EXISTS cases (
    case_id TEXT PRIMARY KEY,
    client_name TEXT NOT NULL,
    profile_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    latest_recommendation_id TEXT,
    owner_user_id TEXT,
    product_config_json TEXT
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
    created_at TEXT NOT NULL
);

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

_pool: ThreadedConnectionPool | None = None


def _get_pool(dsn: str) -> ThreadedConnectionPool:
    global _pool
    if _pool is None:
        _pool = ThreadedConnectionPool(1, 20, dsn, cursor_factory=RealDictCursor)
    return _pool


class PostgresConnection:
    """Borrows a pooled connection; close() returns it (a new TLS+auth handshake costs ~0.6s)."""

    def __init__(self, dsn):
        self._pool = _get_pool(dsn)
        self._conn = self._pool.getconn()
        if self._conn.closed:
            self._pool.putconn(self._conn, close=True)
            self._conn = self._pool.getconn()

    def execute(self, sql, params=None):
        cur = self._conn.cursor()
        cur.execute(sql, params)
        return cur

    def commit(self):
        self._conn.commit()

    def close(self):
        if self._conn is None:
            return
        conn, self._conn = self._conn, None
        try:
            if not conn.closed:
                conn.rollback()  # never hand back a connection with an open transaction
        except Exception:
            self._pool.putconn(conn, close=True)
            return
        self._pool.putconn(conn)

    def __del__(self):
        try:
            self.close()
        except Exception:
            pass

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


_db_initialised = False


def init_db() -> None:
    # Schema + migrations only need to run once per process; callers invoke this per request.
    global _db_initialised
    if _db_initialised:
        return
    _init_db()
    _db_initialised = True


_MIGRATIONS = (
    "ALTER TABLE cases ADD COLUMN IF NOT EXISTS owner_user_id TEXT",
    "ALTER TABLE cases ADD COLUMN IF NOT EXISTS product_config_json TEXT",
    # Earlier seeds copied each client's login credentials into the case record;
    # authentication lives in Supabase, so strip them.
    """UPDATE cases SET profile_json = (profile_json::jsonb - 'credentials')::text
       WHERE profile_json::jsonb ? 'credentials'""",
)


def _init_db() -> None:
    conn = get_connection()
    try:
        with conn:
            conn.execute(_SCHEMA)
            for statement in _MIGRATIONS:
                conn.execute(statement)
    finally:
        conn.close()
