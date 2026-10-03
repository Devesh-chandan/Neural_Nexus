"""
Equity-Linked Note (ELN) – barrier-coupon / reverse-convertible style.

Payoff (Section 6.1):
  coupon_total = P * coupon_pa * T
  breach (maturity monitoring)  = x  < barrier_pct
  breach (daily monitoring)     = path_min_x < barrier_pct
  redemption = P          if not breach
             = P * x      if breach  (daily: P * min(1, x))
  coupon_paid = coupon_total  unless coupon_conditional AND breach → 0
  final = redemption + coupon_paid
"""
from __future__ import annotations

from typing import Optional, Union

import numpy as np

from app.payoff.base import PayoffEngine
from app.schemas.product import ELNConfig


class ELNPayoff(PayoffEngine):

    def final_value(
        self,
        config: ELNConfig,
        x: Union[float, np.ndarray],
        path_min_x: Optional[Union[float, np.ndarray]] = None,
    ) -> np.ndarray:
        x = np.atleast_1d(np.asarray(x, dtype=float))
        P = config.principal
        T = config.tenor_months / 12.0
        coupon_total = P * config.coupon_pa * T

        # Determine breach
        if config.barrier_monitoring == "daily" and path_min_x is not None:
            pmx = np.atleast_1d(np.asarray(path_min_x, dtype=float))
            breach = pmx < config.barrier_pct
        else:
            breach = x < config.barrier_pct  # barrier holds when x == barrier_pct

        # Redemption
        if config.barrier_monitoring == "daily":
            # On daily monitoring breach: client receives P * min(1, x)
            redemption_breach = P * np.minimum(1.0, x)
        else:
            redemption_breach = P * x

        redemption = np.where(breach, redemption_breach, P)

        # Coupon
        if config.coupon_conditional:
            coupon_paid = np.where(breach, 0.0, coupon_total)
        else:
            coupon_paid = coupon_total

        return redemption + coupon_paid

    def describe(self, config: ELNConfig) -> dict:
        T = config.tenor_months / 12.0
        return {
            "product_type": "ELN",
            "underlying": config.underlying,
            "tenor_months": config.tenor_months,
            "barrier_pct": config.barrier_pct,
            "coupon_pa": config.coupon_pa,
            "coupon_total_pct": config.coupon_pa * T,
            "coupon_conditional": config.coupon_conditional,
            "barrier_monitoring": config.barrier_monitoring,
            "principal": config.principal,
            "currency": config.currency,
        }
