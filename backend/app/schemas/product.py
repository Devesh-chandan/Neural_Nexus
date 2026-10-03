"""Product configuration schemas (discriminated union on product_type)."""
from __future__ import annotations

from typing import Annotated, Literal, Optional, Union

from pydantic import BaseModel, Field, field_validator, model_validator


class ELNConfig(BaseModel):
    product_type: Literal["ELN"] = "ELN"
    underlying: str
    tenor_months: int = Field(ge=3, le=36)
    principal: float = Field(gt=0)
    currency: str = "INR"
    barrier_pct: float = Field(ge=0.40, le=0.95)
    coupon_pa: float = Field(ge=0.00, le=0.40)
    coupon_conditional: bool = False
    barrier_monitoring: Literal["maturity", "daily"] = "maturity"


class CPNConfig(BaseModel):
    product_type: Literal["CPN"] = "CPN"
    underlying: str
    tenor_months: int = Field(ge=3, le=36)
    principal: float = Field(gt=0)
    currency: str = "INR"
    protection_pct: float = Field(ge=0.80, le=1.00)
    participation_pct: float = Field(ge=0.10, le=2.00)
    cap_pct: Optional[float] = Field(default=None, ge=0.0, le=5.0)


class DCDConfig(BaseModel):
    product_type: Literal["DCD"] = "DCD"
    underlying: str   # must be an FX key
    tenor_months: int = Field(ge=3, le=36)
    principal: float = Field(gt=0)
    currency: str  # base currency of the deposit
    strike: float = Field(gt=0)
    interest_pa: float = Field(ge=0.00, le=0.30)
    base_currency: str
    alt_currency: str

    @model_validator(mode="after")
    def currency_match(self) -> "DCDConfig":
        if self.currency != self.base_currency:
            self.currency = self.base_currency
        return self


ProductConfig = Annotated[
    Union[ELNConfig, CPNConfig, DCDConfig],
    Field(discriminator="product_type"),
]


def parse_product_dict(data: dict) -> Union[ELNConfig, CPNConfig, DCDConfig]:
    """Dispatch a raw {product_type, ...} dict to the matching config model.

    Raises ValueError (via pydantic) on an unknown/missing product_type or invalid fields;
    callers are expected to wrap this in their own error handling.
    """
    pt = str(data.get("product_type", "")).upper()
    if pt == "ELN":
        return ELNConfig(**data)
    if pt == "CPN":
        return CPNConfig(**data)
    if pt == "DCD":
        return DCDConfig(**data)
    raise ValueError(f"Unknown product_type: {pt}")
