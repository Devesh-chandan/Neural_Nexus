"""
Role-based access control for Relationship Managers (RM).

Implements three concerns described in the registration spec:

1. **Corporate email validation** – only institutional domains are accepted, so
   client PII cannot be exfiltrated through a personal mailbox.
2. **Jurisdiction gating** – an RM may only configure products that are legally
   sellable in the region they operate in.
3. **Single RM role** – every relationship manager holds every permission.

All thresholds live in `config/registration.yaml` so compliance can retune them
without touching code.
"""
from __future__ import annotations

import re
from typing import Dict, List, Optional

from app.core.config import get_registration_config

# Local-part grammar per RFC 5322 dot-atom form. Deliberately permissive on the
# dot requirement – many institutional addresses are `rm1@bank.com`, not
# `first.last@bank.com` – but leading/trailing/consecutive dots are invalid.
_ATEXT = r"A-Za-z0-9!#$%&'*+/=?^_`{|}~-"
_EMAIL_RE = re.compile(
    rf"^[{_ATEXT}]+(?:\.[{_ATEXT}]+)*@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?"
    r"(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*$"
)

# ── Permission vocabulary ────────────────────────────────────────────────────

PERM_SIMULATE = "simulate"
PERM_VIEW_SUITABILITY = "view_suitability"
PERM_DRAFT_CONFIGURATION = "draft_configuration"
PERM_FINALISE_CONFIGURATION = "finalise_configuration"
PERM_APPROVE_OVERRIDE = "approve_override"
PERM_VIEW_CLIENT_KYC = "view_client_kyc"
PERM_EXPORT_REPORT = "export_report"
PERM_VIEW_TEAM_REPORTS = "view_team_reports"
PERM_MANAGE_PRODUCT_CATALOGUE = "manage_product_catalogue"

ALL_PERMISSIONS: List[str] = [
    PERM_SIMULATE,
    PERM_VIEW_SUITABILITY,
    PERM_DRAFT_CONFIGURATION,
    PERM_FINALISE_CONFIGURATION,
    PERM_APPROVE_OVERRIDE,
    PERM_VIEW_CLIENT_KYC,
    PERM_EXPORT_REPORT,
    PERM_VIEW_TEAM_REPORTS,
    PERM_MANAGE_PRODUCT_CATALOGUE,
]


# ── Corporate email validation ───────────────────────────────────────────────

def corporate_email_error(email: str) -> Optional[str]:
    """
    Return a human-readable reason the email is rejected, or None if it is
    acceptable.

    Blocks public / consumer mailbox providers outright and requires an
    institutional domain to be configured for the institution in
    `config/registration.yaml`.
    """
    cfg = get_registration_config()
    email = (email or "").strip().lower()

    if not email:
        return "Corporate email address is required."

    if not _EMAIL_RE.match(email):
        return "Enter a valid email address in the form name@institution.com."

    domain = email.partition("@")[2]

    # Check the public-provider blocklist before anything else so the user gets
    # the specific reason rather than a generic format complaint.
    if domain in cfg["blocked_public_email_domains"]:
        return (
            f"Public mailbox providers ({domain}) are not accepted. "
            "Use your institutional email address."
        )

    if domain.endswith(".test") or domain.endswith(".example") or domain.endswith(".invalid"):
        return "That email domain is not a real institution. Use your corporate address."

    # If the institution has been claimed by an RM, the domain must match it.
    allowed = cfg["institution_email_domains"]
    if domain not in allowed and cfg.get("require_known_institution_domain", False):
        return (
            f"'{domain}' is not a recognised institution domain. "
            "Register your institution first."
        )

    return None


# ── Regulatory registration number ───────────────────────────────────────────

