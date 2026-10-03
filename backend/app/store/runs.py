"""
Run persistence (save, load full run JSON).
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Optional

from app.store.db import get_connection


def generate_run_id() -> str:
    return str(uuid.uuid4()).replace("-", "")[:16].upper()


def save_run(
    run_id: str,
    case_id: Optional[str],
    product_json: dict,
    metrics_json: dict,
    suitability_json: Optional[dict],
    explanation_json: Optional[dict],
    data_source: str,
    as_of: str,
    snapshot_id: str,
) -> None:
    conn = get_connection()
    now = datetime.now(timezone.utc).isoformat()
    with conn:
        conn.execute(
            """INSERT OR REPLACE INTO runs
            (run_id, case_id, product_json, metrics_json, suitability_json,
             explanation_json, data_source, as_of, snapshot_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                run_id,
                case_id,
                json.dumps(product_json),
                json.dumps(metrics_json),
                json.dumps(suitability_json) if suitability_json else None,
                json.dumps(explanation_json) if explanation_json else None,
                data_source,
                as_of,
                snapshot_id,
                now,
            ),
        )
    conn.close()


def load_run(run_id: str) -> Optional[dict]:
    conn = get_connection()
    row = conn.execute("SELECT * FROM runs WHERE run_id = ?", (run_id,)).fetchone()
    conn.close()
    if row is None:
        return None
    d = dict(row)
    # Parse JSON fields
    for field in ("product_json", "metrics_json", "suitability_json", "explanation_json"):
        if d.get(field):
            d[field] = json.loads(d[field])
    return d
