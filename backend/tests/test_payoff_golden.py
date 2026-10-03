"""
Golden tests for all 3 payoff engines (Phase 2 acceptance).
All expected values from Section 2.4 of MASTER_CONTEXT.md.
"""
from __future__ import annotations

import numpy as np
import pytest

from app.payoff.eln import ELNPayoff
from app.payoff.cpn import CPNPayoff
from app.payoff.dcd import DCDPayoff
from app.schemas.product import ELNConfig, CPNConfig, DCDConfig


# ─── ELN helpers ──────────────────────────────────────────────────────────────
@pytest.fixture
def eln_base():
    return ELNConfig(
        underlying="NIFTY50",
        tenor_months=12,
        principal=1_000_000,
        currency="INR",
        barrier_pct=0.70,
        coupon_pa=0.12,
        coupon_conditional=False,
        barrier_monitoring="maturity",
    )


engine_eln = ELNPayoff()
engine_cpn = CPNPayoff()
engine_dcd = DCDPayoff()


class TestELN:
    def test_up_no_breach(self, eln_base):
        """x=1.15, no breach → full coupon + principal = 11,20,000"""
        final = engine_eln.final_value(eln_base, np.array([1.15]))[0]
        assert abs(final - 1_120_000) < 1, f"Got {final}"

    def test_down_no_breach(self, eln_base):
        """x=0.90, barrier 0.70, no breach → 11,20,000"""
        final = engine_eln.final_value(eln_base, np.array([0.90]))[0]
        assert abs(final - 1_120_000) < 1

    def test_exactly_at_barrier_holds(self, eln_base):
        """x=0.70, barrier holds (x == barrier) → 11,20,000"""
        final = engine_eln.final_value(eln_base, np.array([0.70]))[0]
        assert abs(final - 1_120_000) < 1, f"Barrier should hold at exactly 0.70, got {final}"

    def test_just_below_barrier_breach(self, eln_base):
        """x=0.69, breach → P*x + coupon = 690,000 + 120,000 = 810,000"""
        final = engine_eln.final_value(eln_base, np.array([0.69]))[0]
        expected = 1_000_000 * 0.69 + 1_000_000 * 0.12 * 1  # P*x + coupon_total
        assert abs(final - expected) < 1, f"Got {final}, expected {expected}"
        assert abs(final - 810_000) < 1

    def test_deep_breach(self, eln_base):
        """x=0.50, breach → 500,000 + 120,000 = 620,000"""
        final = engine_eln.final_value(eln_base, np.array([0.50]))[0]
        assert abs(final - 620_000) < 1

    def test_conditional_coupon_breach(self, eln_base):
        """coupon_conditional=True, x=0.69 → P*x = 690,000 (no coupon on breach)"""
        cfg = eln_base.model_copy(update={"coupon_conditional": True})
        final = engine_eln.final_value(cfg, np.array([0.69]))[0]
        assert abs(final - 690_000) < 1, f"Got {final}"

    def test_daily_monitoring_breach(self, eln_base):
        """path_min_x=0.65 < 0.70 → breach; x=0.95 → redemption=P*min(1,x)=950,000 + coupon=120,000=1,070,000"""
        cfg = eln_base.model_copy(update={"barrier_monitoring": "daily"})
        final = engine_eln.final_value(cfg, np.array([0.95]), np.array([0.65]))[0]
        expected = 1_000_000 * min(1.0, 0.95) + 1_000_000 * 0.12
        assert abs(final - expected) < 1, f"Got {final}, expected {expected}"
        assert abs(final - 1_070_000) < 1

    def test_vectorised_equals_scalar_loop(self, eln_base):
        xs = np.array([0.50, 0.69, 0.70, 0.90, 1.15])
        vec_finals = engine_eln.final_value(eln_base, xs)
        scalar_finals = [engine_eln.final_value(eln_base, np.array([x]))[0] for x in xs]
        np.testing.assert_allclose(vec_finals, scalar_finals, atol=1e-6)

    def test_annualised_return_formula(self, eln_base):
        from app.payoff.base import annualised_return
        final = np.array([1_120_000.0])
        P = 1_000_000.0
        T = 1.0
        ann = annualised_return(final, P, T)[0]
        expected = (1_120_000 / 1_000_000) ** (1 / 1) - 1
        assert abs(ann - expected) < 1e-9


