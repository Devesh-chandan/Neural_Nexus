"""Auth middleware, /api/cases access control, audit hash chain and Supabase token verification."""
from __future__ import annotations

import json

import httpx
import pytest
from fastapi.testclient import TestClient

import app.main as main
from app.core.errors import AppError

USERS = {
    "rm-token": {"id": "u-rm", "user_type": "rm", "rm_id": "RM1"},
    "alice-token": {"id": "u-alice", "user_type": "client"},
    "bob-token": {"id": "u-bob", "user_type": "client"},
}
CASES = {
    "ALICE001": {"case_id": "ALICE001", "client_name": "Alice", "owner_user_id": "u-alice",
                 "profile_json": json.dumps({"client_name": "Alice"}), "created_at": "2026-01-01"},
    "BOB00001": {"case_id": "BOB00001", "client_name": "Bob", "owner_user_id": "u-bob",
                 "profile_json": json.dumps({"client_name": "Bob"}), "created_at": "2026-01-01"},
}


@pytest.fixture
def api(monkeypatch):
    from app.api import routes_cases

    def verify(token):
        if token not in USERS:
            raise AppError(401, "UNAUTHORIZED", "Your session is invalid or expired.")
        return USERS[token]

    monkeypatch.setattr(main, "verify_access_token", verify)
    monkeypatch.setattr(routes_cases, "init_db", lambda: None)
    monkeypatch.setattr(routes_cases, "get_case", lambda cid: CASES.get(cid))
    monkeypatch.setattr(routes_cases, "list_cases",
                        lambda owner=None: [c for c in CASES.values() if owner in (None, c["owner_user_id"])])
    return TestClient(main.app)


def auth(token):
    return {"Authorization": f"Bearer {token}"}


class TestAuthMiddleware:
    def test_protected_route_requires_bearer_token(self, api):
        r = api.get("/api/cases")
        assert r.status_code == 401 and r.json()["error"]["code"] == "UNAUTHORIZED"

    def test_invalid_token_is_rejected(self, api):
        assert api.get("/api/cases", headers=auth("forged")).status_code == 401

    def test_non_bearer_scheme_is_rejected(self, api):
        assert api.get("/api/cases", headers={"Authorization": "Basic abc"}).status_code == 401

    def test_public_routes_need_no_token(self, api):
        assert api.get("/api/underlyings").status_code == 200
        assert api.get("/health").status_code == 200

    def test_client_cannot_use_rm_only_routes(self, api):
        assert api.get("/api/audit/verify-chain", headers=auth("alice-token")).status_code == 403
        assert api.get("/api/registration/rms", headers=auth("alice-token")).status_code == 403

    def test_rm_cannot_open_another_rms_account(self, api):
        r = api.get("/api/registration/rm/RM999", headers=auth("rm-token"))
        assert r.status_code == 403


class TestCasesAccess:
    def test_client_lists_only_own_cases(self, api):
        body = api.get("/api/cases", headers=auth("alice-token")).json()
        assert [c["case_id"] for c in body["cases"]] == ["ALICE001"]

    def test_rm_lists_all_cases(self, api):
        assert api.get("/api/cases", headers=auth("rm-token")).json()["count"] == 2

    def test_client_cannot_read_someone_elses_case(self, api):
        r = api.get("/api/cases/BOB00001", headers=auth("alice-token"))
        assert r.status_code == 404  # existence is not revealed

    def test_client_reads_own_case_and_rm_reads_any(self, api):
        assert api.get("/api/cases/ALICE001", headers=auth("alice-token")).status_code == 200
        assert api.get("/api/cases/BOB00001", headers=auth("rm-token")).status_code == 200

    def test_unknown_case_is_404(self, api):
        assert api.get("/api/cases/NOPE0000", headers=auth("rm-token")).status_code == 404

    def test_client_cannot_finalise_product_config(self, api):
        r = api.put("/api/cases/ALICE001/product-config", headers=auth("alice-token"),
                    json={"product_config": {}, "run_id": "x"})
        assert r.status_code == 403


