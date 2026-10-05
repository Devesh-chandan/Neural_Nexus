"""
Payoff engines for the analytics: thin vector adapters from product configs and terminal ratios onto
the shared payoff core in `app.simulation.sim_engine.payoffs` (the single implementation of every
formula; see that module for the payoff rules).

  * `PayoffEngine`   common interface; `get_engine(product_type)` returns the right engine
  * `ELNPayoff`      x = S_T / S_0 and the lowest close `path_min_x`; straight-line path if not given
  * `CPNPayoff`      x = S_T / S_0
  * `DCDPayoff`      needs the reference spot `s0` (the strike is absolute); interest by days / 365
  * `net_return`, `annualised_return`   return helpers
"""
from __future__ import annotations

import abc
import datetime as dt
from typing import Optional, Union

import numpy as np
import pandas as pd

from app.schemas.product import CPNConfig, DCDConfig, ELNConfig
from app.simulation.sim_engine.payoffs import cpn_money, dcd_money, eln_money
from app.simulation.sim_engine.windows import add_tenor


class PayoffEngine(abc.ABC):
    """Abstract base for all product payoff engines."""

    @abc.abstractmethod
    def final_value(
        self,
        config: object,
        x: Union[float, np.ndarray],
        path_min_x: Optional[Union[float, np.ndarray]] = None,
    ) -> np.ndarray:
        """
        Compute total final value (redemption + income) for terminal ratio(s) x = ST/S0.

        x can be a scalar or 1-D numpy array.
        path_min_x is the minimum of close/S0 along the path (for daily barrier monitoring).
        Returns an ndarray of the same shape as x.
        """

    @abc.abstractmethod
    def describe(self, config: object) -> dict:
        """Return a human-readable parameter summary."""


def net_return(final: np.ndarray, principal: float) -> np.ndarray:
    """net_return = final / P - 1"""
    return final / principal - 1.0


def annualised_return(final: np.ndarray, principal: float, tenor_years: float) -> np.ndarray:
    """annualised_return = (final/P)^(1/T) - 1"""
    ratio = np.maximum(final / principal, 1e-10)  # avoid log(0)
    return ratio ** (1.0 / tenor_years) - 1.0


def observed_low(config: ELNConfig, x: np.ndarray, path_min_x: Optional[Union[float, np.ndarray]]) -> np.ndarray:
    """Lowest close relevant to the barrier, given the monitoring convention."""
    straight = np.minimum(1.0, x)
    if config.barrier_monitoring == "daily" and path_min_x is not None:
        return np.minimum(np.atleast_1d(np.asarray(path_min_x, dtype=float)), straight)
    return straight


class ELNPayoff(PayoffEngine):

    def _money_and_hit(self, config: ELNConfig, x, path_min_x):
        x = np.atleast_1d(np.asarray(x, dtype=float))
        return eln_money(
            x, observed_low(config, x, path_min_x), config.principal, config.coupon_pa,
            config.tenor_months, config.strike_pct, config.barrier_pct, config.coupon_conditional,
        )

    def final_value(
        self,
        config: ELNConfig,
        x: Union[float, np.ndarray],
        path_min_x: Optional[Union[float, np.ndarray]] = None,
    ) -> np.ndarray:
        return self._money_and_hit(config, x, path_min_x)[0]

    def barrier_hit(
        self,
        config: ELNConfig,
        x: Union[float, np.ndarray],
        path_min_x: Optional[Union[float, np.ndarray]] = None,
    ) -> np.ndarray:
        return self._money_and_hit(config, x, path_min_x)[1]

    def describe(self, config: ELNConfig) -> dict:
        T = config.tenor_months / 12.0
        return {
            "product_type": "ELN",
            "underlying": config.underlying,
            "tenor_months": config.tenor_months,
            "strike_pct": config.strike_pct,
            "barrier_pct": config.barrier_pct,
            "coupon_pa": config.coupon_pa,
            "coupon_total_pct": config.coupon_pa * T,
            "coupon_conditional": config.coupon_conditional,
            "barrier_monitoring": config.barrier_monitoring,
            "principal": config.principal,
            "currency": config.currency,
        }


class CPNPayoff(PayoffEngine):

    def final_value(
        self,
        config: CPNConfig,
        x: Union[float, np.ndarray],
        path_min_x: Optional[Union[float, np.ndarray]] = None,
    ) -> np.ndarray:
        return cpn_money(
            x, config.principal, 0.0, config.tenor_months,
            config.protection_pct, config.participation_pct, config.cap_pct,
        )

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


def accrual_days(config: DCDConfig, start: Optional[dt.date] = None) -> int:
    """Contractual calendar days of interest accrual for the tenor from the trade date."""
    start_ts = pd.Timestamp(start or config.start_date or dt.date.today())
    return max(1, int((add_tenor(start_ts, config.tenor_months) - start_ts).days))


class DCDPayoff(PayoffEngine):

    def _money(self, config: DCDConfig, x, ref: float, strike: float):
        return dcd_money(x, config.principal, config.interest_pa, accrual_days(config), ref, strike, 1.0, False)

    def final_value(
        self,
        config: DCDConfig,
        x: Union[float, np.ndarray],
        path_min_x: Optional[Union[float, np.ndarray]] = None,
        s0: Optional[float] = None,
    ) -> np.ndarray:
        """Base-currency value for spot ratio(s) x = S_T/S_0. `s0` is required (the strike is absolute)."""
        if s0 is None or not s0 > 0:
            raise ValueError("DCD payoff needs the positive reference spot s0 the strike is quoted against.")
        return self._money(config, x, s0, config.strike)[0]

    def final_value_with_s0(
        self,
        config: DCDConfig,
        x: Union[float, np.ndarray],
        s0: float,
        path_min_x: Optional[Union[float, np.ndarray]] = None,
    ) -> np.ndarray:
        return self.final_value(config, x, path_min_x=path_min_x, s0=s0)

    def final_value_rel(
        self,
        config: DCDConfig,
        x: Union[float, np.ndarray],
        strike_ratio: float,
    ) -> np.ndarray:
        """Value for ratios x = S_T/S_start with the strike expressed as K/S_start (historical windows)."""
        return self._money(config, x, 1.0, strike_ratio)[0]

    def converted(self, config: DCDConfig, x: Union[float, np.ndarray], s0: float) -> np.ndarray:
        return self._money(config, x, s0, config.strike)[1]

    def alt_amount(
        self,
        config: DCDConfig,
        x: Union[float, np.ndarray],
        s0: float,
    ) -> np.ndarray:
        """Amount in the alt currency for converted cases (0 when not converted)."""
        total = config.principal * (1.0 + config.interest_pa * accrual_days(config) / 365.0)
        return np.where(self.converted(config, x, s0), total * config.strike, 0.0)

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


_REGISTRY: dict[str, PayoffEngine] = {
    "ELN": ELNPayoff(),
    "CPN": CPNPayoff(),
    "DCD": DCDPayoff(),
}


def get_engine(product_type: str) -> PayoffEngine:
    engine = _REGISTRY.get(product_type.upper())
    if engine is None:
        raise ValueError(f"Unknown product type: {product_type}")
    return engine
