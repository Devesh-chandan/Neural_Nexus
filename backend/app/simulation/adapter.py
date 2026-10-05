"""Translate the backend's product config objects into sim_engine's input shape.

The replay engine (app.simulation.sim_engine) has its own, slightly different, field names and
assumptions than the backend's own `app.schemas.product` configs. This module is the single
place that bridges the two so the mapping is explicit and auditable in one spot.
"""
from __future__ import annotations

from typing import Any, Dict, Union

from app.core.config import get_underlyings
from app.core.errors import AppError
from app.schemas.product import CPNConfig, DCDConfig, ELNConfig

ProductConfig = Union[ELNConfig, CPNConfig, DCDConfig]


def _dcd_pair(underlying_key: str) -> str:
    """'USDINR' -> 'USD/INR' using backend/config/underlyings.yaml (base_currency + currency)."""
    entry = get_underlyings().get(underlying_key.strip().upper())
    if not entry or entry.get("asset_class") != "fx":
        raise AppError(422, "VALIDATION_ERROR",
                        f"{underlying_key!r} is not a known FX underlying for a DCD.")
    base = entry.get("base_currency")
    quote = entry.get("currency")
    if not base or not quote:
        raise AppError(422, "VALIDATION_ERROR",
                        f"underlyings.yaml entry for {underlying_key!r} is missing base_currency/currency.")
    return f"{base}/{quote}"


def to_sim_engine_payload(config: ProductConfig) -> Dict[str, Any]:
    """Build the raw dict sim_engine.run_simulation() expects from a validated product config.

    product_id is omitted (derived from the terms). start_date is passed for a DCD, whose interest
    accrues by calendar days from the trade date; other products default to today.
    """
    if isinstance(config, ELNConfig):
        return {
            "product_type": "ELN",
            "underlying": config.underlying,
            "notional": config.principal,
            "tenor": config.tenor_months,
            "coupon_pa": config.coupon_pa,
            "strike_pct": config.strike_pct,
            "barrier_pct": config.barrier_pct,
            "barrier_monitoring": config.barrier_monitoring,
            "coupon_conditional": config.coupon_conditional,
        }
    if isinstance(config, CPNConfig):
        return {
            "product_type": "CPN",
            "underlying": config.underlying,
            "notional": config.principal,
            "tenor": config.tenor_months,
            # Backend's CPNConfig has no coupon field; sim_engine treats it as optional (0.0).
            "coupon_pa": getattr(config, "coupon_pa", 0.0) or 0.0,
            "protection_pct": config.protection_pct,
            "participation_pct": config.participation_pct,
            "cap_pct": config.cap_pct,
        }
    if isinstance(config, DCDConfig):
        return {
            "product_type": "DCD",
            "underlying": _dcd_pair(config.underlying),
            "notional": config.principal,
            "tenor": config.tenor_months,
            "coupon_pa": config.interest_pa,
            "strike_rate": config.strike,
            "alt_currency": config.alt_currency,
            "start_date": config.start_date.isoformat() if config.start_date else None,
        }
    raise AppError(422, "VALIDATION_ERROR", f"Unsupported product config: {type(config).__name__}")
