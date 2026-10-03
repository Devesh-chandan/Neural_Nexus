"""
Dual Currency Deposit (DCD) payoff.

Convention (Section 6.3):
  Pair quoted ALT per BASE (e.g. USDINR: INR per USD).
  Principal P is in BASE currency.
  maturity_amount_base = P * (1 + interest_pa * T)
  if S <= K: client receives maturity_amount_base (in BASE)
  if S >  K: bank converts at strike: client receives maturity_amount_base * K in ALT
             base-currency equivalent = maturity_amount_base * K / S
  x here = S / S0  (FX spot ratio)

  Adverse direction: S rising (BASE strengthening vs ALT → converted at lower strike).
"""
from __future__ import annotations

from typing import Optional, Union

import numpy as np

from app.payoff.base import PayoffEngine
from app.schemas.product import DCDConfig


class DCDPayoff(PayoffEngine):

    def final_value(
        self,
        config: DCDConfig,
        x: Union[float, np.ndarray],
        path_min_x: Optional[Union[float, np.ndarray]] = None,
        s0: Optional[float] = None,
    ) -> np.ndarray:
        """
        x = S_T / S_0 (FX spot ratio at maturity).
        Returns base-currency equivalent.
        s0 is needed to recover the absolute FX spot; if not provided, compute from config.strike if available.
        When called from replay/scenario, x is the ratio, and s0 must be passed separately.
        """
        x = np.atleast_1d(np.asarray(x, dtype=float))
        P = config.principal
        T = config.tenor_months / 12.0
        K = config.strike

        mat_amount = P * (1.0 + config.interest_pa * T)

        # S_T absolute = S0 * x, but for payoff we only need S_T relative to K.
        # If S0 is provided compute absolute; otherwise treat x as S_T directly.
        if s0 is not None:
            S_T = s0 * x
        else:
            # Fallback: treat x as S_T / S0 with S0 unknown; use S_T = K when x = K/S0
            # In this mode, conversion happens when x > K/S0 which we can't know.
            # This path is only used by the payoff curve (x = S_T/S0).
            # We'll require s0 or approximate by treating conversion threshold as strike ratio.
            # For the payoff curve we call with s0 explicitly.
            S_T = x  # fallback: treat x as ratio (conversion threshold at 1.0 * strike/S0)

        converted = S_T > K
        final_base = np.where(
            converted,
            mat_amount * K / S_T,
            mat_amount,
        )
        return final_base

    def final_value_with_s0(
        self,
        config: DCDConfig,
        x: Union[float, np.ndarray],
        s0: float,
        path_min_x: Optional[Union[float, np.ndarray]] = None,
    ) -> np.ndarray:
        """Convenience wrapper that passes s0 explicitly."""
        return self.final_value(config, x, path_min_x=path_min_x, s0=s0)

    def alt_amount(
        self,
        config: DCDConfig,
        x: Union[float, np.ndarray],
        s0: float,
    ) -> np.ndarray:
        """Return the amount in ALT currency for converted cases."""
        x = np.atleast_1d(np.asarray(x, dtype=float))
        P = config.principal
        T = config.tenor_months / 12.0
        mat_amount = P * (1.0 + config.interest_pa * T)
        S_T = s0 * x
        converted = S_T > config.strike
        return np.where(converted, mat_amount * config.strike, 0.0)

    def describe(self, config: DCDConfig) -> dict:
        return {
            "product_type": "DCD",
            "underlying": config.underlying,
            "tenor_months": config.tenor_months,
            "strike": config.strike,
            "interest_pa": config.interest_pa,
            "base_currency": config.base_currency,
            "alt_currency": config.alt_currency,
            "principal": config.principal,
        }
