"""Module 3 - deterministic suitability engine.

Maps Module 2's historical-replay output (`sim_results`) against one client record
(clients_india.json shape) and returns the suitability JSON contract. No AI: every
status comes from the fixed rules in RULES_V1. A later LLM step only narrates this
output; it never changes a status.
"""
import datetime
import uuid
from typing import Any, Dict, List

# ---------------------------------------------------------------------------
# CONFIGURATION & RULES (Mapped exactly to your business logic)
# ---------------------------------------------------------------------------
RULES_V1 = {
    "version": "suitability-rules-1.0",
    "level_rank": {"CONSERVATIVE": 1, "MODERATE": 2, "AGGRESSIVE": 3},
    "rank_name": {1: "CONSERVATIVE", 2: "MODERATE", 3: "AGGRESSIVE"},
    "eln_moderate_max_barrier": 0.60,
    "concentration": {
        "CONSERVATIVE": (0.10, 0.15),
        "MODERATE": (0.15, 0.25),
        "AGGRESSIVE": (0.20, 0.30)
    },
    "gate": {
        "vulnerable_client": "REVIEW",
        "profile_stale": "REVIEW",
        "fatca_us_person": "REVIEW",
        "aml_risk": {"HIGH": "FAIL", "MEDIUM": "REVIEW", "LOW": "PASS"}
    }
}

# ---------------------------------------------------------------------------
# HELPER FUNCTIONS
# ---------------------------------------------------------------------------
def _is_index(underlying: str) -> bool:
    """Basic heuristic for the hackathon to identify an Index vs Single Stock."""
    # SP500 / GSPC / NSEI / NSEBANK cover the backend's underlying keys and Yahoo tickers.
    known_indices = ["NIFTY", "SENSEX", "BANKNIFTY", "FINNIFTY", "SPX", "NDX",
                     "SP500", "GSPC", "NSEI", "NSEBANK"]
    return any(idx in underlying.upper() for idx in known_indices)


def _worst_return_pct(sim_results: Dict[str, Any]) -> float:
    """Worst `return_pct` (in percent, e.g. -18.4) across Module 2's scenarios."""
    scenarios: List[Dict[str, Any]] = sim_results.get("scenarios") or []
    if not scenarios:
        raise ValueError("Module 2 output has no scenarios; suitability cannot be assessed.")
    return min(float(s["return_pct"]) for s in scenarios)

