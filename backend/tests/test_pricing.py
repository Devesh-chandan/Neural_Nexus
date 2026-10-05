"""Indicative pricer: dividend yield, Garman-Kohlhagen rates for DCD, issuer credit."""
import math

import pytest

from app.analytics import pricing
from app.analytics.metrics import _issuer_credit
from app.schemas.product import parse_product_dict


def test_put_call_parity_with_dividend_yield():
    S, K, r, q, sigma, T = 100.0, 95.0, 0.06, 0.02, 0.2, 1.0
    lhs = pricing._bs_call(S, K, r, sigma, T, q) - pricing._bs_put(S, K, r, sigma, T, q)
    assert lhs == pytest.approx(S * math.exp(-q * T) - K * math.exp(-r * T), abs=1e-9)


def test_dividend_yield_raises_eln_indicative_coupon(monkeypatch):
    eln = parse_product_dict(dict(product_type="ELN", underlying="NIFTY50", tenor_months=12,
                                  principal=1e6, barrier_pct=0.75, coupon_pa=0.1))
    with_div = pricing.indicative_eln(eln, 0.2, 100.0).indicative
    monkeypatch.setattr(pricing, "_dividend_yield", lambda c: 0.0)
    no_div = pricing.indicative_eln(eln, 0.2, 100.0).indicative
    assert with_div > no_div  # a higher dividend yield makes the sold put worth more


def test_dcd_indicative_interest_exceeds_base_rate():
    dcd = parse_product_dict(dict(product_type="DCD", underlying="USDINR", tenor_months=6,
                                  principal=1e5, strike=100.0, interest_pa=0.08))
    assert pricing.indicative_dcd(dcd, 0.06, 96.0).indicative > 0.045  # USD risk-free + option premium


def test_issuer_credit_matches_hazard_formula():
    cpn = parse_product_dict(dict(product_type="CPN", underlying="NIFTY50", tenor_months=24,
                                  principal=1e6, protection_pct=1.0, participation_pct=0.8))
    ic = _issuer_credit(cpn)
    hazard = 0.015 / (1 - 0.40)
    assert ic.default_probability == pytest.approx(1 - math.exp(-hazard * 2), abs=1e-6)
    assert ic.expected_loss_pct == pytest.approx(ic.default_probability * 0.6, abs=1e-6)
    longer = parse_product_dict(dict(product_type="CPN", underlying="NIFTY50", tenor_months=36,
                                     principal=1e6, protection_pct=1.0, participation_pct=0.8))
    assert _issuer_credit(longer).default_probability > ic.default_probability
