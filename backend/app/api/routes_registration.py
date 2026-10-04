"""
Registration and KYC routes.

Client surface
--------------
GET  /api/kyc/providers            – brokerage / wealth apps we can import from
POST /api/kyc/import               – pre-fill a registration from that account
POST /api/registration/client      – submit KYC + financials + suitability
GET  /api/registration/client/:id  – load a registered case profile

RM surface
----------
GET  /api/registration/access-tiers           – tier catalogue for the UI
GET  /api/registration/jurisdictions          – jurisdiction catalogue
POST /api/registration/validate/email          – live corporate-email check
POST /api/registration/rm                     – register an RM
GET  /api/registration/rm/:rm_id              – load an RM + effective RBAC
GET  /api/registration/rm/:rm_id/branch       – branch roster (branch manager)
POST /api/registration/rm/:rm_id/finalise     – RBAC gate on confirming a config
"""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Request
from pydantic import BaseModel

from app.core.config import get_registration_config
from app.core.errors import AppError
from app.core.supabase import (
    create_auth_user,
    delete_auth_user,
    update_auth_profile,
)
from app.core.rbac import (
    PERM_FINALISE_CONFIGURATION,
    permissions_for_tier,
    rm_product_error,
    tier_cannot_finalise_reason,
    tier_entry,
)
from app.kyc.providers import import_kyc, list_providers
from app.registration.service import (
    describe_rm_tier,
    kyc_flags,
    register_rm_record,
    to_client_profile,
)
from app.schemas.registration import (
    ClientRegistration,
    ClientRegistrationResponse,
    FinaliseRequest,
    FinaliseResponse,
    KycImportRequest,
    KycImportResponse,
    ProviderInfo,
    ProvidersResponse,
    RMSRegistration,
    RMSRegistrationResponse,
)
from app.store.cases import create_case, delete_case, get_case, normalize_profile
from app.store.db import init_db
from app.store.rms import (
    find_rm_by_employee_id,
    delete_rm_registration,
    get_finalisation,
    get_rm,
    list_all_rms,
    list_branch_rms,
    record_finalisation,
    register_rm,
)
from app.store.runs import load_run

logger = logging.getLogger(__name__)
router = APIRouter(tags=["registration"])

KYC_DISCLAIMER = (
    "Prototype KYC flow. No live identity provider or brokerage OAuth is wired up. "
    "Do not enter real PAN / Aadhaar / SSN values – the demo accepts masked "
    "identifiers. Tax ID is optional here and mandatory in production."
)

RM_DISCLAIMER = (
    "Supabase email/password authentication is enabled. This prototype does not "
    "verify the regulatory registration number against the regulator's register."
)


# ═══ KYC import ═════════════════════════════════════════════════════════════

@router.get("/kyc/providers", response_model=ProvidersResponse)
def kyc_providers() -> ProvidersResponse:
    """Brokerage / wealth apps a client can import their KYC from."""
    return ProvidersResponse(
        providers=[ProviderInfo(**p) for p in list_providers()],
        disclaimer=KYC_DISCLAIMER,
    )


@router.post("/kyc/import", response_model=KycImportResponse)
def kyc_import(req: KycImportRequest) -> KycImportResponse:
    """
    Import KYC from an existing trading / wealth app.

    Returns a *draft*: identity and capacity fields are pre-filled, while risk
    appetite, horizon, loss tolerance, concentration and source of funds must
    still be supplied by the client.
    """
    return import_kyc(req)


# ═══ Client registration ════════════════════════════════════════════════════

class ClientRegistrationRequest(BaseModel):
    """Accepts either a nested payload or the flattened form the UI sends."""
    registration: Optional[ClientRegistration] = None
    identity: Optional[Dict[str, Any]] = None
    financials: Optional[Dict[str, Any]] = None
    suitability: Optional[Dict[str, Any]] = None
    broker_link: Optional[Dict[str, Any]] = None
    consent_kyc: bool = False
    consent_sof: bool = False
    # Portal login credentials (optional – creates a client_accounts row)
    email: Optional[str] = None
    password: Optional[str] = None


