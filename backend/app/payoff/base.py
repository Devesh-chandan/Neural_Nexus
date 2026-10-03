"""
Payoff engine base interface.

All payoff implementations must inherit from PayoffEngine and implement:
  - final_value(config, x, path_min_x=None) → np.ndarray
  - describe(config) → dict (human-readable summary)
"""
from __future__ import annotations

import abc
from typing import Optional, Union

import numpy as np


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
