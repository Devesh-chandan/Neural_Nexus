# Module 2 — Simulation Engine

Takes **one structured product** (ELN, CPN or DCD), replays it on **20 real past market
periods** of the same length, and returns how much money comes back in each one.
Module 3 takes this output plus the client profile and decides suitability.

> Historical replay of real past periods. **Not a forecast.**

---

## 1. Setup (Windows, PowerShell)

```powershell
cd $HOME\Downloads
Expand-Archive module2_simulation_engine.zip -DestinationPath . -Force
cd module2_simulation_engine

python -m venv .venv
.\.venv\Scripts\Activate.ps1          # if blocked: Set-ExecutionPolicy -Scope Process Bypass
pip install -r requirements.txt

python -m unittest discover -s tests -t .     # 56 tests, run offline in a few seconds
```

With Anaconda instead of venv: `conda create -n sim python=3.11 -y`, then
`conda activate sim`, then `pip install -r requirements.txt`.

## 2. Run it

```powershell
# 1. Download + cache prices for every underlying in the sample files (needs internet)
python -m sim_engine fetch --from sample_inputs\eln_100.json --from sample_inputs\cpn_100.json --from sample_inputs\dcd_100.json

# 2. One product, as a table in the terminal (index is 0-based)
python -m sim_engine run sample_inputs\eln_100.json --index 0

# 3. A whole file (writes out\eln_100_results.json, saves every run in runs\)
python -m sim_engine run sample_inputs\eln_100.json

# Same, but print raw JSON
python -m sim_engine run sample_inputs\cpn_100.json --index 3 --json

# Demo day with no internet: use only the cached prices from step 1
python -m sim_engine run sample_inputs\dcd_100.json --index 5 --offline

# Point-in-time check: only use history up to the product's start_date (no look-ahead)
python -m sim_engine run sample_inputs\eln_100.json --index 0 --history-until start_date

# Validate a file without running it
python -m sim_engine check sample_inputs\dcd_100.json

# API for the frontend / other modules  ->  http://127.0.0.1:8002/docs
uvicorn sim_engine.api:app --reload --port 8002
```

| Endpoint | What it does |
|---|---|
| `POST /simulations` | body = one product JSON → the output below (also saved) |
| `POST /simulations/batch` | body = list of products → `[{index, status, result \| error}]` |
| `GET /simulations/{run_id}` | reload a saved run (audit) |
| `POST /payoff-curve` | money back for every ending from −60% to +60% (for the payoff chart) |
| `GET /health` | engine version and offline flag |

Optional query parameter on the POST routes: `?history_until=start_date`.

## 3. Input (one product)

The same fields as the sample files. Fields a product type does not use may be `null`.

| Field | ELN | CPN | DCD | Meaning |
|---|---|---|---|---|
| `product_type` | ✓ | ✓ | ✓ | `ELN`, `CPN` or `DCD` |
| `underlying` | stock / index | index | pair `XXX/INR` | `RELIANCE`, `NIFTY`, `USD/INR` |
| `notional` | ✓ | ✓ | ✓ | amount invested |
| `start_date` | ✓ | ✓ | ✓ | `YYYY-MM-DD` (default today) |
| `tenor` | ✓ | ✓ | ✓ | months; fractions allowed (`0.25` ≈ 1 week) |
| `coupon_pa` | required | optional | required | yearly rate, `0.10` = 10% |
| `strike_pct` | required | | | strike as a fraction of the start price |
| `barrier_pct` | optional | | | knock-in barrier; `null` = no barrier |
| `protection_pct` | | required | | `1.0` = 100% capital back |
| `participation_pct` | | required | | share of the rise you get |
| `cap_pct` | | optional | | maximum upside return; `null` = no cap |
| `strike_rate` | | | required | conversion rate (JPY/INR is per 100 JPY) |
| `alt_currency` | | | required | currency the bank may repay you in |
| `product_id` | optional | optional | optional | if missing, a stable id is made from the terms |

## 4. Output