@router.post("/registration/client", response_model=ClientRegistrationResponse)
def register_client(req: ClientRegistrationRequest) -> ClientRegistrationResponse:
    """Register a client: KYC identity + financial capacity + suitability answers."""
    init_db()

    payload = req.registration
    if payload is None:
        if not (req.identity and req.financials and req.suitability):
            raise AppError(
                422,
                "VALIDATION_ERROR",
                "Provide identity, financials and suitability sections.",
            )
        try:
            payload = ClientRegistration(
                identity=req.identity,
                financials=req.financials,
                suitability=req.suitability,
                broker_link=req.broker_link,
                consent_kyc=req.consent_kyc,
                consent_sof=req.consent_sof,
            )
        except Exception as exc:
            raise AppError(422, "VALIDATION_ERROR", f"Invalid registration: {exc}")

    try:
        profile = to_client_profile(payload)
    except Exception as exc:  # pragma: no cover - defensive
        raise AppError(422, "VALIDATION_ERROR", f"Could not build profile: {exc}")

    # Portal authentication is provisioned in Supabase; passwords are never stored in SQLite.
    portal_account_id: Optional[str] = None
    if bool(req.email) != bool(req.password):
        raise AppError(422, "CREDENTIALS_REQUIRED", "Provide both an account email and password.")
    if req.email and req.password:
        portal_account_id = create_auth_user(
            email=req.email,
            password=req.password,
            user_type="client",
            profile={
                "legal_name": profile.client_name,
                "date_of_birth": payload.identity.date_of_birth.isoformat(),
                "employment_status": payload.identity.employment_status,
                "national_tax_id": payload.identity.national_tax_id,
                "liquid_net_worth": payload.financials.liquid_net_worth,
                "annual_income": payload.financials.annual_income,
                "source_of_funds": payload.financials.source_of_funds,
                "previous_investment_exposure_pct": payload.financials.previous_investment_exposure_pct,
                "risk_appetite": payload.suitability.risk_appetite,
                "investment_horizon_years": payload.suitability.investment_horizon_years,
                "loss_tolerance_pct": payload.suitability.loss_tolerance_pct,
                "current_portfolio_concentration_pct": payload.suitability.current_portfolio_concentration_pct,
                "experience": payload.suitability.experience,
            },
        )

    try:
        case_id = create_case(
            profile.stored_dict(),
            profile.client_name,
            owner_user_id=portal_account_id,
        )
    except Exception:
        if portal_account_id:
            delete_auth_user(portal_account_id)
        raise
    if portal_account_id:
        try:
            update_auth_profile(portal_account_id, {"case_id": case_id})
        except Exception:
            delete_case(case_id)
            delete_auth_user(portal_account_id)
            raise

    flags = kyc_flags(
        payload.identity.national_tax_id,
        bool(payload.identity.national_tax_id),
        payload.financials.source_of_funds,
    )

    return ClientRegistrationResponse(
        case_id=case_id,
        client_name=profile.client_name,
        kyc_source=payload.kyc_source,
        kyc_verified=bool(payload.identity.national_tax_id),
        kyc_flags=flags,
        age_years=profile.age_years or 0,
        profile=profile,
        portal_account_id=portal_account_id,
        portal_account_error=None,
    )


@router.get("/registration/client/{case_id}")
def get_registered_client(case_id: str, request: Request) -> Dict[str, Any]:
    """Load a registered client's profile for a returning session."""
    row = get_case(case_id)
    if row is None:
        raise AppError(404, "CASE_NOT_FOUND", f"Case {case_id} not found.")
    user = request.state.user
    if user.get("user_type") != "rm" and row.get("owner_user_id") != user.get("id"):
        raise AppError(404, "CASE_NOT_FOUND", "Case not found.")
    return {
        "case_id": row["case_id"],
        "client_name": row["client_name"],
        "created_at": row["created_at"],
        "profile": normalize_profile(json.loads(row["profile_json"]), row["client_name"]),
    }


# ═══ RM registration ═══════════════════════════════════════════════════════

class EmailCheckRequest(BaseModel):
    email: str
    institution: Optional[str] = None


class EmailCheckResponse(BaseModel):
    email: str
    accepted: bool
    domain: Optional[str] = None
    is_public_provider: bool = False
    message: str


@router.post("/registration/validate/email", response_model=EmailCheckResponse)
def validate_email(req: EmailCheckRequest) -> EmailCheckResponse:
    """
    Live corporate-email check so the RM form can reject a personal mailbox
    before submission.
    """
    from app.core.rbac import corporate_email_error

    email = req.email.strip().lower()
    domain = email.partition("@")[2] or None
    blocked = get_registration_config()["blocked_public_email_domains"]
    is_public = bool(domain and domain in blocked)
    error = corporate_email_error(email)
    return EmailCheckResponse(
        email=email,
        accepted=error is None,
        domain=domain,
        is_public_provider=is_public,
        message=error or f"Acceptable institutional domain ({domain}).",
    )


