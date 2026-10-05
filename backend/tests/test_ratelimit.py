"""Rate limiter: sliding window, per-key isolation, global IP ceiling, HTTP 429 contract."""
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.requests import Request

from app.core.ratelimit import RateLimiter, Rule, client_ip, default_rules


class FakeClock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def make(limit=3, global_limit=100):
    clock = FakeClock()
    rule = Rule("analysis", limit, 60, lambda m, p: m == "POST" and p == "/api/analyze")
    return RateLimiter([rule], global_limit=global_limit, clock=clock), clock


def test_blocks_after_limit_and_reports_retry_after():
    lim, clock = make(limit=3)
    for _ in range(3):
        assert lim.check("POST", "/api/analyze", "1.1.1.1", "tok") is None
    rule, wait = lim.check("POST", "/api/analyze", "1.1.1.1", "tok")
    assert rule == "analysis" and 0 < wait <= 60


def test_window_slides_and_allows_again():
    lim, clock = make(limit=2)
    assert lim.check("POST", "/api/analyze", "ip", "t") is None
    assert lim.check("POST", "/api/analyze", "ip", "t") is None
    assert lim.check("POST", "/api/analyze", "ip", "t") is not None
    clock.t += 61
    assert lim.check("POST", "/api/analyze", "ip", "t") is None


def test_keys_are_isolated_per_token_and_unmatched_routes_unlimited():
    lim, _ = make(limit=1)
    assert lim.check("POST", "/api/analyze", "ip", "alice") is None
    assert lim.check("POST", "/api/analyze", "ip", "bob") is None
    assert lim.check("POST", "/api/analyze", "ip", "alice") is not None
    for _ in range(10):
        assert lim.check("GET", "/api/cases", "ip", "alice") is None


def test_global_ip_ceiling_defeats_rotating_tokens():
    lim, _ = make(limit=1000, global_limit=5)
    results = [lim.check("POST", "/api/analyze", "9.9.9.9", f"fake-{i}") for i in range(7)]
    assert results[:5] == [None] * 5 and results[5][0] == "global"


def test_default_rules_cover_expensive_and_public_routes():
    names = {r.name for r in default_rules()}
    assert names == {"public_onboarding", "analysis", "market_data"}
    rules = {r.name: r for r in default_rules()}
    assert rules["public_onboarding"].matches("POST", "/api/registration/rm")
    assert rules["analysis"].matches("POST", "/api/assess")
    assert not rules["analysis"].matches("GET", "/api/assess")
    assert rules["market_data"].matches("GET", "/api/market/history")


def test_scale_multiplies_limits():
    assert {r.name: r.limit for r in default_rules(2.0)}["analysis"] == 40


def test_client_ip_only_trusts_forwarded_header_when_configured():
    scope = {"type": "http", "headers": [(b"x-forwarded-for", b"5.5.5.5, 10.0.0.1")], "client": ("1.2.3.4", 1)}
    req = Request(scope)
    assert client_ip(req, trust_proxy=False) == "1.2.3.4"
    assert client_ip(req, trust_proxy=True) == "5.5.5.5"


def test_http_429_contract_via_real_app(monkeypatch):
    import app.main as main
    monkeypatch.setattr(main.settings, "rate_limit_enabled", True)
    monkeypatch.setattr(main, "_limiter", RateLimiter(
        [Rule("public_onboarding", 2, 60, lambda m, p: m == "POST" and p.startswith("/api/registration/"))]))
    client = TestClient(main.app)
    codes = [client.post("/api/registration/validate/email", json={"email": "a@b.com"}).status_code for _ in range(4)]
    assert 429 in codes and codes.index(429) == 2
    r = client.post("/api/registration/validate/email", json={"email": "a@b.com"})
    assert r.status_code == 429 and r.headers["Retry-After"].isdigit()
    assert r.json()["error"]["code"] == "RATE_LIMITED"
