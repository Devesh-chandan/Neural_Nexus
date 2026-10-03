"""
KYC import from existing brokerage / wealth apps.

Prototype-grade connectors for Kite (Zerodha), Zerodha Console, Groww and Cred.
Each provider exposes a different subset of the KYC surface, which is exactly
why the import has to be treated as a *pre-fill* and not as a replacement for
client self-attestation.

Honest limitations, deliberately kept explicit:

* No live OAuth flow and no real network calls. The payloads below are
  deterministic synthetic fixtures derived from the provider key plus the
  client's handle, so a demo always reproduces.
* Real connectors would return data over the provider's OAuth scopes. Only
  fields inside those scopes may be requested.
* Risk appetite, loss tolerance and horizon are **never** imported. Those are
  self-assessments; a broker has no reliable source for them.
"""
from __future__ import annotations

import hashlib
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Tuple

from app.core.config import get_registration_config
from app.core.errors import AppError
from app.schemas.registration import (
    BrokerLink,
    BrokerProvider,
    KycImportRequest,
    KycImportResponse,
)

# ── Deterministic fixture generation ─────────────────────────────────────────

_FIRST_NAMES = [
    "Arjun", "Priya", "Rahul", "Sneha", "Vikram", "Ananya", "Karthik", "Meera",
    "Aditya", "Divya", "Rohan", "Ishita", "Nikhil", "Pooja", "Siddharth",
]
_LAST_NAMES = [
    "Mehta", "Sharma", "Iyer", "Nair", "Reddy", "Kapoor", "Bose", "Chatterjee",
    "Deshpande", "Rao", "Malhotra", "Pillai", "Sinha", "Varghese", "Khanna",
]
_EMPLOYERS = [
    "Tata Consultancy Services", "Reliance Industries", "Infosys", "HDFC Bank",
    "ICICI Bank", "Wipro", "Adani Group", "Bajaj Finserv",
]
_PAN_SERIES = ["ABCDE", "PQRST", "LMNOP", "UVWXY"]


def _seed(provider: str, handle: str) -> int:
    digest = hashlib.sha256(f"{provider}:{handle.strip().lower()}".encode()).hexdigest()
    return int(digest[:12], 16)


def _pick(seq: List[Any], seed_int: int, salt: int = 0) -> Any:
    return seq[(seed_int >> (salt * 3)) % len(seq)]


def _mask_handle(handle: str) -> str:
    h = handle.strip()
    if len(h) <= 2:
        return f"{h[0]}*"
    if "@" in h:
        local, _, domain = h.partition("@")
        masked_local = f"{local[0]}{'*' * max(1, len(local) - 2)}{local[-1]}"
        return f"{masked_local}@{domain}"
    return f"{h[0]}{'*' * max(1, len(h) - 2)}{h[-1]}"


def _pan(seed_int: int) -> str:
    """PAN shape: 5 letters, 4 digits, 1 check letter (10 chars)."""
    letters = (
        _PAN_SERIES[seed_int % len(_PAN_SERIES)][:3]
        + _PAN_SERIES[(seed_int >> 4) % len(_PAN_SERIES)][:2]
    )
    digits = f"{seed_int % 10000:04d}"
    return f"{letters}{digits}V"


# ── Provider fixtures ────────────────────────────────────────────────────────

def _fixture_kite(seed: int) -> Tuple[Dict[str, Any], Dict[str, Any], List[str], List[str]]:
    """Kite is the richest source: PAN, DOB and a full demat breakdown."""
    first = _pick(_FIRST_NAMES, seed, 0)
    last = _pick(_LAST_NAMES, seed, 1)
    age = 28 + (seed % 32)                     # 28–59
    dob = date.today() - timedelta(days=age * 365 + (seed % 300))
    net_worth = 2_500_000 + (seed % 28) * 1_250_000
    income = int(net_worth * (0.18 + (seed % 17) / 100.0))
    identity = {
        "legal_name": f"{first} {last}",
        "date_of_birth": dob.isoformat(),
        "national_tax_id": _pan(seed),
        "employment_status": "salaried" if seed % 3 else "self_employed",
    }
    financials = {
        "liquid_net_worth": float(net_worth),
        "annual_income": float(income),
        "previous_investment_exposure_pct": round(5 + (seed % 25), 1),
        # Kite does not know the client's investable cash; infer from demat value.
        "holdings_breakdown": {
            "equities_pct": round(35 + (seed % 20), 1),
            "mutual_funds_pct": round(25 + (seed % 15), 1),
            "cash_pct": round(10 + (seed % 12), 1),
            "debt_pct": round(5 + (seed % 8), 1),
        },
    }
    flags = [f"kyc_pan_onfile_via_{_pick(['demat', 'kyc_registry', 'offline_form'], seed, 4)}"]
    return identity, financials, flags, ["read:profile", "read:holdings", "read:mf_holdings"]