```json
{
  "run_id": "sim_62cce276da66",
  "product_id": "prod_50bb0128b822",
  "data_as_of": "2026-10-01",
  "currency": "INR",
  "scenarios": [
    {
      "id": 1,
      "situation": "Worst ever",
      "period": {"start": "2008-01-03", "end": "2009-01-05"},
      "market_move_pct": -76.56,
      "barrier_hit": true,
      "money_back": 719381.38,
      "return_pct": -70.03,
      "story": "ITC broke the barrier on 03 Jun 2008 and ended -76.6%, below the strike, so the fall was passed on and you got back ₹7,19,381.38."
    }
  ],
  "warnings": [{"code": "STALE_DATA", "message": "..."}],
  "audit": {"engine_version": "...", "product": {}, "market_data": {"fingerprint": "sha256:..."}}
}
```
*(The numbers above come from synthetic test data; they only show the shape of the output.)*

**Header**

| Field | Meaning |
|---|---|
| `run_id` | Built from inputs, data and engine version: same inputs + same data = same id |
| `product_id` | Which product configuration was tested |
| `data_as_of` | Last market date used |
| `currency` | Currency of `money_back` (INR for ELN/CPN; the deposit currency for a DCD) |

**Each of the 20 scenarios**

| Field | Meaning |
|---|---|
| `id` | 1–20 |
| `situation` | Worst ever, Best ever, 10% drop, Sideways, Most recent, Big fall, Fall, Flat, Rise, Big rise |
| `period` | Real dates in history |
| `market_move_pct` | How much the underlying moved over the period |
| `barrier_hit` | The product's danger event. ELN: barrier breached (no-barrier ELN: ended below strike). DCD: repaid in `alt_currency`. CPN: always `false` |
| `money_back` | What you get back at maturity on today's product |
| `return_pct` | Gain or loss on the money invested |
| `story` | One plain sentence from fixed templates (no AI) |

`warnings` lists anything Module 3 / the screen should show. `audit` records what Module 5
needs: product terms, ticker, data source, SHA-256 data fingerprint, reference price,
selection details and the payoff rule used.

## 5. How the 20 periods are picked

1. Cut the full price history into every period of the product's length
   (one per trading day; the end is the first trading day on or after start + tenor).
2. Line them up from biggest fall to biggest rise.
3. Fill the slots:

| Slot | Situation | Rule |
|---|---|---|
| 1 | Worst ever | first in the line-up |
| 2 | Best ever | last in the line-up |
| 3 | 10% drop | moved closest to −10% (if nothing within ±2 points: "Closest to a 10% drop" + warning) |
| 4 | Sideways | among periods that ended within ±1% (FX ±0.25%), the calmest; else closest to 0% |
| 5 | Most recent | the latest complete period |
| 6–20 | Big fall … Big rise | 15 picks at equal gaps along the line-up |

Two picks must start at least 60 trading days apart. A clashing pick moves to the nearest free
period. If history is short, the gap is halved until 20 fit, with a `SHORT_HISTORY` warning.
There is no randomness, so the same inputs and data always give the same 20.

Labels for slots 6–20: Stocks/indices use Big fall ≤ −20% < Fall < −5% ≤ Flat ≤ +5% < Rise ≤ +20% < Big rise.
Currencies use the same idea with ±1% and ±3%.

## 6. Payoff rules

