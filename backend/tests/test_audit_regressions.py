"""Regression tests for bugs found in the end-to-end audit."""
import numpy as np
import pandas as pd
import pytest

from app.market import service
from app.schemas.product import parse_product_dict


@pytest.mark.parametrize("field,value", [("principal", "inf"), ("principal", 1e300), ("strike", "inf"), ("strike", 0.0)])
def test_dcd_rejects_non_finite_or_absurd_numbers(field, value):
    d = dict(product_type="DCD", underlying="USDINR", tenor_months=6, principal=1e5, strike=100.0, interest_pa=0.08)
    d[field] = value
    with pytest.raises(ValueError):
        parse_product_dict(d)


def test_dcd_strike_must_be_near_spot():
    from app.analytics.metrics import compute_metrics
    from app.core.errors import AppError
    idx = pd.bdate_range("2015-01-01", periods=1500)
    s = pd.Series(np.full(1500, 80.0), index=idx)
    c = parse_product_dict(dict(product_type="DCD", underlying="USDINR", tenor_months=6,
                                principal=1e5, strike=8000.0, interest_pa=0.08))
    with pytest.raises(AppError):
        compute_metrics(c, s)


def test_market_memo_not_poisoned_by_date_window():
    service.invalidate_memo()
    full, *_ = service.get_history("NIFTY50")
    windowed, *_ = service.get_history("NIFTY50", start=str(full.index[-1000].date()))
    again, *_ = service.get_history("NIFTY50")
    assert len(again) == len(full) > len(windowed)





def test_uncapped_cpn_has_no_max_gain_and_text_says_unlimited():
    from app.analytics.metrics import _max_gain_loss, _payoff_curve
    c = parse_product_dict(dict(product_type="CPN", underlying="NIFTY50", tenor_months=24,
                                principal=1e6, protection_pct=1.0, participation_pct=0.8))
    gain, _ = _max_gain_loss(c, _payoff_curve(c, 100.0))
    assert gain is None
    from app.analytics.metrics import compute_metrics
    from app.market.service import get_history
    m = compute_metrics(c, get_history("NIFTY50")[0]["close"])
    assert m.max_gain_pct is None and m.max_gain_label == "Uncapped · 80% of any rise"
    capped = parse_product_dict(dict(product_type="CPN", underlying="NIFTY50", tenor_months=24,
                                     principal=1e6, protection_pct=1.0, participation_pct=0.8, cap_pct=0.3))
    assert _max_gain_loss(capped, _payoff_curve(capped, 100.0))[0] == pytest.approx(0.3)


def test_worst_replay_loss_above_tolerance_fails_loss_check():
    from app.assessment.unified import assess_product
    from tests.test_suitability import _conservative, _eln, _make_metrics
    m = _make_metrics(max_loss_pct=0.9, stress_loss_pct=0.0, replay_kwargs=dict(cvar5=0.0, worst_loss=0.45))
    out = assess_product(_eln(), _conservative(tolerance=5.0), m)
    loss = out["assessment"]["checks"]["loss_tolerance"]
    assert loss["status"] == "FAIL" and out["assessment"]["overall_status"] == "NOT_SUITABLE"
    m2 = _make_metrics(max_loss_pct=0.0, stress_loss_pct=0.0, replay_kwargs=dict(cvar5=0.0, worst_loss=0.0))
    ok = assess_product(_eln(), _conservative(tolerance=5.0), m2)["assessment"]["checks"]["loss_tolerance"]
    assert ok["status"] == "PASS"


def test_single_rm_role_has_all_permissions():
    from app.core.rbac import ALL_PERMISSIONS, permissions_for_tier, tier_key
    for legacy in ("JUNIOR_RM", "senior_advisor", "branch_manager", None):
        assert tier_key(legacy) == "relationship_manager"
        assert set(permissions_for_tier(legacy)) == set(ALL_PERMISSIONS)