@router.get("/registration/rms")
def list_rms_route() -> Dict[str, Any]:
    """List all registered relationship managers in database."""
    init_db()
    rms = list_all_rms()
    return {"rms": rms, "count": len(rms)}


@router.get("/registration/access-tiers")
def access_tiers() -> Dict[str, Any]:
    """Access-tier catalogue used to render the RBAC section of the RM form."""
    cfg = get_registration_config()
    return {
        "tiers": [describe_rm_tier(key) for key in cfg["access_tiers"]],
        "permission_vocabulary": sorted(
            {p for t in cfg["access_tiers"].values() for p in t["permissions"]}
        ),
    }


@router.get("/registration/jurisdictions")
def jurisdictions() -> Dict[str, Any]:
    """Jurisdiction catalogue plus the product matrix each region permits."""
    cfg = get_registration_config()
    return {
        "jurisdictions": [
            {
                "code": code,
                **entry,
                "permitted_product_types": cfg["jurisdiction_product_matrix"].get(code, []),
                "registration_number_label": cfg["regulatory_numbers"][code]["label"],
                "registration_number_example": cfg["regulatory_numbers"][code].get("example"),
            }
            for code, entry in cfg["jurisdictions"].items()
        ]
    }


@router.post("/registration/rm", response_model=RMSRegistrationResponse)
def register_rm_route(req: RMSRegistration) -> RMSRegistrationResponse:
    """
    Register a Relationship Manager.

    Enforces, in order: institutional email domain, regulatory registration
    number format for the declared jurisdiction, and uniqueness of the employee
    id within the institution.
    """
    init_db()

    existing = find_rm_by_employee_id(
        req.access.institution, req.identity.employee_id
    )
    if existing is not None:
        raise AppError(
            409,
            "DUPLICATE_EMPLOYEE_ID",
            f"Employee id '{req.identity.employee_id}' is already registered at "
            f"{req.access.institution} (rm_id {existing['rm_id']}).",
        )

    if req.password is None:
        raise AppError(422, "PASSWORD_REQUIRED", "Set a password to secure your RM account.")

    response = register_rm_record(req)

    # Authorised products: honour what the RM asked for, clamped to the matrix.
    authorised = response.authorised_product_types
    denied = [
        pt
        for pt in req.compliance.product_types_authorised
        if pt.upper() not in {a.upper() for a in authorised}
    ]
    if denied:
        logger.info(
            "RM %s requested %s which jurisdiction %s does not permit; clamped to %s",
            req.identity.employee_id,
            denied,
            req.compliance.operating_jurisdiction,
            authorised,
        )

    auth_user_id = create_auth_user(
        email=response.corporate_email,
        password=req.password.get_secret_value(),
        user_type="rm",
        profile={
            "legal_name": response.legal_name,
            "employee_id": response.employee_id,
            "institution": response.institution,
            "branch_code": response.branch_code,
            "department": response.department,
            "access_tier": response.access_tier,
            "operating_jurisdiction": response.operating_jurisdiction,
            "authorised_product_types": authorised,
        },
    )
    rm_id: Optional[str] = None
    try:
        rm_id = register_rm(
            legal_name=response.legal_name,
            corporate_email=response.corporate_email,
            email_domain=response.email_domain,
            employee_id=response.employee_id,
            regulatory_registration_number=response.regulatory_registration_number,
            operating_jurisdiction=response.operating_jurisdiction,
            institution=response.institution,
            branch_code=response.branch_code,
            department=response.department,
            access_tier=response.access_tier,
            authorised_product_types=authorised,
            payload=req.model_dump(mode="json", exclude={"password"}),
        )
        update_auth_profile(auth_user_id, {"rm_id": rm_id})
    except Exception:
        if rm_id is not None:
            delete_rm_registration(rm_id)
        delete_auth_user(auth_user_id)
        raise

    return response.model_copy(
        update={
            "rm_id": rm_id,
            "registered_at": get_rm(rm_id)["created_at"],  # type: ignore[index]
        }
    )


@router.get("/registration/rm/{rm_id}")
def get_rm_route(rm_id: str) -> Dict[str, Any]:
    """Load an RM record together with their effective RBAC summary."""
    from app.core.rbac import rbac_summary

    record = get_rm(rm_id)
    if record is None:
        raise AppError(404, "RM_NOT_FOUND", f"Relationship manager {rm_id} not found.")
    return {
        **record,
        "rbac": rbac_summary(record["access_tier"], record["operating_jurisdiction"]),
        "disclaimer": RM_DISCLAIMER,
    }


