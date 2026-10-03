"""Selection rule (20 picks) and input validation."""

import datetime as dt
import unittest

import numpy as np

from sim_engine.errors import InvalidProduct
from sim_engine.schema import parse_product
from sim_engine.selector import label_for_move, select_scenarios
from sim_engine.windows import build_windows, tenor_parts
from tests.synthetic import make_series


class TestWindowsAndSelector(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        s = make_series(seed=7)
        cls.dates, cls.values = s.index, s.values
        cls.win = build_windows(cls.dates, cls.values, 12)
        cls.picks, cls.spacing, cls.notes = select_scenarios(cls.win, cls.values, "equity")

    def test_tenor_parts(self):
        self.assertEqual(tenor_parts(12), (12, 0))
        self.assertEqual(tenor_parts(8.5), (8, 15))
        self.assertEqual(tenor_parts(0.25), (0, 8))
        self.assertEqual(tenor_parts(0.01), (0, 1))

    def test_window_end_is_one_tenor_later(self):
        s, e = self.win.start[100], self.win.end[100]
        gap = (self.dates[e] - self.dates[s]).days
        self.assertTrue(365 <= gap <= 369, gap)

    def test_twenty_picks_in_slot_order(self):
        self.assertEqual(len(self.picks), 20)
        self.assertEqual([p.kind for p in self.picks[:5]],
                         ["worst_ever", "best_ever", "drop_10", "sideways", "most_recent"])
        self.assertEqual(self.picks[0].w, int(np.argmin(self.win.move)))
        self.assertEqual(self.picks[1].w, int(np.argmax(self.win.move)))
        self.assertEqual(self.picks[4].w, len(self.win) - 1)   # latest complete period
        self.assertEqual(self.spacing, 60)

    def test_drop_and_sideways_slots_hit_their_targets(self):
        self.assertAlmostEqual(self.win.move[self.picks[2].w], -0.10, delta=0.02)
        self.assertLessEqual(abs(self.win.move[self.picks[3].w]), 0.01)
        self.assertEqual(self.picks[2].label, "10% drop")
        self.assertEqual(self.picks[3].label, "Sideways")

    def test_picks_are_spaced_and_unique(self):
        starts = sorted(int(self.win.start[p.w]) for p in self.picks)
        self.assertTrue(all(b - a >= 60 for a, b in zip(starts, starts[1:])))

    def test_spread_picks_sorted_by_move(self):
        moves = [self.win.move[p.w] for p in self.picks[5:]]
        self.assertEqual(moves, sorted(moves))

    def test_deterministic(self):
        again, _, _ = select_scenarios(self.win, self.values, "equity")
        self.assertEqual([p.w for p in again], [p.w for p in self.picks])

    def test_short_history_returns_fewer_with_warning(self):
        win = build_windows(self.dates[:300], self.values[:300], 12)
        picks, used, notes = select_scenarios(win, self.values[:300], "equity")
        self.assertEqual(len(picks), min(20, len(win)))
        self.assertTrue(any(n["code"] == "SHORT_HISTORY" for n in notes))

    def test_labels(self):
        self.assertEqual(label_for_move(-0.20, "equity"), "Big fall")
        self.assertEqual(label_for_move(-0.10, "equity"), "Fall")
        self.assertEqual(label_for_move(0.05, "equity"), "Flat")
        self.assertEqual(label_for_move(0.12, "equity"), "Rise")
        self.assertEqual(label_for_move(0.21, "equity"), "Big rise")
        self.assertEqual(label_for_move(-0.02, "fx"), "Fall")
        self.assertEqual(label_for_move(0.035, "fx"), "Big rise")


class TestSchema(unittest.TestCase):
    ELN = {"product_type": "ELN", "underlying": "NIFTY", "notional": 1000000, "start_date": "2026-10-05",
           "tenor": 12, "coupon_pa": 0.10, "strike_pct": 1.0, "barrier_pct": 0.7}

    def test_valid_eln(self):
        p, warns = parse_product(self.ELN)
        self.assertEqual(p.product_type, "ELN")
        self.assertEqual(warns, [])
        self.assertTrue(p.product_id.startswith("prod_"))

    def test_product_id_is_stable(self):
        a, _ = parse_product(self.ELN)
        b, _ = parse_product(dict(self.ELN))
        c, _ = parse_product(dict(self.ELN, coupon_pa=0.11))
        self.assertEqual(a.product_id, b.product_id)
        self.assertNotEqual(a.product_id, c.product_id)

    def test_missing_and_bad_fields(self):
        with self.assertRaises(InvalidProduct) as ctx:
            parse_product(dict(self.ELN, strike_pct=None, tenor=-1, start_date="05/10/2026"))
        fields = {d["field"] for d in ctx.exception.details}
        self.assertEqual(fields, {"strike_pct", "tenor", "start_date"})

    def test_unknown_product_type(self):
        with self.assertRaises(InvalidProduct):
            parse_product(dict(self.ELN, product_type="SWAP"))

    def test_barrier_above_100_percent_rejected(self):
        with self.assertRaises(InvalidProduct):
            parse_product(dict(self.ELN, barrier_pct=1.2))

    def test_dcd_alt_currency_must_be_in_pair(self):
        dcd = {"product_type": "DCD", "underlying": "USD/INR", "notional": 100000, "tenor": 1,
               "coupon_pa": 0.06, "strike_rate": 87, "alt_currency": "EUR"}
        with self.assertRaises(InvalidProduct):
            parse_product(dcd)
        p, _ = parse_product(dict(dcd, alt_currency="usd"))
        self.assertEqual(p.alt_currency, "USD")

    def test_ignored_fields_warn(self):
        _, warns = parse_product(dict(self.ELN, protection_pct=1.0))
        self.assertEqual(warns[0]["code"], "IGNORED_FIELDS")

    def test_missing_start_date_means_today(self):
        raw = dict(self.ELN)
        raw.pop("start_date")
        p, _ = parse_product(raw, today=dt.date(2026, 10, 4))
        self.assertEqual(p.start_date, dt.date(2026, 10, 4))

    def test_sample_files_all_valid(self):
        import json
        import os
        root = os.path.join(os.path.dirname(__file__), "..", "sample_inputs")
        for name in ("eln_100.json", "cpn_100.json", "dcd_100.json"):
            with open(os.path.join(root, name), encoding="utf-8") as f:
                for raw in json.load(f):
                    parse_product(raw)


if __name__ == "__main__":
    unittest.main()