class TestCPN:
    @pytest.fixture
    def cpn_base(self):
        return CPNConfig(
            underlying="NIFTY50",
            tenor_months=24,
            principal=1_000_000,
            currency="INR",
            protection_pct=1.00,
            participation_pct=0.80,
            cap_pct=None,
        )

    def test_up_uncapped(self, cpn_base):
        """x=1.20, participation 0.80, protection 1.00 → 1,000,000*(1 + 0.80*0.20)=1,160,000"""
        final = engine_cpn.final_value(cpn_base, np.array([1.20]))[0]
        assert abs(final - 1_160_000) < 1

    def test_capped(self, cpn_base):
        """cap 0.30, x=1.50 → gain capped at 0.30 → final = 1,300,000"""
        cfg = cpn_base.model_copy(update={"cap_pct": 0.30})
        final = engine_cpn.final_value(cfg, np.array([1.50]))[0]
        assert abs(final - 1_300_000) < 1

    def test_down_full_protection(self, cpn_base):
        """x=0.60, full protection → final = 1,000,000"""
        final = engine_cpn.final_value(cpn_base, np.array([0.60]))[0]
        assert abs(final - 1_000_000) < 1

    def test_90pct_protection(self, cpn_base):
        """prot=0.90, x=0.60 → final = 900,000"""
        cfg = cpn_base.model_copy(update={"protection_pct": 0.90})
        final = engine_cpn.final_value(cfg, np.array([0.60]))[0]
        assert abs(final - 900_000) < 1

    def test_vectorised(self, cpn_base):
        xs = np.array([0.50, 1.00, 1.20, 1.50])
        vec = engine_cpn.final_value(cpn_base, xs)
        scalar = [engine_cpn.final_value(cpn_base, np.array([x]))[0] for x in xs]
        np.testing.assert_allclose(vec, scalar, atol=1e-6)


class TestDCD:
    @pytest.fixture
    def dcd_base(self):
        return DCDConfig(
            underlying="USDINR",
            tenor_months=6,
            principal=100_000,
            currency="USD",
            strike=86.0,
            interest_pa=0.08,
            base_currency="USD",
            alt_currency="INR",
        )

    def test_not_converted(self, dcd_base):
        """S=85 < K=86 → not converted, receive 100,000*(1+0.08*0.5) = 104,000 USD"""
        s0 = 84.0  # spot at start; S_T = s0 * x
        x = 85.0 / s0
        final = engine_dcd.final_value_with_s0(dcd_base, np.array([x]), s0=s0)[0]
        expected = 100_000 * (1 + 0.08 * 0.5)  # 104,000
        assert abs(final - expected) < 0.01, f"Got {final}, expected {expected}"

    def test_converted(self, dcd_base):
        """S=90 > K=86 → converted; base equiv = 104,000 * 86/90 ≈ 99,377.78"""
        s0 = 84.0
        x = 90.0 / s0
        final = engine_dcd.final_value_with_s0(dcd_base, np.array([x]), s0=s0)[0]
        mat_amount = 104_000.0
        expected = mat_amount * 86.0 / 90.0
        assert abs(final - expected) < 0.02, f"Got {final}, expected {expected:.2f}"

    def test_deep_conversion(self, dcd_base):
        """S=100 >> K=86 → base equiv = 104,000 * 86/100 = 89,440"""
        s0 = 84.0
        x = 100.0 / s0
        final = engine_dcd.final_value_with_s0(dcd_base, np.array([x]), s0=s0)[0]
        expected = 104_000.0 * 86.0 / 100.0
        assert abs(final - expected) < 0.02, f"Got {final}, expected {expected}"

    def test_alt_amount(self, dcd_base):
        """Converted case: ALT amount = mat_amount * K = 104,000 * 86 = 8,944,000 INR"""
        s0 = 84.0
        x = 90.0 / s0
        alt = engine_dcd.alt_amount(dcd_base, np.array([x]), s0=s0)[0]
        expected = 104_000.0 * 86.0  # INR amount
        assert abs(alt - expected) < 1, f"Got {alt}, expected {expected}"

    def test_not_converted_alt_amount_zero(self, dcd_base):
        """Not converted: ALT amount = 0"""
        s0 = 84.0
        x = 85.0 / s0
        alt = engine_dcd.alt_amount(dcd_base, np.array([x]), s0=s0)[0]
        assert alt == 0.0