# ---------------------------------------------------------------------------
# TIER 1: CORE ENGINE
# ---------------------------------------------------------------------------
class SuitabilityEngine:
    def __init__(self):
        self.rules = RULES_V1

    def run_assessment(self, client: Dict[str, Any], sim_results: Dict[str, Any]) -> Dict[str, Any]:
        """Main orchestrator: evaluates gates, dimensions, and computes the final JSON contract."""

        product = sim_results["audit"]["product"]

        # Run individual sub-checks
        compliance_flags = self._evaluate_compliance_gates(client)
        risk_appetite_check = self._evaluate_risk_appetite(client, product, sim_results)
        horizon_check = self._evaluate_investment_horizon(client, product)
        loss_tolerance_check = self._evaluate_loss_tolerance(client, sim_results)
        concentration_check = self._evaluate_concentration(client, product)

        checks = {
            "risk_appetite": risk_appetite_check,
            "investment_horizon": horizon_check,
            "loss_tolerance": loss_tolerance_check,
            "concentration_risk": concentration_check
        }

        # Determine Overall Status
        all_statuses = [flag["status"] for flag in compliance_flags.values()] + \
                       [check["status"] for check in checks.values()]

        if "FAIL" in all_statuses:
            overall_status = "NOT_SUITABLE"
        elif "REVIEW" in all_statuses:
            overall_status = "REVIEW_REQUIRED"
        else:
            overall_status = "SUITABLE"

        # Build final JSON output payload
        return {
            "assessment_id": f"suit_{uuid.uuid4().hex[:8]}",
            "client_id": client["client_id"],
            "product_id": sim_results.get("product_id") or product.get("product_id", "prod_unknown"),
            "simulation_run_id": sim_results.get("run_id", "sim_unknown"),
            "timestamp": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "overall_status": overall_status,
            "checks": checks,
            "compliance_flags": compliance_flags,
            "audit_meta": {
                "engine_version": "suitability-v1.0",
                "rule_set_version": self.rules["version"],
                "note": "Deterministic evaluation based strictly on mathematical bounds and defined risk categories."
            }
        }

    # -----------------------------------------------------------------------
    # DIMENSION 1: COMPLIANCE GATES
    # -----------------------------------------------------------------------
    def _evaluate_compliance_gates(self, client: Dict[str, Any]) -> Dict[str, Dict[str, str]]:
        meta = client.get("_meta", {})
        flags = {}

        # 1. Vulnerable Client
        if meta.get("vulnerable_client"):
            flags["vulnerable_client"] = {"status": self.rules["gate"]["vulnerable_client"], "reason": "Client is flagged as vulnerable; requires extra care and potential second sign-off."}
        else:
            flags["vulnerable_client"] = {"status": "PASS", "reason": "Client is not flagged as vulnerable."}

        # 2. Profile Stale
        if meta.get("profile_stale"):
            flags["profile_stale"] = {"status": self.rules["gate"]["profile_stale"], "reason": "Client risk profile not reviewed in over 12 months. Re-profiling due."}
        else:
            flags["profile_stale"] = {"status": "PASS", "reason": "Client profile freshness is up to date."}

        # 3. FATCA / US Person
        if meta.get("fatca_us_person"):
            flags["fatca_us_person"] = {"status": self.rules["gate"]["fatca_us_person"], "reason": "Client is a US person (FATCA). Many issuers restrict onboarding."}
        else:
            flags["fatca_us_person"] = {"status": "PASS", "reason": "Client is not a US person."}

        # 4. AML Risk
        aml_level = str(meta.get("aml_risk") or "LOW").upper()
        aml_rule = self.rules["gate"]["aml_risk"].get(aml_level, "REVIEW")
        if aml_rule != "PASS":
            flags["aml_risk"] = {"status": aml_rule, "reason": f"AML risk is flagged as {aml_level}. Enhanced due diligence required."}
        else:
            flags["aml_risk"] = {"status": "PASS", "reason": "AML risk is LOW."}

        return flags

    # -----------------------------------------------------------------------
    # DIMENSION 2: RISK APPETITE (Step A + Step B)
    # -----------------------------------------------------------------------
    def _evaluate_risk_appetite(self, client: Dict[str, Any], product: Dict[str, Any], sim_results: Dict[str, Any]) -> Dict[str, Any]:
        # An unknown appetite is treated as CONSERVATIVE (fail-safe), never as AGGRESSIVE.
        appetite = str(client["suitability_profile"].get("risk_appetite") or "").upper()
        client_rank = self.rules["level_rank"].get(appetite, 1)
        ptype = product["product_type"]

        # Step A: Level from Product Structure
        struct_level = 3 # default aggressive
        if ptype == "CPN":
            prot = product.get("protection_pct") or 0.0
            if prot >= 1.0: struct_level = 1
            elif prot >= 0.90: struct_level = 2
            else: struct_level = 3
        elif ptype == "ELN":
            # Module 2 sends barrier_pct = null for a no-barrier ELN -> aggressive.
            barrier = product.get("barrier_pct")
            if barrier is not None and _is_index(product.get("underlying", "")) and barrier <= self.rules["eln_moderate_max_barrier"]:
                struct_level = 2
            else:
                struct_level = 3 # Single stock, barrier > 60%, or no barrier
        elif ptype == "DCD":
            struct_level = 2

        # Step B: Level from Module 2's worst simulated scenario
        worst_ret = _worst_return_pct(sim_results)
        if worst_ret >= 0.0:
            sim_level = 1
        elif worst_ret >= -15.0:
            sim_level = 2
        else:
            sim_level = 3

        # Final Product Level = Higher of Step A and Step B
        product_level = max(struct_level, sim_level)

        # Match Client vs Product
        diff = product_level - client_rank
        if diff <= 0:
            status = "PASS"
        elif diff == 1:
            status = "REVIEW"
        else:
            status = "FAIL"

        return {
            "status": status,
            "client_limit_category": self.rules["rank_name"][client_rank],
            "product_value_category": self.rules["rank_name"][product_level],
            "structural_category": self.rules["rank_name"][struct_level],
            "historical_category": self.rules["rank_name"][sim_level],
            "worst_simulated_return_pct": round(worst_ret, 2),
            "reason": f"Client appetite is {self.rules['rank_name'][client_rank]}. Product structural risk is {self.rules['rank_name'][struct_level]} and historical worst-case risk is {self.rules['rank_name'][sim_level]} (max={self.rules['rank_name'][product_level]})."
        }

    # -----------------------------------------------------------------------
    # DIMENSION 3: INVESTMENT HORIZON
    # -----------------------------------------------------------------------
    def _evaluate_investment_horizon(self, client: Dict[str, Any], product: Dict[str, Any]) -> Dict[str, Any]:
        client_horizon_years = float(client["suitability_profile"]["investment_horizon_years"])
        product_tenor_years = float(product["tenor"]) / 12.0

        if client_horizon_years >= product_tenor_years:
            return {
                "status": "PASS",
                "client_limit_years": client_horizon_years,
                "product_value_years": round(product_tenor_years, 2),
                "reason": "Client's investment horizon safely covers the product tenor."
            }
        else:
            return {
                "status": "FAIL",
                "client_limit_years": client_horizon_years,
                "product_value_years": round(product_tenor_years, 2),
                "reason": f"Product tenor ({product_tenor_years:.1f}y) locks up capital longer than the client's stated horizon ({client_horizon_years:.1f}y)."
            }

    # -----------------------------------------------------------------------
    # DIMENSION 4: LOSS TOLERANCE
    # -----------------------------------------------------------------------
    def _evaluate_loss_tolerance(self, client: Dict[str, Any], sim_results: Dict[str, Any]) -> Dict[str, Any]:
        client_loss_tol = float(client["suitability_profile"]["loss_tolerance_pct"])
        worst_ret = _worst_return_pct(sim_results) / 100.0
        worst_loss = abs(min(0.0, worst_ret)) # Calculate actual downside percentage

        if worst_loss > client_loss_tol:
            return {
                "status": "FAIL",
                "client_limit_pct": round(-client_loss_tol, 4),
                "product_value_pct": round(worst_ret, 4),
                "reason": f"Maximum simulated historical loss ({(worst_ret*100):.1f}%) mathematically exceeds client's absolute loss tolerance ({-(client_loss_tol*100):.1f}%)."
            }
        return {
            "status": "PASS",
            "client_limit_pct": round(-client_loss_tol, 4),
            "product_value_pct": round(worst_ret, 4),
            "reason": "Worst-case historical loss remains within client tolerance."
        }

    # -----------------------------------------------------------------------
    # DIMENSION 5: CONCENTRATION RISK (The Wallet Check)
    # -----------------------------------------------------------------------
    def _evaluate_concentration(self, client: Dict[str, Any], product: Dict[str, Any]) -> Dict[str, Any]:
        notional = float(product["notional"])
        lnw = float(client["financial_information"].get("liquid_net_worth_inr") or 0)

        if lnw <= 0:
            return {
                "status": "FAIL",
                "client_limit_pct": 1.0,
                "product_value_pct": None,
                "reason": "Client has no recorded liquid net worth; the investment cannot be sized."
            }

        if notional > lnw:
            return {
                "status": "FAIL",
                "client_limit_pct": 1.0,
                "product_value_pct": round(notional / lnw, 4),
                "reason": "Notional investment size exceeds the client's total liquid net worth."
            }

        curr_pct = float(client["suitability_profile"].get("current_portfolio_concentration_pct") or 0)
        if curr_pct > 1.0:
            curr_pct = curr_pct / 100.0

        new_pct = (notional + (curr_pct * lnw)) / lnw

        # Get dynamic thresholds based on client risk appetite (unknown -> strictest)
        appetite = str(client["suitability_profile"].get("risk_appetite") or "").upper()
        thresholds = self.rules["concentration"].get(appetite, self.rules["concentration"]["CONSERVATIVE"])
        review_limit, fail_limit = thresholds

        if new_pct <= review_limit:
            status = "PASS"
        elif new_pct <= fail_limit:
            status = "REVIEW"
        else:
            status = "FAIL"

        return {
            "status": status,
            "client_limit_pct": fail_limit,
            "product_value_pct": round(new_pct, 4),
            "reason": f"Proposed investment pushes asset concentration to {new_pct*100:.1f}%. Safe PASS threshold for {appetite or 'UNKNOWN'} is {review_limit*100:.1f}%."
        }