Every period becomes a % path (each day's close ÷ the first close), so each product is
replayed on its own terms whatever the price level was back then.

* **ELN**
  * coupon = notional × coupon_pa × tenor/12
  * If any daily close is **strictly below** the barrier and the final price is below the strike: notional × final/strike + coupon.
  * Otherwise: notional + coupon.
  * No barrier: the loss applies whenever final < strike.
* **CPN**
  * notional × (protection + min(participation × max(0, final − 1), cap)) + notional × coupon_pa × tenor/12.
* **DCD**
  * interest = notional × coupon_pa × days/365.
  * `alt_currency` is the currency the bank may repay you in. You deposit the other one.
  * The bank repays in `alt_currency` when it is the weaker side of the strike at maturity:
    * alt = USD in USD/INR (deposit INR): converted if rate < strike
    * alt = INR in USD/INR (deposit USD): converted if rate > strike
  * Converted money is valued back in your deposit currency at the final rate.
  * The strike's distance from spot is measured on `start_date`.

## 7. Market data

The engine looks in this order:

1. `data\prices\<UNDERLYING>.csv`: your own file (e.g. downloaded from NSE). Needs a Date and a Close column. Names use `_` for `/` and `&` (`USD_INR.csv`, `M_M.csv`).
2. `data\cache\`: the saved download, if under 12 hours old (`--offline` uses it at any age).
3. Yahoo Finance via `yfinance`, with Yahoo's chart API as backup. The result is saved to the cache with its fetch time.
4. If the live download fails, the cached copy is used with `PROVIDER_FAILED_USING_CACHE`. With no cached copy you get a clear `MARKET_DATA_UNAVAILABLE` error. After 3 straight failures, live calls pause for 5 minutes (circuit breaker).

The data is also cleaned:

* Uses close prices adjusted for splits but not dividends, which is right for barriers.
* Blank, zero and one-day spike prices are removed (`BAD_PRICES_REMOVED`).
* A last price older than 5 days is flagged (`STALE_DATA`).

**Tickers.**

* NIFTY `^NSEI`, SENSEX `^BSESN`, BANKNIFTY `^NSEBANK`, NIFTYIT `^CNXIT`, NIFTYNXT50 `^NSMIDCP`
* FINNIFTY `NIFTY_FIN_SERVICE.NS`, MIDCPNIFTY `NIFTY_MID_SELECT.NS`
* Stocks are `SYMBOL.NS`
* FX: USD/INR is `INR=X`; the others are `EURINR=X` and so on

If `fetch` reports one as FAIL, fix it without touching code. Copy
`data\underlyings.example.json` to `data\underlyings.json` and edit the ticker, or drop a CSV into `data\prices\`.

## 8. Warning codes

| Code | Meaning |
|---|---|
| `STALE_DATA` | Latest price is more than 5 days old |
| `PROVIDER_FAILED_USING_CACHE` | Live download failed; older saved prices were used |
| `BAD_PRICES_REMOVED` | Blank/zero/spike rows were dropped |
| `SHORT_HISTORY` | Fewer than 20 periods, or picks closer than 60 days |
| `NO_CLOSE_MATCH` | No real period near −10% (or near flat); closest one used and labelled |
| `STRIKE_ALREADY_CROSSED` | DCD: on start_date the rate was already on the conversion side of the strike |
| `STRIKE_FAR_FROM_SPOT` | DCD: strike more than 30% away from the rate; check units |
| `START_BEFORE_DATA` | DCD: start_date is before the first available price |
| `IGNORED_FIELDS` / `UNKNOWN_FIELDS` | Input had fields this product type does not use |

Errors (product skipped, batch continues):

* `INVALID_PRODUCT`
* `UNSUPPORTED_UNDERLYING`
* `MARKET_DATA_UNAVAILABLE`
* `NOT_ENOUGH_HISTORY`
* `INVALID_SETTINGS`

## 9. Files

```
sim_engine/
  config.py        every fixed rule and threshold in one place
  schema.py        input validation, stable product_id
  underlyings.py   underlying -> ticker (+ data\underlyings.json overrides)
  market_data.py   adapter: local CSV -> cache -> Yahoo; cleaning, fingerprint, circuit breaker
  windows.py       cut history into periods of the product's length
  selector.py      the 20-slot selection rule
  payoffs.py       ELN / CPN / DCD payoff formulas (pure functions)
  stories.py       one-sentence templates, Indian number format
  engine.py        run_simulation(), run_batch(), payoff_curve()
  storage.py       runs\<run_id>.json
  cli.py           python -m sim_engine ...
  api.py           FastAPI routes
tests/             56 offline tests on synthetic prices
sample_inputs/     the team's 100 ELN / 100 CPN / 100 DCD inputs
```

Use from Python:

```python
from sim_engine import run_simulation
result = run_simulation({"product_type": "ELN", "underlying": "NIFTY", "notional": 1000000,
                         "tenor": 12, "coupon_pa": 0.10, "strike_pct": 1.0, "barrier_pct": 0.7})
```
