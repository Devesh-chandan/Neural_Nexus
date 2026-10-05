"""In-process sliding-window rate limiting.

Protects the expensive routes (market downloads, historical replays, LLM calls) and the public
onboarding endpoints from floods. Every request is checked twice:

* a per-client-IP ceiling across the whole API, so rotating fake bearer tokens cannot evade it;
* a per-route-class limit keyed by the bearer token (or the IP when unauthenticated).

State is per process. With several workers each enforces its own window (limits are then
per-worker); use a shared store such as Redis for a hard cluster-wide limit.
"""
from __future__ import annotations

import hashlib
import threading
import time
from collections import deque
from dataclasses import dataclass
from typing import Callable, Deque, Dict, List, Optional, Tuple

from starlette.requests import Request


@dataclass(frozen=True)
class Rule:
    name: str
    limit: int
    window_seconds: float
    matches: Callable[[str, str], bool]  # (method, path) -> bool


def _starts(prefix: str, *methods: str) -> Callable[[str, str], bool]:
    return lambda method, path: path.startswith(prefix) and (not methods or method in methods)


def default_rules(scale: float = 1.0) -> List[Rule]:
    def n(v: int) -> int:
        return max(1, int(v * scale))

    return [
        # Unauthenticated onboarding / identity probes: slowest, they are free to call.
        Rule("public_onboarding", n(10), 60, lambda m, p: m == "POST" and (
            p.startswith("/api/registration/") or p.startswith("/api/kyc/"))),
        # Each of these downloads market data, replays history or calls the LLM.
        Rule("analysis", n(20), 60, lambda m, p: m == "POST" and p in (
            "/api/analyze", "/api/simulate", "/api/assess", "/api/recommend", "/api/fixit",
            "/api/explain", "/api/suitability")),
        Rule("market_data", n(60), 60, _starts("/api/market/", "GET")),
    ]


class RateLimiter:
    def __init__(self, rules: Optional[List[Rule]] = None, global_limit: int = 300,
                 global_window: float = 60.0, clock: Callable[[], float] = time.monotonic) -> None:
        self.rules = rules if rules is not None else default_rules()
        self.global_limit = global_limit
        self.global_window = global_window
        self._clock = clock
        self._hits: Dict[Tuple[str, str], Deque[float]] = {}
        self._lock = threading.Lock()
        self._last_prune = clock()

    def _take(self, key: Tuple[str, str], limit: int, window: float, now: float) -> Optional[float]:
        """Record a hit; return seconds to wait if the limit is exceeded, else None."""
        q = self._hits.setdefault(key, deque())
        while q and q[0] <= now - window:
            q.popleft()
        if len(q) >= limit:
            return max(0.0, q[0] + window - now)
        q.append(now)
        return None

    def _prune(self, now: float) -> None:
        if now - self._last_prune < 300:
            return
        self._last_prune = now
        horizon = max([self.global_window] + [r.window_seconds for r in self.rules])
        for key in [k for k, q in self._hits.items() if not q or q[-1] <= now - horizon]:
            del self._hits[key]

    def check(self, method: str, path: str, ip: str, token: Optional[str]) -> Optional[Tuple[str, float]]:
        """Return (rule_name, retry_after_seconds) when the request must be rejected, else None."""
        now = self._clock()
        with self._lock:
            self._prune(now)
            wait = self._take(("global", ip), self.global_limit, self.global_window, now)
            if wait is not None:
                return "global", wait
            for rule in self.rules:
                if rule.matches(method, path):
                    who = hashlib.sha256(token.encode()).hexdigest()[:16] if token else ip
                    wait = self._take((rule.name, who), rule.limit, rule.window_seconds, now)
                    if wait is not None:
                        return rule.name, wait
                    break
        return None


def client_ip(request: Request, trust_proxy: bool) -> str:
    if trust_proxy:
        forwarded = request.headers.get("x-forwarded-for", "")
        if forwarded:
            return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"
