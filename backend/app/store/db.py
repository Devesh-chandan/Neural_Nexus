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
    conn.close()
