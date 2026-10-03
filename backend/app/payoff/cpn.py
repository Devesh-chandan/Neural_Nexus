"""
Capital-Protected Note (CPN) payoff.

Payoff (Section 6.2):
  gain = participation_pct * max(0, x - 1)
  if cap_pct: gain = min(gain, cap_pct)
  final = P * (protection_pct + gain)
"""
from __future__ import annotations

from typing import Optional, Union

import numpy as np

from app.payoff.base import PayoffEngine
from app.schemas.product import CPNConfig


class CPNPayoff(PayoffEngine):

    def final_value(
        self,
        config: CPNConfig,
        x: Union[float, np.ndarray],
        path_min_x: Optional[Union[float, np.ndarray]] = None,
    ) -> np.ndarray:
        x = np.atleast_1d(np.asarray(x, dtype=float))
        P = config.principal

        gain = config.participation_pct * np.maximum(0.0, x - 1.0)
        if config.cap_pct is not None:
            gain = np.minimum(gain, config.cap_pct)

        return P * (config.protection_pct + gain)

    def describe(self, config: CPNConfig) -> dict:
        return {
            "product_type": "CPN",
            "underlying": config.underlying,
            "tenor_months": config.tenor_months,
            "protection_pct": config.protection_pct,
            "participation_pct": config.participation_pct,
            "cap_pct": config.cap_pct,
            "principal": config.principal,
            "currency": config.currency,
        }