def _fixture_zerodha_console(seed: int) -> Tuple[Dict[str, Any], Dict[str, Any], List[str], List[str]]:
    """Console returns employment type and available margin, not a full split."""
    first = _pick(_FIRST_NAMES, seed, 3)
    last = _pick(_LAST_NAMES, seed, 4)
    age = 26 + (seed % 34)
    dob = date.today() - timedelta(days=age * 365 + (seed % 280))
    net_worth = 1_800_000 + (seed % 26) * 900_000
    income = int(net_worth * (0.16 + (seed % 14) / 100.0))
    identity = {
        "legal_name": f"{first} {last}",
        "date_of_birth": dob.isoformat(),
        "national_tax_id": _pan(seed ^ 0x5A5A),
        "employment_status": _pick(
            ["salaried", "self_employed", "business_owner", "professional"], seed, 5
        ),
        "employer": _pick(_EMPLOYERS, seed, 6),
    }
    financials = {
        "liquid_net_worth": float(net_worth),
        "annual_income": float(income),
        "previous_investment_exposure_pct": round(8 + (seed % 22), 1),
        "available_margin": round(net_worth * 0.35, 2),
    }
    flags = ["kyc_pan_onfile_via_console_session", "employment_type_self_reported"]
    return identity, financials, flags, ["read:profile", "read:holdings", "read:funds"]


def _fixture_groww(seed: int) -> Tuple[Dict[str, Any], Dict[str, Any], List[str], List[str]]:
    """Groww exposes investments but has no tax identifier in open scope."""
    first = _pick(_FIRST_NAMES, seed, 7)
    last = _pick(_LAST_NAMES, seed, 8)
    age = 24 + (seed % 26)
    dob = date.today() - timedelta(days=age * 365 + (seed % 200))
    net_worth = 900_000 + (seed % 20) * 650_000
    income = int(net_worth * (0.14 + (seed % 12) / 100.0))
    identity = {
        "legal_name": f"{first} {last}",
        "date_of_birth": dob.isoformat(),
        "national_tax_id": None,
        "employment_status": _pick(["salaried", "student", "self_employed"], seed, 9),
    }
    financials = {
        "liquid_net_worth": float(net_worth),
        "annual_income": float(income),
        "previous_investment_exposure_pct": round(12 + (seed % 28), 1),
        "investments": {
            "mutual_funds_pct": round(50 + (seed % 25), 1),
            "equities_pct": round(20 + (seed % 20), 1),
            "cash_pct": round(5 + (seed % 10), 1),
        },
    }
    flags = ["kyc_tax_id_missing", "kyc_self_attested_identity"]
    return identity, financials, flags, ["read:profile", "read:investments"]


