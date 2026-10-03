"""
Product registry – maps product_type string to PayoffEngine instance.
"""
from __future__ import annotations

from app.payoff.base import PayoffEngine
from app.payoff.cpn import CPNPayoff
from app.payoff.dcd import DCDPayoff
from app.payoff.eln import ELNPayoff

_REGISTRY: dict[str, PayoffEngine] = {
    "ELN": ELNPayoff(),
    "CPN": CPNPayoff(),
    "DCD": DCDPayoff(),
}


def get_engine(product_type: str) -> PayoffEngine:
    engine = _REGISTRY.get(product_type.upper())
    if engine is None:
        raise ValueError(f"Unknown product type: {product_type}")
    return engine
