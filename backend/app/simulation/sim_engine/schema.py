"""Input schema: validate and normalise one product (ELN, CPN or DCD).

Input fields (same as the team's sample files):
    product_type   "ELN" | "CPN" | "DCD"
    underlying     "NIFTY", "RELIANCE", "USD/INR", ...
    notional       amount invested (> 0)
    start_date     "YYYY-MM-DD" (optional, default = today)
    tenor          months, fractions allowed (0.25 = about one week)
    coupon_pa      yearly coupon / interest as a decimal (0.10 = 10%)
    strike_pct     ELN: strike as a fraction of the start price
    barrier_pct    ELN: knock-in barrier as a fraction of the start price (null = no barrier)
    barrier_monitoring ELN: "daily" (any daily close; default) or "maturity" (final close only)
    coupon_conditional ELN: true = the coupon is forfeited when the barrier is breached (default false)
    protection_pct CPN: capital returned at maturity (1.0 = 100%)
    participation_pct CPN: share of the rise you receive
    cap_pct        CPN: maximum upside return (null = no cap)
    strike_rate    DCD: conversion rate, in the pair's own quote (JPY/INR per 100 JPY)
    alt_currency   DCD: the currency the bank may repay you in
    product_id     optional; if missing a stable id is derived from the terms
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import math
import re
from dataclasses import asdict, dataclass
from typing import Any, Dict, List, Optional, Tuple

from .config import MAX_TENOR_MONTHS
from .errors import InvalidProduct

PRODUCT_TYPES = ("ELN", "CPN", "DCD")

USED_FIELDS = {
    "ELN": ("coupon_pa", "strike_pct", "barrier_pct", "barrier_monitoring", "coupon_conditional"),
    "CPN": ("coupon_pa", "protection_pct", "participation_pct", "cap_pct"),
    "DCD": ("coupon_pa", "strike_rate", "alt_currency"),
}
OPTIONAL_TERM_FIELDS = ("coupon_pa", "strike_pct", "barrier_pct", "barrier_monitoring", "coupon_conditional",
                        "protection_pct",
                        "participation_pct", "cap_pct", "strike_rate", "alt_currency")
KNOWN_FIELDS = set(OPTIONAL_TERM_FIELDS) | {
    "product_type", "underlying", "notional", "start_date", "tenor", "product_id",
    "name", "notes", "client_id"}

_PAIR_RE = re.compile(r"^([A-Z]{3})/([A-Z]{3})$")


@dataclass(frozen=True)
class Product:
    product_id: str
    product_type: str
    underlying: str
    notional: float
    start_date: dt.date
    tenor_months: float
    coupon_pa: float = 0.0
    strike_pct: Optional[float] = None
    barrier_pct: Optional[float] = None
    barrier_monitoring: str = "daily"
    coupon_conditional: bool = False
    protection_pct: Optional[float] = None
    participation_pct: Optional[float] = None
    cap_pct: Optional[float] = None
    strike_rate: Optional[float] = None
    alt_currency: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["start_date"] = self.start_date.isoformat()
        d["tenor"] = d.pop("tenor_months")
        return d


def _is_blank(v: Any) -> bool:
    return v is None or (isinstance(v, str) and v.strip() == "")


def _number(raw: Dict[str, Any], name: str, errors: List[Dict[str, str]], *,
            required: bool, lo: Optional[float] = None, hi: Optional[float] = None,
            lo_open: bool = False) -> Optional[float]:
    v = raw.get(name)
    if _is_blank(v):
        if required:
            errors.append({"field": name, "message": "is required"})
        return None
    if isinstance(v, bool):
        errors.append({"field": name, "message": "must be a number"})
        return None
    try:
        x = float(v)
    except (TypeError, ValueError):
        errors.append({"field": name, "message": f"must be a number (got {v!r})"})
        return None
    if not math.isfinite(x):
        errors.append({"field": name, "message": "must be a finite number"})
        return None
    if lo is not None and (x <= lo if lo_open else x < lo):
        errors.append({"field": name, "message": f"must be {'>' if lo_open else '>='} {lo}"})
        return None
    if hi is not None and x > hi:
        errors.append({"field": name, "message": f"must be <= {hi}"})
        return None
    return x


def _canonical_terms(d: Dict[str, Any]) -> str:
    clean = {}
    for k, v in sorted(d.items()):
        if k == "product_id":
            continue
        if isinstance(v, float):
            v = float(f"{v:.10g}")
        clean[k] = v
    return json.dumps(clean, sort_keys=True, separators=(",", ":"))


def stable_id(prefix: str, text: str, n: int = 12) -> str:
    return f"{prefix}_{hashlib.sha256(text.encode('utf-8')).hexdigest()[:n]}"


def split_pair(underlying: str) -> Optional[Tuple[str, str]]:
    m = _PAIR_RE.match(underlying)
    return (m.group(1), m.group(2)) if m else None


def parse_product(raw: Any, today: Optional[dt.date] = None) -> Tuple[Product, List[Dict[str, str]]]:
    """Validate one product. Returns (product, warnings) or raises InvalidProduct."""
    if not isinstance(raw, dict):
        raise InvalidProduct([{"field": "(root)", "message": "each product must be a JSON object"}])
    today = today or dt.date.today()
    errors: List[Dict[str, str]] = []
    warnings: List[Dict[str, str]] = []

    ptype = str(raw.get("product_type") or "").strip().upper()
    if ptype not in PRODUCT_TYPES:
        errors.append({"field": "product_type",
                       "message": f"must be one of {', '.join(PRODUCT_TYPES)} (got {raw.get('product_type')!r})"})

    underlying = str(raw.get("underlying") or "").strip().upper()
    if not underlying:
        errors.append({"field": "underlying", "message": "is required"})

    notional = _number(raw, "notional", errors, required=True, lo=0, hi=1e13, lo_open=True)
    tenor = _number(raw, "tenor", errors, required=True, lo=0, hi=MAX_TENOR_MONTHS, lo_open=True)

    start_raw = raw.get("start_date")
    start: Optional[dt.date] = None
    if _is_blank(start_raw):
        start = today
    elif isinstance(start_raw, dt.date):
        start = start_raw
    else:
        try:
            start = dt.date.fromisoformat(str(start_raw).strip()[:10])
        except ValueError:
            errors.append({"field": "start_date", "message": f"must be YYYY-MM-DD (got {start_raw!r})"})

    barrier_monitoring = "daily"
    coupon_conditional = False
    coupon = strike_pct = barrier = protection = participation = cap = strike_rate = None
    alt: Optional[str] = None

    if ptype == "ELN":
        coupon = _number(raw, "coupon_pa", errors, required=True, lo=0, hi=1.0)
        strike_pct = _number(raw, "strike_pct", errors, required=True, lo=0, hi=2.0, lo_open=True)
        barrier = _number(raw, "barrier_pct", errors, required=False, lo=0, hi=1.0, lo_open=True)
        bm = raw.get("barrier_monitoring")
        if not _is_blank(bm):
            barrier_monitoring = str(bm).strip().lower()
            if barrier_monitoring not in ("daily", "maturity"):
                errors.append({"field": "barrier_monitoring", "message": f'must be "daily" or "maturity" (got {bm!r})'})
        cc = raw.get("coupon_conditional")
        if not _is_blank(cc):
            if not isinstance(cc, bool):
                errors.append({"field": "coupon_conditional", "message": "must be true or false"})
            else:
                coupon_conditional = cc
    elif ptype == "CPN":
        coupon = _number(raw, "coupon_pa", errors, required=False, lo=0, hi=1.0)
        protection = _number(raw, "protection_pct", errors, required=True, lo=0, hi=1.5)
        participation = _number(raw, "participation_pct", errors, required=True, lo=0, hi=10.0)
        cap = _number(raw, "cap_pct", errors, required=False, lo=0, hi=10.0, lo_open=True)
    elif ptype == "DCD":
        coupon = _number(raw, "coupon_pa", errors, required=True, lo=0, hi=1.0)
        strike_rate = _number(raw, "strike_rate", errors, required=True, lo=0, lo_open=True)
        alt_raw = raw.get("alt_currency")
        alt = str(alt_raw).strip().upper() if not _is_blank(alt_raw) else None
        pair = split_pair(underlying) if underlying else None
        if pair is None and underlying:
            errors.append({"field": "underlying",
                           "message": f"a DCD needs a currency pair like USD/INR (got {underlying!r})"})
        if alt is None:
            errors.append({"field": "alt_currency", "message": "is required"})
        elif pair is not None and alt not in pair:
            errors.append({"field": "alt_currency",
                           "message": f"must be one of the pair's currencies {pair[0]} or {pair[1]} (got {alt!r})"})

    if errors:
        raise InvalidProduct(errors)

    # Values given for fields this product type does not use are ignored, not errors.
    used = USED_FIELDS[ptype]
    ignored = [f for f in OPTIONAL_TERM_FIELDS if f not in used and not _is_blank(raw.get(f))]
    if ignored:
        warnings.append({"code": "IGNORED_FIELDS",
                         "message": f"{ptype} does not use: {', '.join(ignored)}. They were ignored."})
    unknown = sorted(k for k in raw if k not in KNOWN_FIELDS)
    if unknown:
        warnings.append({"code": "UNKNOWN_FIELDS",
                         "message": f"Unknown fields were ignored: {', '.join(unknown)}."})

    terms = {
        "product_type": ptype, "underlying": underlying, "notional": notional,
        "start_date": start.isoformat(), "tenor": tenor, "coupon_pa": coupon or 0.0,
        "strike_pct": strike_pct, "barrier_pct": barrier, "barrier_monitoring": barrier_monitoring,
        "coupon_conditional": coupon_conditional, "protection_pct": protection,
        "participation_pct": participation, "cap_pct": cap, "strike_rate": strike_rate,
        "alt_currency": alt,
    }
    pid_raw = raw.get("product_id")
    pid = str(pid_raw).strip() if not _is_blank(pid_raw) else stable_id("prod", _canonical_terms(terms))

    product = Product(
        product_id=pid, product_type=ptype, underlying=underlying, notional=float(notional),
        start_date=start, tenor_months=float(tenor), coupon_pa=float(coupon or 0.0),
        strike_pct=strike_pct, barrier_pct=barrier, barrier_monitoring=barrier_monitoring,
        coupon_conditional=coupon_conditional, protection_pct=protection,
        participation_pct=participation, cap_pct=cap, strike_rate=strike_rate, alt_currency=alt,
    )
    return product, warnings


def canonical_product(product: Product) -> str:
    return _canonical_terms(product.to_dict())