def _fixture_cred(seed: int) -> Tuple[Dict[str, Any], Dict[str, Any], List[str], List[str]]:
    """Cred is the strongest source for net worth and source-of-funds evidence."""
    first = _pick(_FIRST_NAMES, seed, 10)
    last = _pick(_LAST_NAMES, seed, 11)
    age = 32 + (seed % 28)
    dob = date.today() - timedelta(days=age * 365 + (seed % 240))
    net_worth = 4_000_000 + (seed % 24) * 2_100_000
    income = int(net_worth * (0.20 + (seed % 15) / 100.0))
    identity = {
        "legal_name": f"{first} {last}",
        "date_of_birth": dob.isoformat(),
        "national_tax_id": _pan(seed ^ 0x3C3C),
        "employment_status": _pick(
            ["salaried", "business_owner", "self_employed", "professional"], seed, 12
        ),
        "employer": _pick(_EMPLOYERS, seed, 13),
    }
    financials = {
        "liquid_net_worth": float(net_worth),
        "annual_income": float(income),
        "previous_investment_exposure_pct": round(10 + (seed % 20), 1),
        "net_worth_breakdown": {
            "cash_and_equivalents_pct": round(15 + (seed % 15), 1),
            "listed_securities_pct": round(35 + (seed % 20), 1),
            "funds_pct": round(20 + (seed % 15), 1),
            "real_assets_pct": round(10 + (seed % 10), 1),
        },
        "source_of_funds_evidence": True,
    }
    flags = ["kyc_pan_onfile_via_cred", "net_worth_independently_verified"]
    return identity, financials, flags, ["read:profile", "read:networth"]


_FIXTURES = {
    "kite": _fixture_kite,
    "zerodha_console": _fixture_zerodha_console,
    "groww": _fixture_groww,
    "cred": _fixture_cred,
}


# ── Public API ───────────────────────────────────────────────────────────────

def list_providers() -> List[Dict[str, Any]]:
    """Supported KYC import providers, straight from config."""
    cfg = get_registration_config()["kyc"]["providers"]
    return [
        {
            "key": key,
            "label": entry["label"],
            "category": entry["category"],
            "auth": entry["auth"],
            "scopes": list(entry["scopes"]),
            "notes": entry["notes"].strip(),
        }
        for key, entry in cfg.items()
    ]


def import_kyc(req: KycImportRequest) -> KycImportResponse:
    """
    Pre-fill a client registration from an existing brokerage / wealth app.

    Returns the draft plus an explicit list of what the client must still
    supply themselves.
    """
    provider_cfg = get_registration_config()["kyc"]["providers"].get(req.provider)
    if provider_cfg is None:
        raise AppError(
            422,
            "UNSUPPORTED_PROVIDER",
            f"KYC import is not supported for '{req.provider}'.",
        )

    handle = req.handle.strip()
    if handle.lower() in {"me", "demo", "test", "sample"}:
        # Guard against a handle that only proves nothing exists upstream.
        raise AppError(
            422,
            "INVALID_HANDLE",
            "Enter the account id, user id or registered email linked to that account.",
        )

    seed = _seed(req.provider, handle)
    identity, financials, flags, scopes = _FIXTURES[req.provider](seed)
    linked_at = datetime.now(timezone.utc).isoformat()

    prefilled = ["legal_name", "date_of_birth"]
    if identity.get("national_tax_id"):
        prefilled.append("national_tax_id")
    prefilled += ["employment_status", "liquid_net_worth", "annual_income"]
    prefilled.append("previous_investment_exposure_pct")

    # Suitability answers and source of funds are always client-attested.
    required = [
        "investment_amount",
        "source_of_funds",
        "risk_appetite",
        "investment_horizon_years",
        "loss_tolerance_pct",
        "current_portfolio_concentration_pct",
    ]
    if not identity.get("national_tax_id"):
        required.insert(0, "national_tax_id")

    return KycImportResponse(
        provider=req.provider,
        provider_label=provider_cfg["label"],
        handle_masked=_mask_handle(handle),
        linked_at=linked_at,
        scope_granted=scopes,
        identity=identity,
        financials=financials,
        kyc_verified=bool(identity.get("national_tax_id")),
        kyc_flags=flags,
        fields_prefilled=prefilled,
        fields_still_required=required,
        disclaimer=(
            "Prototype KYC connector. No live OAuth handshake is performed and the "
            "payload is a synthetic fixture – do not enter real PAN/Aadhaar details. "
            "Risk appetite, horizon, loss tolerance and concentration are never "
            "imported: those are client self-attestations. Source of funds must be "
            "confirmed by the client for AML purposes."
        ),
    )


def link_from_import(provider: BrokerProvider, handle: str) -> BrokerLink:
    """Build a persisted broker link record for a case."""
    return BrokerLink(
        provider=provider,
        handle=_mask_handle(handle),
        linked_at=datetime.now(timezone.utc).isoformat(),
    )
