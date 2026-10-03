"""Client profile schema."""
from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field, computed_field


class ClientProfile(BaseModel):
    client_name: str
    risk_appetite: Literal["conservative", "moderate", "aggressive"]
    horizon_months: int = Field(ge=3, le=120)
    loss_tolerance_pct: float = Field(ge=0, le=100)
    investable_assets: float = Field(gt=0)
    investment_amount: float = Field(gt=0)
    existing_exposure_underlying_pct: float = Field(default=0.0, ge=0, le=100)
    existing_structured_pct: float = Field(default=0.0, ge=0, le=100)
    experience: Literal["novice", "intermediate", "experienced"] = "novice"
    target_return_pa: Optional[float] = None
    preferred_underlying_types: Optional[List[str]] = None
    needs_liquidity_within_months: Optional[int] = None

    @computed_field  # type: ignore[misc]
    @property
    def amount_pct_of_assets(self) -> float:
        if self.investable_assets <= 0:
            return 0.0
        return self.investment_amount / self.investable_assets