class FakeAuditDb:
    """Minimal stand-in for the Postgres connection used by app.store.audit."""

    def __init__(self):
        self.rows = []
        self._result = []

    def execute(self, sql, params=()):
        self._result = []
        if sql.strip().startswith("INSERT INTO audit_log"):
            cols = ("run_id", "created_at", "payload_json", "payload_hash", "prev_hash", "record_hash",
                    "model", "prompt_version", "rules_version", "snapshot_id", "verdict", "data_source")
            self.rows.append({"id": len(self.rows) + 1, **dict(zip(cols, params))})
        elif "ORDER BY id DESC LIMIT 1" in sql and "record_hash" in sql:
            self._result = [self.rows[-1]] if self.rows else []
        elif "ORDER BY id ASC" in sql:
            self._result = list(self.rows)
        return self

    def fetchone(self):
        return self._result[0] if self._result else None

    def fetchall(self):
        return self._result

    def close(self):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class TestAuditChain:
    @pytest.fixture
    def db(self, monkeypatch):
        from app.store import audit
        fake = FakeAuditDb()
        monkeypatch.setattr(audit, "get_connection", lambda: fake)
        return fake

    def _append(self, n):
        from app.store.audit import append_audit
        for i in range(n):
            append_audit(f"run{i}", {"i": i, "verdict": "OK"}, "SUITABLE", "seed", f"snap{i}", None, "v1")

    def test_empty_chain_verifies(self, db):
        from app.store.audit import verify_chain
        assert verify_chain()["ok"] is True

    def test_chain_links_and_verifies(self, db):
        from app.store.audit import GENESIS_HASH, verify_chain
        self._append(3)
        assert db.rows[0]["prev_hash"] == GENESIS_HASH
        assert db.rows[1]["prev_hash"] == db.rows[0]["record_hash"]
        res = verify_chain()
        assert res["ok"] and res["total_records"] == 3

    def test_payload_tampering_is_detected(self, db):
        from app.store.audit import verify_chain
        self._append(3)
        db.rows[1]["payload_json"] = db.rows[1]["payload_json"].replace('"i":1', '"i":99')
        res = verify_chain()
        assert res["ok"] is False and res["first_broken_record_id"] == 2

    def test_deleting_a_record_is_detected(self, db):
        from app.store.audit import verify_chain
        self._append(3)
        del db.rows[1]
        assert verify_chain()["ok"] is False


class TestSupabaseTokenVerification:
    @pytest.fixture(autouse=True)
    def configured(self, monkeypatch):
        from app.core import supabase
        s = supabase.get_settings()
        monkeypatch.setattr(s, "supabase_url", "https://x.supabase.test")
        monkeypatch.setattr(s, "supabase_anon_key", "anon")
        supabase._token_cache.clear()

    def _client(self, monkeypatch, user_status=200, profiles=None, user_id="u1"):
        from app.core import supabase

        def handler(request: httpx.Request):
            if request.url.path.endswith("/auth/v1/user"):
                return httpx.Response(user_status, json={"id": user_id, "email": "a@b.com"})
            return httpx.Response(200, json=profiles if profiles is not None else [])

        monkeypatch.setattr(supabase, "_http", httpx.Client(transport=httpx.MockTransport(handler)))
        return supabase

    def test_valid_token_returns_profile_with_email(self, monkeypatch):
        sb = self._client(monkeypatch, profiles=[{"id": "u1", "user_type": "rm"}])
        profile = sb.verify_access_token("opaque-token")
        assert profile["user_type"] == "rm" and profile["email"] == "a@b.com"

    def test_rejected_token_is_401(self, monkeypatch):
        sb = self._client(monkeypatch, user_status=401)
        with pytest.raises(AppError) as e:
            sb.verify_access_token("bad")
        assert e.value.status == 401

    def test_missing_profile_is_403(self, monkeypatch):
        sb = self._client(monkeypatch, profiles=[])
        with pytest.raises(AppError) as e:
            sb.verify_access_token("t")
        assert e.value.code == "PROFILE_REQUIRED"

    def test_unknown_role_is_403(self, monkeypatch):
        sb = self._client(monkeypatch, profiles=[{"id": "u1", "user_type": "admin"}])
        with pytest.raises(AppError) as e:
            sb.verify_access_token("t")
        assert e.value.code == "INVALID_ROLE"

    def test_provider_outage_is_503(self, monkeypatch):
        from app.core import supabase

        def boom(request):
            raise httpx.ConnectError("down")

        monkeypatch.setattr(supabase, "_http", httpx.Client(transport=httpx.MockTransport(boom)))
        with pytest.raises(AppError) as e:
            supabase.verify_access_token("t")
        assert e.value.status == 503

    def test_successful_verification_is_cached(self, monkeypatch):
        sb = self._client(monkeypatch, profiles=[{"id": "u1", "user_type": "client"}])
        first = sb.verify_access_token("same")
        monkeypatch.setattr(sb, "_http", httpx.Client(transport=httpx.MockTransport(
            lambda r: httpx.Response(500))))
        assert sb.verify_access_token("same") is first
