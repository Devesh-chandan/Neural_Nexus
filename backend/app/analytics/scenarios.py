"""
Deterministic scenario table (Section 6.4).

Fixed shocks applied to S0; special PS scenarios labelled explicitly.
For DCD, shocks apply to FX spot; adverse direction is upward.
"""
from __future__ import annotations

from typing import List

import numpy as np

from app.core.config import get_products_config
from app.payoff import annualised_return, DCDPayoff, get_engine, net_return
from app.schemas.analysis import ScenarioRow

# The three named PS scenarios (shock values)
PS_SCENARIOS = {-0.10: "10% drop", 0.0: "Sideways (flat)", 0.10: "10% rally"}


def build_scenario_table(
    config: object,
    s0: float,
    shocks: List[float] | None = None,
) -> List[ScenarioRow]:
    """
    Build the scenario table for a product config.

    shocks: list of fractional changes to apply to S0.
            Defaults to the configured list in products.yaml.
    s0: current/initial underlying level.
    """
    cfg = get_products_config()
    if shocks is None:
        shocks = cfg["scenario_shocks"]

    engine = get_engine(config.product_type)  # type: ignore[attr-defined]
    P = config.principal  # type: ignore[attr-defined]
    T = config.tenor_months / 12.0  # type: ignore[attr-defined]
    is_dcd = config.product_type == "DCD"  # type: ignore[attr-defined]

    rows: List[ScenarioRow] = []
    for shock in shocks:
        x_ratio = 1.0 + shock  # ST / S0

        # For daily monitoring ELN: straight path assumption → path_min = min(1, x)
        if hasattr(config, "barrier_monitoring") and config.barrier_monitoring == "daily":  # type: ignore[attr-defined]
            path_min_x = min(1.0, x_ratio)
        else:
            path_min_x = None

        if is_dcd:
            dcd_engine: DCDPayoff = engine  # type: ignore[assignment]
            final = float(dcd_engine.final_value_with_s0(config, np.array([x_ratio]), s0=s0)[0])  # type: ignore[arg-type]
        else:
            final = float(engine.final_value(config, np.array([x_ratio]), path_min_x)[0])  # type: ignore[arg-type]

        nr = float(net_return(np.array([final]), P)[0])
        ar = float(annualised_return(np.array([final]), P, T)[0])

        label = PS_SCENARIOS.get(shock, f"{shock:+.0%}")
        is_ps = shock in PS_SCENARIOS

        rows.append(
            ScenarioRow(
                shock=round(shock, 4),
                x=round(x_ratio, 4),
                final=round(final, 2),
                net_return=round(nr, 6),
                annualised_return=round(ar, 6),
                label=label,
                is_ps_scenario=is_ps,
            )
        )

    return rows
