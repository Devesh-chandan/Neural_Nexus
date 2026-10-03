# Suitability-Aware Payoff Simulator for Structured Products

A decision-support prototype for wealth management teams to configure, visualize, and check suitability of structured investment products.

## ⚠️ Important Limitations & Disclaimers

- **Authentication.** Supabase Auth provides email/password sessions. The FastAPI backend validates access tokens against Supabase, and protected client data is scoped to the authenticated user. Relationship Manager access is assigned by the onboarding API; this prototype does not verify regulatory credentials with a live regulator.
- **Illustrative analysis only.** This tool uses historical data and statistical models. Past performance does not predict future results. Issuer credit risk and liquidity risk are not modelled.
- **Not investment advice.** This is a decision-support tool. Suitability must be confirmed by a qualified person.
- **Suitability rules are illustrative.** Thresholds in `backend/config/suitability_rules.yaml` are pending compliance review.
- **Tamper-evident, not tamper-proof.** The audit hash chain detects modification but is a prototype-grade control only.
- **Pricing is indicative.** Fair-value checks use Black-Scholes / Garman-Kohlhagen with simplified assumptions; they are not issuer quotes.
- **"ML" label is honest.** Monte Carlo uses block-bootstrap simulation (labelled "Statistical model-based, not a forecast"). No supervised model is trained.

## Products Supported

1. **Equity-Linked Note (ELN)** – barrier-coupon / reverse-convertible style
2. **Capital-Protected Note (CPN)** – with protection %, participation %, optional cap
3. **Dual Currency Deposit (DCD)** – FX-linked deposit with strike

## Three Surfaces

| Route | Who | Purpose |
|---|---|---|
| `/` | Anyone | Landing page |
| `/client` | Client | Profile questionnaire → recommendation in plain language |
| `/rm` | Relationship Manager | Full configurator + recommendation engine |
| `/dashboard/:runId` | Both | Full analysis view |

## Tech Stack

- **Backend:** Python 3.11, FastAPI, Pydantic v2, SQLite, pandas, numpy, scipy, yfinance
- **Frontend:** Vite + React 18 + TypeScript, Tailwind CSS, Recharts, react-router-dom
- **LLM:** Provider-agnostic wrapper (Anthropic / OpenAI / none). Set `LLM_PROVIDER=none` for full offline mode.

## Quick Start

### Prerequisites
- Python 3.11+
- Node.js 18+

### Backend
```bash
cd backend
pip install -r requirements.txt
cp ../.env.example .env   # edit as needed
uvicorn app.main:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev   # → http://localhost:5173
```

### Supabase authentication and demo users

1. Install the [Supabase CLI](https://supabase.com/docs/guides/cli), then run `supabase start` for a local project, or create a hosted Supabase project.
2. Apply `supabase/migrations/20261003000000_create_user_profiles.sql` with `supabase db reset` (local) or `supabase link --project-ref <project-ref>` followed by `supabase db push` (hosted).
3. Copy the project URL and publishable/anon key to `frontend/.env.local` using `frontend/.env.example`.
4. Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and the **server-only** `SUPABASE_SERVICE_ROLE_KEY` in `backend/.env` using `.env.example`. Never put the service-role key in a `VITE_` variable or browser code.
5. From `backend/`, seed ten fictitious client accounts with `python scripts/seed_demo_users.py`.

All seeded accounts use the password `NeuralDemo123!`. Their email addresses are `demo.aarav@example.test`, `demo.diya@example.test`, `demo.kabir@example.test`, `demo.ananya@example.test`, `demo.ishaan@example.test`, `demo.meera@example.test`, `demo.arjun@example.test`, `demo.sara@example.test`, `demo.rohan@example.test`, and `demo.nisha@example.test`. These `.test` accounts and `DEMO-TAX-*` values are test fixtures, not real identities. Do not use the shared demo password outside a local/demo environment.

### Build seed market data (one-time, requires internet)
```bash
cd backend
python scripts/build_seed.py
```

The seed data covers ~15 years of daily prices for all supported underlyings. Commit `backend/data/seed/` so demos run offline.

### Docker (optional)
```bash
docker compose up
```

## Environment Variables

See `.env.example` for all variables. Key ones:

| Variable | Default | Purpose |
|---|---|---|
| `LLM_PROVIDER` | `none` | `anthropic` \| `openai` \| `none` |
| `LLM_API_KEY` | – | API key for the chosen provider |
| `LLM_MODEL` | – | Model name (e.g. `claude-3-5-sonnet-20241022`) |
| `DB_PATH` | `data/nexus.db` | SQLite database path |
| `CORS_ORIGINS` | `http://localhost:5173` | Allowed frontend origins |
| `SUPABASE_URL` | – | Supabase project URL (backend) |
| `SUPABASE_ANON_KEY` | – | Supabase publishable/anon key (backend validation) |
| `SUPABASE_SERVICE_ROLE_KEY` | – | Backend-only key for account provisioning and demo seeding |

The frontend also needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `frontend/.env.local`.

## Running Tests
```bash
cd backend
pytest -v
```

## Architecture Notes

- **Suitability is deterministic.** The LLM only narrates computed results; it never decides suitability.
- **Offline first.** Fallback order: live yfinance → disk cache (12h TTL) → bundled seed CSV.
- **Config-driven products.** Adding a new product type requires a new payoff class and a YAML entry.
- **Audit trail.** Every analysis with suitability and explanation is appended to an immutable hash chain in SQLite.
