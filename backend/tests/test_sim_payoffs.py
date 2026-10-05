"""Payoff rules checked against hand-worked numbers (the replay-engine dry run)."""

import unittest

import numpy as np

from app.simulation.sim_engine.payoffs import cpn_payoff, dcd_payoff, eln_payoff

N = 1_000_000


def eln(path, coupon=0.10, tenor=12, strike=1.0, barrier=0.70):
    return eln_payoff(np.asarray(path, dtype=float), N, coupon, tenor, strike, barrier)


class TestELN(unittest.TestCase):
    def test_ten_percent_drop_keeps_capital_and_coupon(self):
        r = eln(np.linspace(1.0, 0.90, 250))
        self.assertAlmostEqual(r.money_back, 1_100_000, places=6)
        self.assertFalse(r.barrier_hit)

    def test_sideways_pays_full_coupon(self):
        self.assertAlmostEqual(eln(np.ones(250)).money_back, 1_100_000, places=6)

    def test_close_exactly_on_barrier_is_not_a_breach(self):
        r = eln([1.0, 0.85, 17500 / 25000])
        self.assertFalse(r.barrier_hit)
        self.assertAlmostEqual(r.money_back, 1_100_000, places=6)

    def test_one_point_below_barrier_is_the_cliff(self):
        r = eln([1.0, 0.8, 17499 / 25000])
        self.assertTrue(r.barrier_hit)
        self.assertAlmostEqual(r.money_back, 799_960, places=4)

    def test_sixty_percent_crash(self):
        self.assertAlmostEqual(eln([1.0, 0.5, 0.40]).money_back, 500_000, places=6)

    def test_breach_then_recovery_above_strike_pays_in_full(self):
        r = eln([1.0, 0.61, 1.13])           # COVID-style path
        self.assertTrue(r.barrier_hit)
        self.assertAlmostEqual(r.money_back, 1_100_000, places=6)
        self.assertEqual(r.info["hit_index"], 1)

    def test_breach_ending_between_strike_and_start(self):
        r = eln([1.0, 0.55, 0.85], strike=0.8, barrier=0.6)
        self.assertTrue(r.barrier_hit)
        self.assertAlmostEqual(r.money_back, 1_100_000, places=6)   # 0.85 >= strike 0.8

    def test_lower_strike_scales_the_loss(self):
        r = eln([1.0, 0.5, 0.5], strike=0.8, barrier=0.6)
        self.assertAlmostEqual(r.money_back, N * 0.5 / 0.8 + 100_000, places=6)

    def test_no_barrier_loses_whenever_below_strike(self):
        r = eln([1.0, 0.97, 0.90], barrier=None)
        self.assertTrue(r.barrier_hit)
        self.assertAlmostEqual(r.money_back, 1_000_000, places=6)
        self.assertAlmostEqual(eln([1.0, 1.05], barrier=None).money_back, 1_100_000, places=6)

    def test_fractional_tenor_coupon(self):
        self.assertAlmostEqual(eln([1.0, 1.0], coupon=0.12, tenor=3).money_back, 1_030_000, places=6)


class TestCPN(unittest.TestCase):
    def test_rise_with_participation(self):
        r = cpn_payoff(np.array([1.0, 1.30]), N, 0.0, 36, 1.0, 0.6, None)
        self.assertAlmostEqual(r.money_back, 1_180_000, places=6)
        self.assertFalse(r.barrier_hit)

    def test_fall_returns_protected_amount(self):
        self.assertAlmostEqual(cpn_payoff(np.array([1.0, 0.7]), N, 0.0, 36, 1.0, 0.6, None).money_back,
                               1_000_000, places=6)
        self.assertAlmostEqual(cpn_payoff(np.array([1.0, 0.7]), N, 0.0, 36, 0.9, 0.6, None).money_back,
                               900_000, places=6)

    def test_cap_limits_the_upside(self):
        r = cpn_payoff(np.array([1.0, 1.10]), N, 0.0, 12, 1.0, 2.0, 0.065)
        self.assertAlmostEqual(r.money_back, 1_065_000, places=6)
        self.assertTrue(r.info["capped"])

    def test_coupon_is_added(self):
        r = cpn_payoff(np.array([1.0, 0.95]), N, 0.03, 24, 1.0, 1.0, None)
        self.assertAlmostEqual(r.money_back, 1_060_000, places=6)


class TestDCD(unittest.TestCase):
    def test_deposit_inr_converted_into_usd_when_usd_weakens(self):
        # deposit Rs 10L, may be repaid in USD at 87; USD/INR 88 -> 85; 30 days at 9%
        r = dcd_payoff(np.array([1.0, 85 / 88]), N, 0.09, 30, 88.0, 87.0, 1.0, alt_is_base=True)
        self.assertTrue(r.barrier_hit)
        self.assertAlmostEqual(r.info["alt_amount"], 1_007_397.26 / 87, delta=0.01)
        self.assertAlmostEqual(r.money_back, 984_239.0, delta=0.5)

    def test_deposit_inr_not_converted(self):
        r = dcd_payoff(np.array([1.0, 1.0]), N, 0.09, 30, 88.0, 87.0, 1.0, alt_is_base=True)
        self.assertFalse(r.barrier_hit)
        self.assertAlmostEqual(r.money_back, 1_007_397.26, delta=0.01)

    def test_deposit_usd_converted_into_inr_when_inr_weakens(self):
        r = dcd_payoff(np.array([1.0, 87 / 85]), 100_000, 0.06, 90, 85.0, 86.0, 1.0, alt_is_base=False)
        total = 100_000 * (1 + 0.06 * 90 / 365)
        self.assertTrue(r.barrier_hit)
        self.assertAlmostEqual(r.info["alt_amount"], total * 86, delta=0.01)
        self.assertAlmostEqual(r.money_back, total * 86 / 87, delta=0.01)

    def test_jpy_quoted_per_100(self):
        r = dcd_payoff(np.array([1.0, 57 / 58]), N, 0.02, 30, 58.0, 57.6, 100.0, alt_is_base=True)
        total = N * (1 + 0.02 * 30 / 365)
        self.assertTrue(r.barrier_hit)
        self.assertAlmostEqual(r.info["alt_amount"], total / 0.576, delta=0.01)      # yen received
        self.assertAlmostEqual(r.money_back, total / 0.576 * 0.57, delta=0.01)


if __name__ == "__main__":
    unittest.main()