@router.get("/registration/rm/{rm_id}/branch")
def get_branch_roster(rm_id: str) -> Dict[str, Any]:
    """
    Branch roster. Requires the `view_team_reports` permission – a junior RM or
    senior advisor cannot enumerate colleagues.
    """
    from app.core.rbac import has_permission

    record = get_rm(rm_id)
    if record is None:
        raise AppError(404, "RM_NOT_FOUND", f"Relationship manager {rm_id} not found.")

    if not has_permission(record["access_tier"], "view_team_reports"):
        raise AppError(
            403,
            "INSUFFICIENT_CLEARANCE",
            tier_cannot_finalise_reason(record["access_tier"])
            or "Branch Manager clearance is required to view branch reports.",
        )

    members: List[Dict[str, Any]] = list_branch_rms(
        record["institution"], record["branch_code"]
    )
    return {
        "institution": record["institution"],
        "branch_code": record["branch_code"],
        "count": len(members),
        "members": members,
    }


class ProductCheckRequest(BaseModel):
    rm_id: str
    product_type: str


class ProductCheckResponse(BaseModel):
    allowed: bool
    product_type: str
    jurisdiction: str
    reason: Optional[str] = None


@router.post("/registration/rm/{rm_id}/product-check", response_model=ProductCheckResponse)
def product_check(rm_id: str, req: ProductCheckRequest) -> ProductCheckResponse:
    """
    Can this RM configure this product type?

    Combines the jurisdiction matrix with the RM's own clearance.
    """
    record = get_rm(rm_id)
    if record is None:
        raise AppError(404, "RM_NOT_FOUND", f"Relationship manager {rm_id} not found.")

    requested = req.product_type.upper()
    reason = rm_product_error(record, requested)
    return ProductCheckResponse(
        allowed=reason is None,
        product_type=requested,
        jurisdiction=record["operating_jurisdiction"],
        reason=reason,
    )


@router.post("/registration/rm/{rm_id}/finalise", response_model=FinaliseResponse)
def finalise_configuration(
    rm_id: str, req: FinaliseRequest
) -> FinaliseResponse:
    """
    RBAC gate on confirming a product configuration.

    A Junior RM can simulate and draft but cannot confirm; the request is
    recorded as denied so the escalation is auditable.
    """
    record = get_rm(rm_id)
    if record is None:
        raise AppError(404, "RM_NOT_FOUND", f"Relationship manager {rm_id} not found.")

    if load_run(req.run_id) is None:
        raise AppError(404, "RUN_NOT_FOUND", f"Run {req.run_id} not found.")

    tier = record["access_tier"]
    perms = permissions_for_tier(tier)
    blocked_reason = tier_cannot_finalise_reason(tier)

    if PERM_FINALISE_CONFIGURATION not in perms:
        ts = record_finalisation(req.run_id, rm_id, False, tier, blocked_reason)
        logger.info(
            "RM %s (%s) denied finalisation of run %s: %s", rm_id, tier, req.run_id, blocked_reason
        )
        return FinaliseResponse(
            allowed=False,
            rm_id=rm_id,
            run_id=req.run_id,
            access_tier=tier,
            reason=blocked_reason,
            escalate_to=(tier_entry(tier) or {}).get("escalate_to"),
            finalised_at=ts,
        )

    ts = record_finalisation(req.run_id, rm_id, True, tier, req.note)
    return FinaliseResponse(
        allowed=True,
        rm_id=rm_id,
        run_id=req.run_id,
        access_tier=tier,
        reason=req.note,
        finalised_at=ts,
    )


@router.get("/registration/finalisations/{run_id}")
def finalisation_status(run_id: str, request: Request) -> Dict[str, Any]:
    """Who (if anyone) confirmed this configuration, and when."""
    if request.state.user.get("user_type") != "rm":
        raise AppError(403, "FORBIDDEN", "Finalisation records are restricted to relationship managers.")
    record = get_finalisation(run_id)
    if record is None:
        return {"run_id": run_id, "finalised": False, "detail": "Not finalised."}
    return {
        "run_id": record["run_id"],
        "finalised": bool(record["allowed"]),
        "rm_id": record["rm_id"],
        "access_tier": record["access_tier"],
        "reason": record["reason"],
        "finalised_at": record["finalised_at"],
    }
