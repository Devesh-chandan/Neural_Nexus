"""
Client KYC registration and RM (Relationship Manager) registration schemas.

Two onboarding paths are supported for a client:

* **Manual** – the client answers every question themselves.
* **Import from KYC** – the client links an existing brokerage / wealth app
  (Kite, Zerodha Console, Groww, Cred) and the identity + financial fields are
  pre-filled from that provider. Suitability answers are *always* asked
  directly, because risk appetite is a self-assessment, not an account fact.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from app.schemas.client import ClientProfile

# ── Vocabularies ─────────────────────────────────────────────────────────────

RiskAppetite = Literal["conservative", "moderate", "aggressive"]
Experience = Literal["novice", "intermediate", "experienced"]

EmploymentStatus = Literal[
    "salaried",
    "self_employed",
    "business_owner",
    "professional",
    "student",
    "retired",
    "homemaker",
    "not_specified",
]

SourceOfFunds = Literal[
    "salary",
    "business_income",
    "freelance",
    "investment_proceeds",
    "property_sale",
    "inheritance",
    "business_sale",
    "gift",
    "loan",
    "other",
]

BrokerProvider = Literal["kite", "zerodha_console", "groww", "cred"]

AccessTier = Literal["junior_rm", "senior_advisor", "branch_manager"]

Jurisdiction = Literal["IN", "US", "UK", "AE", "SG", "EU", "HK", "AU"]

KycSource = Literal["manual", "broker_import"]


# ── 1. Primary information (KYC & identity) ─────────────────────────────────

class KYCIdentity(BaseModel):
    """Section 1 of client registration: KYC and identity."""

    legal_name: str = Field(
        min_length=2,
        max_length=120,
        description="Full legal name exactly as it appears on your government ID.",
    )
    date_of_birth: date = Field(
        description="Date of birth. Drives life-stage and retirement-horizon checks.",
    )
    employment_status: EmploymentStatus = "not_specified"
    national_tax_id: Optional[str] = Field(
        default=None,
        max_length=32,
        description=(
            "PAN / Aadhaar-masked / SSN / TIN. Optional for the demo; "
            "mandatory for production KYC and fraud controls."
        ),
    )

    @field_validator("legal_name")
    @classmethod
    def _normalise_name(cls, v: str) -> str:
        cleaned = " ".join(v.split())
        if len(cleaned) < 2:
            raise ValueError("Legal name must be at least 2 characters.")
        if any(ch.isdigit() for ch in cleaned):
            raise ValueError("Legal name cannot contain digits.")
        return cleaned

    @field_validator("national_tax_id")
    @classmethod
    def _validate_tax_id(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        cleaned = v.strip().upper()
        if not cleaned:
            return None
        if not all(ch.isalnum() or ch in "-*" for ch in cleaned):
            raise ValueError("Tax identifier may contain letters, digits, '-' and '*' only.")
        return cleaned

    @property
    def age_years(self) -> int:
        """Completed years since date of birth, clamped at 0."""
        today = datetime.now(timezone.utc).date()
        dob = self.date_of_birth
        if isinstance(dob, datetime):
            dob = dob.date()
        years = today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))
        return max(0, years)


# ── 2. Financial information (capacity) ─────────────────────────────────────

class KYCFinancials(BaseModel):
    """Section 2 of client registration: capacity to absorb a loss."""

    liquid_net_worth: float = Field(
        gt=0,
        description=(
            "Cash and investments realisable within 7 days. Excludes your primary home."
        ),
    )
    annual_income: float = Field(
        gt=0,
        description="Expected yearly income before taxes.",
    )
    source_of_funds: Optional[SourceOfFunds] = Field(
        default=None,
        description="How the money being invested today was generated (AML evidence).",
    )
    previous_investment_exposure_pct: float = Field(
        default=0.0,
        ge=0,
        le=100,
        description=(
            "Share of liquid net worth already invested in comparable complex products."
        ),
    )
    investment_amount: float = Field(
        gt=0,
        description="Amount being invested in this specific product.",
    )

    @model_validator(mode="after")
    def _check_amount(self) -> "KYCFinancials":
        if self.investment_amount > self.liquid_net_worth:
            raise ValueError(
                "Investment amount cannot exceed liquid net worth – the position "
                "would not be affordable."
            )
        if self.previous_investment_exposure_pct > 100:
            raise ValueError("Previous exposure must be between 0% and 100%.")
        return self

    @property
    def allocation_of_liquid_net_worth(self) -> float:
        return self.investment_amount / self.liquid_net_worth


# ── 3. Core suitability metrics (PS lock) ────────────────────────────────────

class SuitabilityAnswers(BaseModel):
    """Section 3 of client registration.

    All four fields are strictly mandatory: every feature must map to a
    Product-Suitability (PS) requirement, so these answers can never be
    inferred or defaulted.
    """

    risk_appetite: RiskAppetite
    investment_horizon_years: float = Field(
        ge=0.25, le=10.0,
        description="Years the money can stay locked without being touched.",
    )
    loss_tolerance_pct: float = Field(
        ge=0, le=100,
        description=(
            "Maximum percentage of this investment that could be permanently lost "
            "without affecting lifestyle."
        ),
    )
    current_portfolio_concentration_pct: float = Field(
        ge=0, le=100,
        description=(
            "Percentage of total wealth already invested in similar complex products."
        ),
    )
    experience: Experience = "novice"

    @field_validator("loss_tolerance_pct")
    @classmethod
    def _check_tolerance(cls, v: float) -> float:
        if v > 100:
            raise ValueError("Loss tolerance must be between 0% and 100%.")
        return v


# ── Brokerage / wealth-app link ─────────────────────────────────────────────

class BrokerLink(BaseModel):
    """A client's link to an existing trading / wealth app."""

    provider: BrokerProvider
    handle: str = Field(min_length=2, max_length=64)
    linked_at: Optional[str] = None

    @field_validator("handle")
    @classmethod
    def _strip(cls, v: str) -> str:
        return v.strip()


