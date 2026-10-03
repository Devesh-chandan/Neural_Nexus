"""
Registration service: bridges the registration payloads onto the analytical
`ClientProfile` that the pricing and suitability engines consume, and derives the
KYC compliance flags for the audit file.
"""
from __future__ import annotations

from typing import Any, Dict, List

from app.core.config import get_registration_config
from app.core.rbac import permissions_for_tier, rbac_summary
from app.schemas.client import ClientProfile
from app.schemas.registration import (
    BrokerLink,
    ClientRegistration,
    RMSRegistration,
    RMSRegistrationResponse,
)


# ── KYC flags ────────────────────────────────────────────────────────────────

def kyc_flags(identity_tax_id: str | None, verified: bool, source_of_funds: str | None) -> List[str]:
    """
    Compliance flags for the case file. These are surfaced, never silently
    dropped, so an incomplete KYC file is visible to whoever reviews the case.
    """
    flags: List[str] = []
    if not identity_tax_id:
        flags.append("tax_id_missing")
    if not verified:
        flags.append("identity_not_independently_verified")
    if not source_of_funds:
        flags.append("source_of_funds_not_declared")
    return flags


# ── Registration → ClientProfile ─────────────────────────────────────────────

def to_client_profile(reg: ClientRegistration) -> ClientProfile:
    """
    Map the registration answers onto the analytical profile.

    The four PS-locked suitability answers map one-to-one onto the profile:

    * ``risk_appetite``                  → ``risk_appetite``
    * ``investment_horizon_years``       → ``horizon_months`` (years × 12)
    * ``loss_tolerance_pct``             → ``loss_tolerance_pct``
    * ``current_portfolio_concentration_pct`` → ``existing_structured_pct``

    and ``liquid_net_worth`` becomes ``investable_assets`` so the existing
    concentration rule keeps measuring the right denominator.
    """
    horizon_months = int(round(reg.suitability.investment_horizon_years * 12))
    horizon_months = max(3, min(120, horizon_months))

    concentration_pct = reg.suitability.current_portfolio_concentration_pct

    return ClientProfile(
        client_name=reg.identity.legal_name,
        risk_appetite=reg.suitability.risk_appetite,
        horizon_months=horizon_months,
        loss_tolerance_pct=reg.suitability.loss_tolerance_pct,
        investable_assets=reg.financials.liquid_net_worth,
        investment_amount=reg.financials.investment_amount,
        existing_exposure_underlying_pct=concentration_pct,
        existing_structured_pct=concentration_pct,
        experience=reg.suitability.experience,
        date_of_birth=reg.identity.date_of_birth,
        employment_status=reg.identity.employment_status,
        national_tax_id=reg.identity.national_tax_id,
        kyc_verified=bool(reg.identity.national_tax_id),
        kyc_source=reg.kyc_source,
        kyc_provider=reg.broker_link.provider if reg.broker_link else None,
        liquid_net_worth=reg.financials.liquid_net_worth,
        annual_income=reg.financials.annual_income,
        source_of_funds=reg.financials.source_of_funds,
        previous_investment_exposure_pct=(
            reg.financials.previous_investment_exposure_pct
        ),
    )


def attach_broker_link(profile: ClientProfile, link: BrokerLink) -> ClientProfile:
    return profile.model_copy(update={"kyc_provider": link.provider})


# ── RM registration ─────────────────────────────────────────────────────────

def _authorised_product_types(jurisdiction: str, requested: List[str]) -> List[str]:
    """
    Resolve what an RM may actually configure: the intersection of the
    jurisdiction matrix and anything explicitly requested by the RM.
    """
    permitted = get_registration_config()["jurisdiction_product_matrix"].get(jurisdiction, [])
    if not requested:
        return list(permitted)
    return [pt for pt in permitted if pt.upper() in {r.upper() for r in requested}]


def register_rm_record(reg: RMSRegistration) -> RMSRegistrationResponse:
    """
    Validate an RM registration and produce the persisted-facing response.
    Persistence itself happens in the store layer.
    """
    jurisdiction = reg.compliance.operating_jurisdiction
    authorised = _authorised_product_types(
        jurisdiction, reg.compliance.product_types_authorised
    )

    tier_cfg = get_registration_config()["access_tiers"].get(reg.access.access_tier, {})
    effective_tier = reg.access.access_tier

    # Principle of least privilege: an RM can never hold a tier above the rank
    # their own clearance allows them to grant.
    requested_rank = tier_cfg.get("rank", 1)
    if requested_rank > 3:
        effective_tier = "branch_manager"

    return RMSRegistrationResponse(
        rm_id="",  # filled in by the route after persistence
        legal_name=reg.identity.legal_name,
        corporate_email=reg.identity.corporate_email,
        email_domain=reg.identity.corporate_email.split("@")[-1].lower(),
        employee_id=reg.identity.employee_id,
        institution=reg.access.institution,
        branch_code=reg.access.branch_code,
        department=reg.access.department,
        access_tier=effective_tier,
        regulatory_registration_number=reg.compliance.regulatory_registration_number,
        operating_jurisdiction=jurisdiction,
        authorised_product_types=authorised,
        rbac=rbac_summary(effective_tier, jurisdiction),
        registered_at="",
    )


def describe_rm_tier(access_tier: str) -> Dict[str, Any]:
    """Public description of an access tier for the registration UI."""
    entry = get_registration_config()["access_tiers"].get(access_tier, {})
    perms = permissions_for_tier(access_tier)
    summary = rbac_summary(access_tier, "IN")
    return {
        "key": access_tier,
        "label": entry.get("label", access_tier),
        "rank": entry.get("rank"),
        "description": " ".join((entry.get("description") or "").split()),
        "escalate_to": entry.get("escalate_to"),
        "permissions": perms,
        "can_finalise": summary["can_finalise"],
        "finalise_blocked_reason": summary["finalise_blocked_reason"],
        "permission_labels": summary["permission_labels"],
    }
