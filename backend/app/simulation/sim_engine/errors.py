"""Errors the engine can raise. Each has a stable code for the API and Module 5."""

from __future__ import annotations

from typing import Any, Dict, List, Optional


class SimulationError(Exception):
    """A clean, user-facing failure (never a raw stack trace)."""

    def __init__(self, code: str, message: str, status: int = 422,
                 details: Optional[List[Dict[str, Any]]] = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.details = details or []

    def to_dict(self) -> Dict[str, Any]:
        out: Dict[str, Any] = {"code": self.code, "message": self.message}
        if self.details:
            out["details"] = self.details
        return out


class InvalidProduct(SimulationError):
    def __init__(self, details: List[Dict[str, Any]]):
        fields = ", ".join(d["field"] for d in details)
        super().__init__("INVALID_PRODUCT", f"Product input is invalid ({fields}).",
                         status=422, details=details)


class UnsupportedUnderlying(SimulationError):
    def __init__(self, message: str):
        super().__init__("UNSUPPORTED_UNDERLYING", message, status=422)


class MarketDataUnavailable(SimulationError):
    def __init__(self, message: str):
        super().__init__("MARKET_DATA_UNAVAILABLE", message, status=503)


class NotEnoughHistory(SimulationError):
    def __init__(self, message: str):
        super().__init__("NOT_ENOUGH_HISTORY", message, status=422)
