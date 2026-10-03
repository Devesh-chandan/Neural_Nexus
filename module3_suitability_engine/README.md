# Module 3 — Suitability Engine

Takes **Module 2's historical-replay output** and **one client record** (`clients_india.json`
shape) and decides, with fixed deterministic rules, whether the product is suitable.
No AI decides anything here; the upcoming LLM step only explains this output.

## Rules (`RULES_V1` in `suitability.py`)

| Check | PASS / REVIEW / FAIL |
|---|---|
| **Compliance gates** | vulnerable client, stale profile, FATCA US person → REVIEW. AML: LOW → PASS, MEDIUM → REVIEW, HIGH → FAIL, missing/unknown → REVIEW |
| **Risk appetite** | Product level = max(structural level, historical level). Structural: CPN ≥100% protection = CONSERVATIVE, ≥90% = MODERATE, else AGGRESSIVE; ELN on an index with barrier ≤ 60% = MODERATE, else AGGRESSIVE; DCD = MODERATE. Historical (worst scenario return): ≥ 0% CONSERVATIVE, ≥ −15% MODERATE, else AGGRESSIVE. Product at or below client = PASS, one level above = REVIEW, two = FAIL |
| **Investment horizon** | tenor ≤ client horizon → PASS, else FAIL |
| **Loss tolerance** | worst scenario loss ≤ client tolerance → PASS, else FAIL |
| **Concentration** | (notional + existing exposure) / liquid net worth vs. appetite thresholds: CONSERVATIVE 10% / 15%, MODERATE 15% / 25%, AGGRESSIVE 20% / 30% (PASS limit / FAIL above). Notional > net worth → FAIL |

Overall: any FAIL → `NOT_SUITABLE`, else any REVIEW → `REVIEW_REQUIRED`, else `SUITABLE`.

## In the backend

`POST /api/assess` (authenticated) runs Module 2 then Module 3 for one case:

```json
{ "client_id": "CLT-IN-0001",
  "product": { "product_type": "ELN", "underlying": "NIFTY50", "tenor_months": 12,
               "principal": 1000000, "barrier_pct": 0.7, "coupon_pa": 0.12 } }
```

Response: `{ assessment, simulation, explanation, data_gaps, disclaimer }`. `assessment` is
the contract below, `simulation` is the full Module 2 output it was computed from. RMs can
assess any case, clients only their own. Every assessment, with its explanation, is appended
to the audit hash chain.

`explanation` has a plain-English `client` version and a technical `rm` briefing, written by
Groq (`LLM_PROVIDER=groq`, `GROQ_API_KEY` in `backend/.env`; model defaults to
`llama-3.3-70b-versatile`, override with `LLM_MODEL`). The LLM never decides: each reply is
checked (verdict wording, failed checks worded as failures, every number traceable to the
facts, banned phrases, no AML/FATCA detail in the client text) and replaced by a fixed
template if any check fails or no key is set; `source` and `fallback_reason` say which.
Clients only receive their own version, without compliance-flag detail.
The RM page shows it all in the **Suitability Assessment** card (`SuitabilityAssessmentCard.tsx`).

Wiring: `backend/app/assessment/bridge.py` (puts this folder on `sys.path`, like Module 2),
`backend/app/assessment/service.py` (case → client record, Module 2 → Module 3),
`backend/app/api/routes_assessment.py`.

## Output contract

```json
{
  "assessment_id": "suit_1a2b3c4d",
  "client_id": "CLT-IN-0001",
  "product_id": "prod_…",
  "simulation_run_id": "sim_…",
  "timestamp": "2026-10-04T10:00:00Z",
  "overall_status": "SUITABLE | REVIEW_REQUIRED | NOT_SUITABLE",
  "checks": {
    "risk_appetite":      {"status", "client_limit_category", "product_value_category",
                           "structural_category", "historical_category",
                           "worst_simulated_return_pct", "reason"},
    "investment_horizon": {"status", "client_limit_years", "product_value_years", "reason"},
    "loss_tolerance":     {"status", "client_limit_pct", "product_value_pct", "reason"},
    "concentration_risk": {"status", "client_limit_pct", "product_value_pct", "reason"}
  },
  "compliance_flags": {"vulnerable_client", "profile_stale", "fatca_us_person", "aml_risk"},
  "audit_meta": {"engine_version", "rule_set_version", "note"}
}
```

## Standalone

```powershell
python -m pytest -q tests                                  # rule unit tests
python run_batch.py --sim path\to\module2_output.json      # every client vs one product
```

`run_batch.py` writes `suitability_outputs/suitability_<client_id>.json` and
`batch_summary_report.json`.