# ── Composite client registration ────────────────────────────────────────────

class ClientRegistration(BaseModel):
    """Full client registration payload (KYC + financials + suitability)."""

    identity: KYCIdentity
    financials: KYCFinancials
    suitability: SuitabilityAnswers
    broker_link: Optional[BrokerLink] = None
    consent_kyc: bool = Field(
        default=False,
        description="Client consents to KYC data being held for suitability assessment.",
    )
    consent_sof: bool = Field(
        default=False,
        description="Client attests the declared source of funds is accurate (AML).",
    )

    @model_validator(mode="after")
    def _require_consent(self) -> "ClientRegistration":
        if not self.consent_kyc:
            raise ValueError(
                "KYC consent is required before a client profile can be registered."
            )
        if self.broker_link is not None and not self.consent_sof:
            # Broker-imported clients must also attest source of funds.
            raise ValueError(
                "Clients importing data from a broker must attest their source of funds."
            )
        return self

    @property
    def kyc_source(self) -> KycSource:
        return "broker_import" if self.broker_link is not None else "manual"


class ClientRegistrationResponse(BaseModel):
    """What the client gets back after a successful registration."""

    case_id: str
    client_name: str
    kyc_source: KycSource
    kyc_verified: bool
    kyc_flags: List[str]
    age_years: int
    profile: ClientProfile
    next_step: str = "run_recommendation"
    portal_account_id: Optional[str] = None
    portal_account_error: Optional[str] = None


# ── KYC import ───────────────────────────────────────────────────────────────

class KycImportRequest(BaseModel):
    provider: BrokerProvider
    handle: str = Field(min_length=2, max_length=64)


class KycImportResponse(BaseModel):
    """Pre-filled draft returned by a KYC import.

    Deliberately omits source of funds and every suitability answer: those must
    come from the client, not from a brokerage account.
    """

    provider: BrokerProvider
    provider_label: str
    handle_masked: str
    linked_at: str
    scope_granted: List[str]
    identity: Dict[str, Any]
    financials: Dict[str, Any]
    kyc_verified: bool
    kyc_flags: List[str]
    fields_prefilled: List[str]
    fields_still_required: List[str]
    disclaimer: str


class ProviderInfo(BaseModel):
    key: str
    label: str
    category: str
    auth: str
    scopes: List[str]
    notes: str


class ProvidersResponse(BaseModel):
    providers: List[ProviderInfo]
    disclaimer: str


# ── RM registration ──────────────────────────────────────────────────────────

class RMSIdentity(BaseModel):
    """RM section 1: identity and authentication."""

    legal_name: str = Field(min_length=2, max_length=120)
    corporate_email: str = Field(min_length=3, max_length=160)
    employee_id: str = Field(
        min_length=2,
        max_length=48,
        description="Primary key for the RM inside the institution's directory.",
    )

    @field_validator("legal_name")
    @classmethod
    def _normalise(cls, v: str) -> str:
        cleaned = " ".join(v.split())
        if len(cleaned) < 2:
            raise ValueError("Full legal name must be at least 2 characters.")
        return cleaned

    @field_validator("corporate_email", "employee_id")
    @classmethod
    def _strip(cls, v: str) -> str:
        return v.strip()


class RMSCompliance(BaseModel):
    """RM section 2: regulatory and compliance (auditability)."""

    regulatory_registration_number: str = Field(min_length=4, max_length=32)
    operating_jurisdiction: Jurisdiction
    product_types_authorised: List[str] = Field(default_factory=list)

    @field_validator("regulatory_registration_number")
    @classmethod
    def _upper(cls, v: str) -> str:
        return v.strip().upper()


class RMSAccess(BaseModel):
    """RM section 3: role-based access control and multi-tenancy."""

    institution: str = Field(min_length=2, max_length=120)
    branch_code: str = Field(min_length=1, max_length=48)
    department: Optional[str] = Field(default=None, max_length=80)
    access_tier: AccessTier

    @field_validator("institution", "branch_code")
    @classmethod
    def _strip(cls, v: str) -> str:
        return v.strip()


class RMSRegistration(BaseModel):
    identity: RMSIdentity
    compliance: RMSCompliance
    access: RMSAccess

    @model_validator(mode="after")
    def _validate(self) -> "RMSRegistration":
        from app.core.rbac import (
            corporate_email_error,
            regulatory_number_error,
        )

        if err := corporate_email_error(self.identity.corporate_email):
            raise ValueError(err)
        if err := regulatory_number_error(
            self.compliance.regulatory_registration_number,
            self.compliance.operating_jurisdiction,
        ):
            raise ValueError(err)
        return self


class RMSRegistrationResponse(BaseModel):
    rm_id: str
    legal_name: str
    corporate_email: str
    email_domain: str
    employee_id: str
    institution: str
    branch_code: str
    department: Optional[str]
    access_tier: str
    regulatory_registration_number: str
    operating_jurisdiction: str
    authorised_product_types: List[str]
    rbac: Dict[str, Any]
    registered_at: str
    next_step: str = "rm_workspace"


# ── RBAC authorisation guard (used when an RM acts on a run) ────────────────

class FinaliseRequest(BaseModel):
    """An RM asks to confirm / finalise a product configuration."""

    rm_id: str
    run_id: str
    note: Optional[str] = Field(default=None, max_length=500)


class FinaliseResponse(BaseModel):
    allowed: bool
    rm_id: str
    run_id: str
    access_tier: str
    reason: Optional[str] = None
    escalate_to: Optional[str] = None
    finalised_at: Optional[str] = None
