"""
Append-only audit hash chain (Section 11).
Tamper-evident in the prototype; not tamper-proof.

record_hash = sha256(prev_hash + payload_hash)
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from app.store.db import get_connection

GENESIS_HASH = "0" * 64
RULES_VERSION = "suitability_rules.yaml@v1"


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _canonical_json(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str)


def append_audit(
    run_id: str,
    payload: Dict[str, Any],
    verdict: Optional[str],
    data_source: str,
    snapshot_id: str,
    model: Optional[str],
    prompt_version: str,
) -> None:
    """Append one immutable audit record to the chain."""
    conn = get_connection()
    now = datetime.now(timezone.utc).isoformat()

    # Get last record_hash for prev_hash
    last = conn.execute(
        "SELECT record_hash FROM audit_log ORDER BY id DESC LIMIT 1"
    ).fetchone()
    prev_hash = last["record_hash"] if last else GENESIS_HASH

    payload_hash = _sha256(_canonical_json(payload))
    record_hash = _sha256(prev_hash + payload_hash)

    with conn:
        conn.execute(
            """INSERT INTO audit_log
            (run_id, created_at, payload_json, payload_hash, prev_hash, record_hash,
             model, prompt_version, rules_version, snapshot_id, verdict, data_source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                run_id,
                now,
                _canonical_json(payload),
                payload_hash,
                prev_hash,
                record_hash,
                model,
                prompt_version,
                RULES_VERSION,
                snapshot_id,
                verdict,
                data_source,
            ),
        )
    conn.close()


def get_audit_record(run_id: str) -> Optional[Dict[str, Any]]:
    conn = get_connection()
    row = conn.execute(
        "SELECT * FROM audit_log WHERE run_id = ? ORDER BY id DESC LIMIT 1",
        (run_id,),
    ).fetchone()
    conn.close()
    return dict(row) if row else None


def verify_chain() -> Dict[str, Any]:
    """Verify the full hash chain. Returns first broken record if any."""
    conn = get_connection()
    rows = conn.execute(
        "SELECT * FROM audit_log ORDER BY id ASC"
    ).fetchall()
    conn.close()

    prev_hash = GENESIS_HASH
    for row in rows:
        d = dict(row)
        expected_record_hash = _sha256(d["prev_hash"] + d["payload_hash"])
        payload_check = _sha256(d["payload_json"]) == d["payload_hash"]
        chain_check = d["prev_hash"] == prev_hash and d["record_hash"] == expected_record_hash

        if not payload_check or not chain_check:
            return {
                "ok": False,
                "total_records": len(rows),
                "first_broken_record_id": d["id"],
                "detail": "Hash mismatch detected at record id=" + str(d["id"]),
            }
        prev_hash = d["record_hash"]

    return {
        "ok": True,
        "total_records": len(rows),
        "first_broken_record_id": None,
        "detail": "All records verified.",
    }
