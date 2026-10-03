# PROGRESS

## Current phase: 0

## Phase status

| Phase | Name | Status | Last sub-task done |
|---|---|---|---|
| 0 | Scaffold and contracts | IN-PROGRESS | |
| 1 | Market data layer | TODO | |
| 2 | Payoff engine | TODO | |
| 3 | Scenarios and analytics | TODO | |
| 4 | Suitability engine | TODO | |
| 5 | Recommendation engine | TODO | |
| 6 | Explanation layer | TODO | |
| 7 | Cases, audit and export | TODO | |
| 8 | Frontend foundation | TODO | |
| 9 | Client page | TODO | |
| 10 | RM page | TODO | |
| 11 | Dashboard | TODO | |
| 12 | Integration, demo, polish | TODO | |

## How to run

### Backend
```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

### Build seed data (requires internet)
```bash
cd backend
python scripts/build_seed.py
```

## Assumptions made

- DCD interest is earned on full principal and converted together with principal at maturity.
- Volatility uses EWMA lambda=0.94 with 252 trading days per year.
- FD baseline rate: 7.0% p.a. (illustrative, config-driven).
- Risk-free rates: INR 6.5%, USD 4.5% (config-driven in products.yaml).
- Issuer margin haircut: 15% of option premium.
- Dividend yield: 0 (documented simplification for Black-Scholes).
- For daily monitoring shocked scenarios: straight-line path assumed (path min = min(S0, ST)).
- ELN barrier holds exactly (x == barrier_pct is NOT a breach).

## Contract changes

(none yet)

## Blockers

(none yet)

## Known issues

(none yet)
