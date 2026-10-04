"""Client profile schema.

Two layers:

* `ClientProfile` – the analytical profile the pricing / analytics / suitability
  engines consume. Every field here is used in a computation.
* KYC identity and capacity fields (`date_of_birth`, `liquid_net_worth`, …) are
  carried on the same object so a single document flows from registration into
  the audit trail. They are all optional, which keeps older callers working and
  lets a partially-known profile still be analysed.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from typing import List, Literal, Optional

from pydantic import BaseModel, Field, computed_field


class ClientProfile(BaseModel):
    client_name: str

    # ── Core suitability metrics (PS lock) ─────────────────────────────────
    risk_appetite: Literal["conservative", "moderate", "aggressive"]
    horizon_months: int = Field(ge=3, le=120)
    loss_tolerance_pct: float = Field(ge=0, le=100)
    investable_assets: float = Field(gt=0)
    # Planned ticket size. Unknown (None) until the client states it; when a specific
    # product is assessed, the product's principal is the amount being invested.
    investment_amount: Optional[float] = Field(default=None, gt=0)
    existing_exposure_underlying_pct: float = Field(default=0.0, ge=0, le=100)
    # Share already held in structured products; None when the record does not say.
    existing_structured_pct: Optional[float] = Field(default=None, ge=0, le=100)
    experience: Literal["novice", "intermediate", "experienced"] = "novice"
    target_return_pa: Optional[float] = None
    preferred_underlying_types: Optional[List[str]] = None
    needs_liquidity_within_months: Optional[int] = None

    # ── KYC & identity (registration) ─────────────────────────────────────
    date_of_birth: Optional[date] = None
    employment_status: Optional[str] = None
    national_tax_id: Optional[str] = None
    kyc_verified: bool = False
    kyc_source: Optional[Literal["manual", "broker_import"]] = None
    kyc_provider: Optional[str] = None

    # ── Financial capacity (registration) ─────────────────────────────────
    liquid_net_worth: Optional[float] = Field(default=None, gt=0)
    annual_income: Optional[float] = Field(default=None, gt=0)
    source_of_funds: Optional[str] = None
    previous_investment_exposure_pct: Optional[float] = Field(default=None, ge=0, le=100)

    def stored_dict(self) -> dict:
        """The answers as persisted: derived (computed) fields are recalculated on load."""
        return self.model_dump(
            mode="json",
            exclude={"amount_pct_of_assets", "age_years", "allocation_of_liquid_net_worth", "income_multiple"},
        )

    @computed_field  # type: ignore[misc]
    @property
    def amount_pct_of_assets(self) -> Optional[float]:
        if self.investment_amount is None or self.investable_assets <= 0:
            return None
        return self.investment_amount / self.investable_assets

    @computed_field  # type: ignore[misc]
    @property
    def age_years(self) -> Optional[int]:
        """Completed years since date of birth, or None when KYC age is unknown."""
        if self.date_of_birth is None:
            return None
        today = datetime.now(timezone.utc).date()
        dob = self.date_of_birth
        if isinstance(dob, datetime):
            dob = dob.date()
        years = today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))
        return max(0, years)

    @computed_field  # type: ignore[misc]
    @property
    def allocation_of_liquid_net_worth(self) -> Optional[float]:
        """Investment amount as a share of liquid net worth (None if unknown)."""
        if not self.liquid_net_worth or self.investment_amount is None:
            return None
        return self.investment_amount / self.liquid_net_worth

    @computed_field  # type: ignore[misc]
    @property
    def income_multiple(self) -> Optional[float]:
        """Investment amount as a multiple of annual income (None if unknown)."""
        if not self.annual_income or self.investment_amount is None:
            return None
        return self.investment_amount / self.annual_income
