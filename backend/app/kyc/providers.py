"""
KYC import from existing brokerage / wealth apps (Kite, Zerodha Console, Groww, Cred).

Each provider exposes a different subset of the KYC surface over its OAuth scopes,
which is why an import is only ever a *pre-fill* for client self-attestation:
risk appetite, loss tolerance and horizon are never imported.

No live OAuth connector is configured in this deployment, so the providers are
listed (from config/registration.yaml) as not connected and an import request is
refused with a clear error. Identity data is never synthesised: a pre-filled KYC
draft must come from the provider itself.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List

from app.core.config import get_registration_config
from app.core.errors import AppError
from app.schemas.registration import (
    BrokerLink,
    BrokerProvider,
    KycImportRequest,
    KycImportResponse,
)


def _mask_handle(handle: str) -> str:
    h = handle.strip()
    if len(h) <= 2:
        return f"{h[0]}*"
    if "@" in h:
        local, _, domain = h.partition("@")
        masked_local = f"{local[0]}{'*' * max(1, len(local) - 2)}{local[-1]}"
        return f"{masked_local}@{domain}"
    return f"{h[0]}{'*' * max(1, len(h) - 2)}{h[-1]}"


def _connected(entry: Dict[str, Any]) -> bool:
    """A provider is usable only when its connector is configured (`connector:` in config)."""
    return bool(entry.get("connector"))


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
            "connected": _connected(entry),
        }
        for key, entry in cfg.items()
    ]


def import_kyc(req: KycImportRequest) -> KycImportResponse:
    """
    Pre-fill a client registration from an existing brokerage / wealth app.

    Refused unless a live connector for the provider is configured; the client
    registers manually instead.
    """
    provider_cfg = get_registration_config()["kyc"]["providers"].get(req.provider)
    if provider_cfg is None:
        raise AppError(
            422,
            "UNSUPPORTED_PROVIDER",
            f"KYC import is not supported for '{req.provider}'.",
        )
    if not _connected(provider_cfg):
        raise AppError(
            503,
            "PROVIDER_NOT_CONNECTED",
            f"{provider_cfg['label']} is not connected to this platform yet, so your KYC "
            "cannot be imported from it. Please register manually.",
        )
    # A configured connector would perform the OAuth exchange here and map the
    # provider payload; none ships with this deployment.
    raise AppError(
        501,
        "CONNECTOR_NOT_IMPLEMENTED",
        f"The {provider_cfg['label']} connector '{provider_cfg['connector']}' is not available in this build.",
    )


def link_from_import(provider: BrokerProvider, handle: str) -> BrokerLink:
    """Build a persisted broker link record for a case."""
    return BrokerLink(
        provider=provider,
        handle=_mask_handle(handle),
        linked_at=datetime.now(timezone.utc).isoformat(),
    )
