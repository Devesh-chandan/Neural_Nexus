"""End-to-end: engine + market data adapter, fully offline on synthetic prices."""

import copy
import datetime as dt
import json
import os
import shutil
import tempfile
import unittest

import pandas as pd

from sim_engine import MarketDataService, Settings, payoff_curve, run_batch, run_simulation
from sim_engine.errors import MarketDataUnavailable, NotEnoughHistory, SimulationError
from sim_engine.market_data import BREAKER, ProviderError, clean_prices, read_price_csv
from sim_engine.underlyings import resolve_underlying
from tests.synthetic import write_prices

TODAY = dt.date(2026, 10, 4)
ROOT = os.path.join(os.path.dirname(__file__), "..")
SCENARIO_KEYS = {"id", "situation", "period", "market_move_pct", "barrier_hit", "money_back",
                 "return_pct", "story"}


def load_samples():
    out = {}
    for name in ("eln_100.json", "cpn_100.json", "dcd_100.json"):
        with open(os.path.join(ROOT, "sample_inputs", name), encoding="utf-8") as f:
            out[name] = json.load(f)
    return out


class EngineTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.samples = load_samples()
        unders = {p["underlying"] for items in cls.samples.values() for p in items}
        write_prices(cls.tmp, unders | {"NIFTY"})
        cls.market = MarketDataService(data_dir=cls.tmp, offline=True, today=TODAY)
        cls.settings = Settings(today=TODAY)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def run_one(self, raw, **kw):
        return run_simulation(raw, Settings(today=TODAY, **kw), self.market)

    def test_output_shape(self):
        res = self.run_one(self.samples["eln_100.json"][0])
        self.assertEqual(set(res) - {"audit"}, {"run_id", "product_id", "data_as_of", "currency",
                                                 "scenarios", "warnings"})
        self.assertEqual(len(res["scenarios"]), 20)
        for s in res["scenarios"]:
            self.assertEqual(set(s), SCENARIO_KEYS)
        self.assertEqual([s["id"] for s in res["scenarios"]], list(range(1, 21)))
        self.assertEqual([s["situation"] for s in res["scenarios"][:5]],
                         ["Worst ever", "Best ever", "10% drop", "Sideways", "Most recent"])
        self.assertEqual(res["data_as_of"], "2026-10-01")
        self.assertEqual(res["currency"], "INR")

    def test_every_sample_product_runs(self):
        for name, items in self.samples.items():
            rows = run_batch(items, self.settings, self.market)
            errors = [r for r in rows if r["status"] != "ok"]
            self.assertEqual(errors, [], f"{name}: {errors[:3]}")
            for r in rows:
                sc = r["result"]["scenarios"]
                self.assertEqual(len(sc), 20, name)
                ret = [s["return_pct"] for s in sc]
                self.assertTrue(all(-100.0 <= x < 1000 for x in ret), (name, r["index"], ret))

    def test_deterministic(self):
        raw = self.samples["cpn_100.json"][5]
        a, b = self.run_one(raw), self.run_one(raw)
        a["audit"].pop("created_at"), b["audit"].pop("created_at")
        self.assertEqual(json.dumps(a, sort_keys=True), json.dumps(b, sort_keys=True))

    def test_changing_coupon_keeps_the_same_periods(self):
        raw = self.samples["eln_100.json"][1]
        a = self.run_one(raw)
        b = self.run_one(dict(raw, coupon_pa=raw["coupon_pa"] + 0.05))
        self.assertEqual([s["period"] for s in a["scenarios"]], [s["period"] for s in b["scenarios"]])
        self.assertNotEqual(a["run_id"], b["run_id"])

    def test_eln_money_matches_rule(self):
        raw = {"product_type": "ELN", "underlying": "NIFTY", "notional": 1000000, "start_date": "2026-10-05",
               "tenor": 12, "coupon_pa": 0.10, "strike_pct": 1.0, "barrier_pct": 0.7}
        res = self.run_one(raw)
        for s in res["scenarios"]:
            if not s["barrier_hit"] or s["market_move_pct"] >= 0:
                self.assertAlmostEqual(s["money_back"], 1_100_000, places=2)
            else:
                expected = 1_000_000 * (1 + s["market_move_pct"] / 100) + 100_000
                self.assertAlmostEqual(s["money_back"], expected, delta=60)  # move is rounded to 0.01%
        worst = res["scenarios"][0]
        self.assertTrue(worst["barrier_hit"])
        self.assertIn("broke the barrier", worst["story"])

    def test_history_until_start_date_has_no_lookahead(self):
        raw = dict(self.samples["eln_100.json"][0])       # starts 2022-02-23
        res = self.run_one(raw, history_until="start_date")
        self.assertLessEqual(res["data_as_of"], raw["start_date"])
        self.assertTrue(all(s["period"]["end"] <= raw["start_date"] for s in res["scenarios"]))

    def test_one_week_dcd(self):
        raw = next(p for p in self.samples["dcd_100.json"] if p["tenor"] == 0.25)
        res = self.run_one(raw)
        self.assertEqual(len(res["scenarios"]), 20)
        self.assertEqual(res["audit"]["underlying"]["asset_class"], "fx")

    def test_dcd_currency_and_jpy_scaling(self):
        jpy = next(p for p in self.samples["dcd_100.json"] if p["underlying"] == "JPY/INR")
        res = self.run_one(jpy)
        self.assertEqual(res["audit"]["underlying"]["quote_unit"], 100.0)
        self.assertGreater(res["audit"]["reference"]["price"], 20)       # per 100 JPY
        usd_dep = next(p for p in self.samples["dcd_100.json"] if p["alt_currency"] == "INR"
                       and p["underlying"] == "USD/INR")
        self.assertEqual(self.run_one(usd_dep)["currency"], "USD")

    def test_tenor_longer_than_history(self):
        with self.assertRaises(NotEnoughHistory):
            self.run_one({"product_type": "CPN", "underlying": "NIFTY", "notional": 100000,
                          "start_date": "2007-01-01", "tenor": 24, "protection_pct": 1.0,
                          "participation_pct": 1.0}, history_until="start_date")

    def test_wrong_asset_for_product(self):
        with self.assertRaises(SimulationError):
            self.run_one({"product_type": "DCD", "underlying": "NIFTY", "notional": 1, "tenor": 1,
                          "coupon_pa": 0.05, "strike_rate": 1, "alt_currency": "INR"})

    def test_batch_keeps_going_after_a_bad_product(self):
        good = self.samples["eln_100.json"][0]
        rows = run_batch([good, {"product_type": "ELN"}, good], self.settings, self.market)
        self.assertEqual([r["status"] for r in rows], ["ok", "error", "ok"])
        self.assertEqual(rows[1]["error"]["code"], "INVALID_PRODUCT")

    def test_payoff_curve(self):
        raw = {"product_type": "ELN", "underlying": "NIFTY", "notional": 1000000, "tenor": 12,
               "coupon_pa": 0.10, "strike_pct": 1.0, "barrier_pct": 0.7}
        curve = payoff_curve(raw, self.market, today=TODAY)
        at = {p["move_pct"]: p for p in curve["points"]}
        self.assertEqual(at[-10.0]["barrier_not_touched"], 1_100_000)
        self.assertEqual(at[-10.0]["barrier_touched"], 1_000_000)
        self.assertIsNone(at[-35.0]["barrier_not_touched"])
        self.assertEqual(at[-35.0]["barrier_touched"], 750_000)
        dcd = payoff_curve(self.samples["dcd_100.json"][5], self.market, today=TODAY)
        self.assertIsNotNone(dcd["reference_rate"])


class MarketDataTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        BREAKER.reset()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)
        BREAKER.reset()

    def test_reads_nse_style_csv(self):
        path = os.path.join(self.tmp, "nse.csv")
        with open(path, "w", encoding="utf-8") as f:
            f.write('Date ,Open ,High ,Low ,Close \n03-Oct-2024,1,1,1,"25,014.60"\n04-Oct-2024,1,1,1,"24,964.25"\n')
        s = read_price_csv(path)
        self.assertEqual(str(s.index[0].date()), "2024-10-03")
        self.assertAlmostEqual(s.iloc[1], 24964.25)

    def test_spike_is_removed(self):
        idx = pd.bdate_range("2024-01-01", periods=6)
        s = pd.Series([100, 101, 300, 102, 103, 0], index=idx)
        clean, removed = clean_prices(s, "equity")
        self.assertEqual(list(clean.values), [100, 101, 102, 103])
        self.assertEqual(removed, 2)

    def test_offline_without_data_is_an_explicit_error(self):
        m = MarketDataService(data_dir=self.tmp, offline=True, today=TODAY)
        with self.assertRaises(MarketDataUnavailable):
            m.get(resolve_underlying("RELIANCE"))

    def test_provider_failure_falls_back_to_cache_with_warning(self):
        good = pd.Series(range(100, 400), index=pd.bdate_range("2025-01-01", periods=300), dtype=float)

        class Good:
            name = "fake/good"
            def available(self): return True
            def fetch(self, t): return good

        class Broken:
            name = "fake/broken"
            def available(self): return True
            def fetch(self, t): raise ProviderError("timeout")

        info = resolve_underlying("TCS")
        first = MarketDataService(data_dir=self.tmp, providers=[Good()], today=TODAY).get(info)
        self.assertEqual(first.source, "fake/good")
        again = MarketDataService(data_dir=self.tmp, providers=[Broken()], refresh=True, today=TODAY).get(info)
        self.assertEqual(again.source, "cache")
        self.assertIn("PROVIDER_FAILED_USING_CACHE", [w["code"] for w in again.warnings])
        self.assertEqual(again.fingerprint, first.fingerprint)

    def test_circuit_breaker_opens_after_repeated_failures(self):
        calls = []

        class Broken:
            name = "fake/broken"
            def available(self): return True
            def fetch(self, t):
                calls.append(t)
                raise ProviderError("down")

        m = MarketDataService(data_dir=self.tmp, providers=[Broken()], today=TODAY)
        for sym in ("AAA", "BBB", "CCC", "DDD"):
            with self.assertRaises(MarketDataUnavailable):
                m.get(resolve_underlying(sym))
        self.assertEqual(len(calls), 3)          # 4th call skipped by the breaker

    def test_stale_data_is_flagged(self):
        old = pd.Series(range(100, 400), index=pd.bdate_range("2024-01-01", periods=300), dtype=float)
        os.makedirs(os.path.join(self.tmp, "prices"))
        pd.DataFrame({"Date": old.index.strftime("%Y-%m-%d"), "Close": old.values}).to_csv(
            os.path.join(self.tmp, "prices", "INFY.csv"), index=False)
        d = MarketDataService(data_dir=self.tmp, offline=True, today=TODAY).get(resolve_underlying("INFY"))
        self.assertIn("STALE_DATA", [w["code"] for w in d.warnings])

    def test_ticker_mapping(self):
        self.assertEqual(resolve_underlying("NIFTY").ticker, "^NSEI")
        self.assertEqual(resolve_underlying("M&M").ticker, "M&M.NS")
        self.assertEqual(resolve_underlying("USD/INR").ticker, "INR=X")
        self.assertEqual(resolve_underlying("EUR/INR").ticker, "EURINR=X")
        self.assertEqual(resolve_underlying("JPY/INR").quote_unit, 100.0)

    def test_ticker_override_file(self):
        with open(os.path.join(self.tmp, "underlyings.json"), "w", encoding="utf-8") as f:
            json.dump({"MIDCPNIFTY": {"ticker": "^NSEMDCP50", "name": "Midcap 50"}}, f)
        self.assertEqual(resolve_underlying("MIDCPNIFTY", self.tmp).ticker, "^NSEMDCP50")


if __name__ == "__main__":
    unittest.main()
