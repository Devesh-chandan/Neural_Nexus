"""
Market data API routes.
GET /api/underlyings  – whitelist with metadata and latest price
GET /api/market/history  – downsampled close series + vol + source info
GET /api/product-defaults/{product_type}  – defaults and bounds
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

import numpy as np
import pandas as pd
from fastapi import APIRouter, Query

from app.analytics.vol import compute_vol
from app.core.config import get_products_config, get_underlyings
from app.core.errors import AppError
from app.market.service import get_history

logger = logging.getLogger(__name__)
router = APIRouter(tags=["market"])

DISCLAIMER = (
    "Illustrative analysis using historical data and statistical models. "
    "Past performance does not predict future results. Issuer credit risk and "
    "liquidity risk are not modelled. This is a decision-support tool and not "
    "investment advice; suitability must be confirmed by a qualified person."
)


@router.get("/underlyings")
async def list_underlyings() -> Dict[str, Any]:
    underlyings = get_underlyings()
    items = []
    for key, meta in underlyings.items():
        item: Dict[str, Any] = {
            "key": key,
            "ticker": meta["ticker"],
            "display_name": meta["display_name"],
            "asset_class": meta["asset_class"],
            "type": meta["type"],
            "currency": meta["currency"],
            "sector": meta["sector"],
        }
        # Best-effort latest price
        try:
            df, source, as_of, snap = get_history(key)
            item["latest_price"] = float(df["close"].iloc[-1])
            item["data_source"] = source
            item["as_of"] = as_of
            item["snapshot_id"] = snap
            vol = compute_vol(df["close"])
            item["vol_1y"] = round(vol["realised_1y"], 4)
        except Exception as exc:
            logger.warning("Could not get price for %s: %s", key, exc)
            item["latest_price"] = None
            item["data_source"] = "unavailable"
            item["as_of"] = None
            item["snapshot_id"] = None
            item["vol_1y"] = None
        items.append(item)

    return {"underlyings": items, "disclaimer": DISCLAIMER}


@router.get("/market/history")
async def market_history(
    key: str = Query(..., description="Underlying key from /api/underlyings"),
    years: float = Query(default=10.0, ge=1, le=20),
) -> Dict[str, Any]:
    try:
        df, source, as_of, snap = get_history(key)
    except ValueError as exc:
        raise AppError(404, "DATA_NOT_FOUND", str(exc))

    # Trim to requested years
    cutoff = df.index[-1] - pd.DateOffset(years=years)
    df = df[df.index >= cutoff]

    # Downsample to at most 500 points for the chart
    if len(df) > 500:
        step = len(df) // 500
        df = df.iloc[::step]

    vol = compute_vol(df["close"])

    return {
        "key": key,
        "series": [
            {"date": str(row.Index.date()), "close": round(float(row.close), 4)}
            for row in df.itertuples()
        ],
        "vol": {
            "ewma": round(vol["ewma"], 4) if not np.isnan(vol["ewma"]) else None,
            "realised_1y": round(vol["realised_1y"], 4) if not np.isnan(vol["realised_1y"]) else None,
        },
        "data_source": source,
        "as_of": as_of,
        "snapshot_id": snap,
        "disclaimer": DISCLAIMER,
    }


@router.get("/product-defaults/{product_type}")
async def product_defaults(product_type: str) -> Dict[str, Any]:
    cfg = get_products_config()
    pt = product_type.upper()
    if pt not in cfg:
        raise AppError(404, "PRODUCT_NOT_FOUND", f"Unknown product type: {product_type}")

    pc = cfg[pt]
    return {
        "product_type": pt,
        "defaults": pc.get("defaults", {}),
        "bounds": pc.get("bounds", {}),
        "grids": pc.get("grids", {}),
        "complexity": pc.get("complexity"),
    }