def regulatory_number_error(
    number: str, jurisdiction: str
) -> Optional[str]:
    """Validate a regulator registration number against the declared jurisdiction."""
    cfg = get_registration_config()
    number = (number or "").strip().upper()

    if not number:
        return "Regulatory registration number is required."

    rules = cfg["regulatory_numbers"].get(jurisdiction)
    if rules is None:
        return f"Unsupported operating jurisdiction '{jurisdiction}'."

    if "min_length" in rules and len(number) < rules["min_length"]:
        return (
            f"{rules['label']} must be at least {rules['min_length']} characters."
        )

    if "pattern" in rules and not re.match(rules["pattern"], number):
        return f"'{number}' does not match the expected {rules['label']} format."

    return None


# ── Jurisdiction gating ──────────────────────────────────────────────────────

def product_jurisdiction_error(
    jurisdiction: str, product_type: str
) -> Optional[str]:
    """
    Return a reason the product may not be configured/sold in the jurisdiction,
    or None if it is permitted.
    """
    cfg = get_registration_config()
    allowed: Dict[str, List[str]] = cfg["jurisdiction_product_matrix"]
    permitted = allowed.get(jurisdiction)

    if permitted is None:
        return f"Operating jurisdiction '{jurisdiction}' is not supported."

    if product_type.upper() not in permitted:
        return (
            f"{product_type.upper()} products may not be configured for clients "
            f"domiciled in {jurisdiction}. Permitted here: {', '.join(permitted)}."
        )
    return None


# ── Access tiers ─────────────────────────────────────────────────────────────

RM_ROLE = "relationship_manager"


def tier_key(access_tier: Optional[str] = None) -> str:
    """There is a single RM role; any stored/legacy tier value maps onto it."""
    return RM_ROLE


def tier_entry(access_tier: Optional[str]) -> Optional[Dict[str, object]]:
    return get_registration_config()["access_tiers"].get(tier_key(access_tier))


def permissions_for_tier(access_tier: str) -> List[str]:
    """Access tiers no longer restrict anything: every RM holds every permission."""
    return list(ALL_PERMISSIONS)


def tier_cannot_finalise_reason(access_tier: str) -> Optional[str]:
    """Every RM may finalise a configuration, so there is never a blocking reason."""
    return None


def has_permission(access_tier: str, permission: str) -> bool:
    return permission in permissions_for_tier(access_tier)


def rm_product_error(rm: Dict[str, object], product_type: str) -> Optional[str]:
    """Every RM may configure every product type; jurisdiction and per-RM lists no longer restrict."""
    return None


# ── Registration summary ─────────────────────────────────────────────────────

def rbac_summary(access_tier: str, jurisdiction: str) -> Dict[str, object]:
    """Everything the frontend needs to render an RM's effective access."""
    cfg = get_registration_config()
    entry = tier_entry(access_tier) or {}
    perms = permissions_for_tier(access_tier)
    return {
        "access_tier": tier_key(access_tier),
        "access_tier_label": entry.get("label", access_tier),
        "permissions": perms,
        "permission_labels": {
            p: _PERMISSION_LABELS.get(p, p.replace("_", " ").title()) for p in perms
        },
        "can_finalise": PERM_FINALISE_CONFIGURATION in perms,
        "finalise_blocked_reason": tier_cannot_finalise_reason(access_tier),
        "permitted_product_types": cfg["jurisdiction_product_matrix"].get(jurisdiction, []),
        "jurisdiction_label": cfg["jurisdictions"].get(jurisdiction, {}).get(
            "label", jurisdiction
        ),
        "regulator": cfg["jurisdictions"].get(jurisdiction, {}).get(
            "regulator", "n/a"
        ),
    }


_PERMISSION_LABELS: Dict[str, str] = {
    PERM_SIMULATE: "Simulate payoffs",
    PERM_VIEW_SUITABILITY: "View suitability",
    PERM_DRAFT_CONFIGURATION: "Draft configuration",
    PERM_FINALISE_CONFIGURATION: "Confirm / finalise configuration",
    PERM_APPROVE_OVERRIDE: "Approve suitability override",
    PERM_VIEW_CLIENT_KYC: "View client KYC",
    PERM_EXPORT_REPORT: "Export client reports",
    PERM_VIEW_TEAM_REPORTS: "View branch reports",
    PERM_MANAGE_PRODUCT_CATALOGUE: "Manage product catalogue",
}
