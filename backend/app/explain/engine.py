"""
The single plain-language explanation engine (for /api/analyze and /api/assess alike).

Two audiences, two separate LLM calls so nothing leaks between them:
  * client - plain English; compliance-gate details (AML, FATCA, ...) are never sent, only
             a yes/no "the bank needs extra checks";
  * rm     - technical; every check, limit, compliance flag and data gap.

The LLM only explains; the verdict and every status come from the rules. Each LLM reply is
validated (shape, verdict wording, FAIL checks worded as failures, every number traceable to
the facts, banned phrases, no compliance leak to the client) and replaced by a deterministic
template if any check fails or no LLM is configured.
"""
from __future__ import annotations

import json
import logging
import re
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, Dict, Iterable, List, Optional, Set, Tuple

from app.assessment.rules_engine import RULES_V1
from app.schemas.analysis import MetricsBundle
from app.core.config import get_suitability_rules
from app.explain.llm import active_model, call_llm_json, unavailable_reason

logger = logging.getLogger(__name__)

PROMPT_VERSION = "explain-v2"
CHECK_KEYS = ("risk_appetite", "investment_horizon", "loss_tolerance", "concentration_risk")

# ── Facts ─────────────────────────────────────────────────────────────────────

def _pct(fraction: Optional[float]) -> Optional[float]:
    return None if fraction is None else round(float(fraction) * 100, 2)


def _scenario(s: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "situation": s.get("situation"),
        "period": s.get("period"),
        "market_move_pct": s.get("market_move_pct"),
        "return_pct": s.get("return_pct"),
        "barrier_hit": s.get("barrier_hit"),
    }


def _product_facts(simulation: Dict[str, Any]) -> Dict[str, Any]:
    p = simulation["audit"]["product"]
    keys = ("product_type", "underlying", "notional", "coupon_pa", "strike_pct", "barrier_pct",
            "barrier_monitoring", "coupon_conditional", "protection_pct", "participation_pct", "cap_pct",
            "strike_rate", "alt_currency")
    facts = {k: p[k] for k in keys if p.get(k) not in (None, "")}
    facts["tenor_months"] = p["tenor"]
    for k in ("coupon_pa", "strike_pct", "barrier_pct", "protection_pct", "participation_pct", "cap_pct"):
        if k in facts:
            facts[k] = _pct(facts[k])  # as percentages, like every other *_pct fact
    facts["currency"] = simulation.get("currency")
    facts["payoff_rule"] = simulation["audit"].get("payoff_rule")
    return facts


def _history_facts(simulation: Dict[str, Any]) -> Dict[str, Any]:
    scenarios = sorted(simulation["scenarios"], key=lambda s: s["return_pct"])
    if len(scenarios) == 1 and "period" not in scenarios[0]:
        # Metrics-derived result (no dated scenarios): only the worst historical period is known.
        return {"periods_tested": None, "periods_with_a_loss": None,
                "worst_period": _scenario(scenarios[0]), "best_period": None,
                "data_as_of": None, "note": "Real past market periods replayed on this product. Not a forecast."}
    return {
        "periods_tested": len(scenarios),
        "periods_with_a_loss": sum(1 for s in scenarios if s["return_pct"] < 0),
        "worst_period": _scenario(scenarios[0]),
        "best_period": _scenario(scenarios[-1]),
        "data_as_of": simulation.get("data_as_of"),
        "note": "Real past market periods replayed on this product. Not a forecast.",
    }


_FX_RANGE_NOTE = "measured over a -20% to +25% move in the exchange rate"


def _risk_facts(metrics: Optional[MetricsBundle], product: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Loss / gain figures from the deterministic engine (None when no metrics were computed)."""
    if metrics is None:
        return None
    r = metrics.replay
    has_replay = r is not None and r.n_windows > 0
    facts: Dict[str, Any] = {
        "max_loss_pct": _pct(metrics.max_loss_pct),
        "max_gain_pct": _pct(metrics.max_gain_pct),   # None = no fixed upper limit (uncapped participation)
        "stress_loss_pct": _pct(metrics.stress_loss_pct),
        "historical_loss_probability_pct": _pct(r.p_loss) if has_replay else None,
        "tail_loss_pct": _pct(r.cvar5_loss_pct) if has_replay else None,
        "indicative_pricing_flag": metrics.pricing.flag,
    }
    if metrics.issuer_credit is not None:
        facts["issuer_default_probability_pct"] = _pct(metrics.issuer_credit.default_probability)
    if product.get("product_type") == "DCD":
        facts["max_loss_note"] = _FX_RANGE_NOTE
    return facts


def _additional_facts(assessment: Dict[str, Any], audience: str) -> Dict[str, Any]:
    """Extra checks (complexity, life stage, affordability, liquidity, notes) with their statuses."""
    out: Dict[str, Any] = {}
    for name, c in (assessment.get("additional_checks") or {}).items():
        if audience == "client" and name == "kyc_data":
            continue   # compliance-data completeness is never shown to the client
        out[name] = {"status": c["status"], "informational": c["informational"], "reason": c["reason"]}
    return out


def _check_facts(assessment: Dict[str, Any], client: Dict[str, Any], notional: float) -> Dict[str, Any]:
    c = assessment["checks"]
    appetite = str(client["suitability_profile"].get("risk_appetite") or "").upper()
    review_limit, fail_limit = RULES_V1["concentration"].get(appetite, RULES_V1["concentration"]["CONSERVATIVE"])
    ra, hz, lt, cr = (c[k] for k in CHECK_KEYS)
    return {
        "risk_appetite": {
            "status": ra["status"],
            "client_risk_appetite": ra["client_limit_category"],
            "product_risk_level": ra["product_value_category"],
            "risk_level_from_structure": ra.get("structural_category"),
            "risk_level_from_history": ra.get("historical_category"),
        },
        "investment_horizon": {
            "status": hz["status"],
            "client_horizon_years": hz["client_limit_years"],
            "product_tenor_years": hz["product_value_years"],
        },
        "loss_tolerance": {
            "status": lt["status"],
            "client_max_loss_pct": abs(_pct(lt["client_limit_pct"])),
            "worst_historical_return_pct": _pct(lt["product_value_pct"]),
        },
        "concentration_risk": {
            "status": cr["status"],
            "exposure_after_investment_pct": _pct(cr["product_value_pct"]),
            "comfortable_limit_pct": _pct(review_limit),
            "hard_limit_pct": _pct(fail_limit),
            "investment_amount": notional,
            "liquid_net_worth": client["financial_information"].get("liquid_net_worth_inr"),
        },
    }


def build_facts(
    assessment: Dict[str, Any], simulation: Dict[str, Any], client: Dict[str, Any], data_gaps: List[str],
    metrics: Optional[MetricsBundle] = None,
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """Return (client_facts, rm_facts). Facts never include the client's name or any free text."""
    flags = assessment["compliance_flags"]
    product = _product_facts(simulation)
    base = {
        "verdict": assessment["overall_status"],
        "product": product,
        "history": _history_facts(simulation),
        "risk_figures": _risk_facts(metrics, product),
        "checks": _check_facts(assessment, client, simulation["audit"]["product"]["notional"]),
    }
    client_facts = {
        **base,
        "additional_checks": _additional_facts(assessment, "client"),
        "compliance_review_required": any(f["status"] != "PASS" for f in flags.values()),
    }
    rm_facts = {
        **base,
        "additional_checks": _additional_facts(assessment, "rm"),
        "compliance_flags": flags,
        "check_reasons": {k: assessment["checks"][k]["reason"] for k in CHECK_KEYS},
        "data_gaps": data_gaps,
        "rule_set_version": assessment["audit_meta"]["rule_set_version"],
    }
    return client_facts, rm_facts

# ── Prompts ───────────────────────────────────────────────────────────────────

_COMMON_RULES = """
- The decision is final and was made by fixed rules. You only explain it. Never change, soften
  or second-guess the verdict or any check status.
- Use only facts in the payload. Do not calculate new numbers, estimate, or add facts. You may
  round a number to one decimal place.
- *_pct values are already percentages (-43.83 means -43.83%). Amounts are in the product currency.
- The history figures are real past market periods replayed on this product, not a forecast. Say so.
- Do not recommend buying or selling. Never use: guaranteed, risk-free, risk free, no risk,
  safe investment, cannot lose, will not lose, 100% safe.
- Headline wording by verdict: SUITABLE -> "suitable"; NOT_SUITABLE -> "not suitable";
  REVIEW_REQUIRED -> "needs a review" before any decision (do not call it suitable or not suitable).
- For every check with status FAIL, say plainly that it does not meet the limit.
- Any entry of additional_checks that is not informational and has status FAIL or REVIEW must be
  mentioned in the summary (one short sentence each).
- "product": explain the product from its terms and payoff_rule: "what" (what it is and how it pays),
  "earn" (how the holder earns; if risk_figures.max_gain_pct is null there is no fixed upper limit),
  "lose" (when money is lost and the worst case, risk_figures.max_loss_pct, with max_loss_note if present).
  For a CPN always say that capital protection depends on the issuer, using
  risk_figures.issuer_default_probability_pct as a generic illustration if present.
"""

CLIENT_SYSTEM_PROMPT = f"""You explain a completed suitability decision to a retail investor in plain English.
Rules:{_COMMON_RULES}- Explain each check in 1-2 short sentences, naming the investor's limit and the product's figure.
- In the summary, mention the worst past period (its dates and its result).
- If compliance_review_required is true, say only that the bank needs to complete some additional
  checks. Give no further detail about them.
Return JSON only, exactly this shape:
{{"headline": "one sentence", "summary": "2-4 sentences",
 "product": {{"what": "1-2 sentences", "earn": "1-2 sentences", "lose": "1-2 sentences"}},
 "checks": {{"risk_appetite": "...", "investment_horizon": "...", "loss_tolerance": "...", "concentration_risk": "..."}},
 "next_steps": ["1-3 short items"]}}"""

RM_SYSTEM_PROMPT = f"""You brief a relationship manager on a completed suitability assessment. Be concise and technical.
Rules:{_COMMON_RULES}- For each check give the status, the client limit and the product value.
- In "compliance", list every compliance flag whose status is not PASS with what it requires, or say all gates passed.
- Mention any data_gaps.
- "actions": concrete next steps for the RM (e.g. which REVIEW items need sign-off, what to re-profile).
Return JSON only, exactly this shape:
{{"headline": "one sentence", "summary": "2-4 sentences",
 "product": {{"what": "1-2 sentences", "earn": "1-2 sentences", "lose": "1-2 sentences"}},
 "checks": {{"risk_appetite": "...", "investment_horizon": "...", "loss_tolerance": "...", "concentration_risk": "..."}},
 "compliance": "...", "actions": ["1-4 short items"]}}"""

# ── Validation ────────────────────────────────────────────────────────────────

_NOT_SUITABLE_PHRASES = ("not suitable", "isn't suitable", "unsuitable", "does not fit", "doesn't fit", "not a fit")
_FAIL_CUES = ("not", "n't", "exceed", "beyond", "longer than", "more than", "above", "higher than",
              "too ", "outside", "fail", "short of", "cannot", "unable")
_CLIENT_LEAK = re.compile(r"\b(aml|anti-money|money laundering|fatca|us person|u\.s\. person|"
                          r"politically exposed|pep|vulnerable)\b", re.IGNORECASE)
_NUMBER = re.compile(r"\d[\d,]*(?:\.\d+)?")


def _walk_numbers(obj: Any) -> Iterable[float]:
    if isinstance(obj, bool) or obj is None:
        return
    if isinstance(obj, (int, float)):
        yield float(obj)
    elif isinstance(obj, str):
        for m in _NUMBER.findall(obj):
            yield float(m.replace(",", ""))
    elif isinstance(obj, dict):
        for v in obj.values():
            yield from _walk_numbers(v)
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            yield from _walk_numbers(v)


def _allowed_numbers(facts: Dict[str, Any]) -> Set[float]:
    allowed: Set[float] = set(float(n) for n in range(0, 32))  # counts, days, "one of 20 periods"
    for x in _walk_numbers(facts):
        for v in (x, x * 100, x / 100, x * 12, x / 12, x / 1e5, x / 1e6, x / 1e7):
            v = abs(v)
            allowed.update({v, round(v), round(v, 1), round(v, 2)})
    return allowed


def _is_grounded(n: float, allowed: Set[float]) -> bool:
    return any(abs(n - a) <= 0.06 or (a and abs(n - a) / a <= 0.006) for a in allowed)


PRODUCT_KEYS = ("what", "earn", "lose")


def _texts(expl: Dict[str, Any]) -> List[str]:
    out = [expl.get("headline", ""), expl.get("summary", ""), expl.get("compliance", "")]
    out += list((expl.get("product") or {}).values())
    out += list((expl.get("checks") or {}).values())
    out += list(expl.get("next_steps") or expl.get("actions") or [])
    return [t for t in out if isinstance(t, str)]


def validate_explanation(expl: Any, facts: Dict[str, Any], audience: str) -> List[str]:
    """Return a list of problems; empty means the explanation can be shown."""
    if not isinstance(expl, dict):
        return ["Reply is not a JSON object."]
    problems: List[str] = []
    list_key = "next_steps" if audience == "client" else "actions"
    required = ["headline", "summary"] + (["compliance"] if audience == "rm" else [])
    for key in required:
        if not isinstance(expl.get(key), str) or not expl[key].strip():
            problems.append(f"Missing '{key}'.")
    checks = expl.get("checks")
    if not isinstance(checks, dict) or any(not isinstance(checks.get(k), str) or not checks[k].strip()
                                           for k in CHECK_KEYS):
        problems.append("Missing an explanation for one of the four checks.")
    prod = expl.get("product")
    if not isinstance(prod, dict) or any(not isinstance(prod.get(k), str) or not prod[k].strip()
                                         for k in PRODUCT_KEYS):
        problems.append("Missing the 'product' explanation (what / earn / lose).")
    items = expl.get(list_key)
    if not isinstance(items, list) or not items or not all(isinstance(i, str) and i.strip() for i in items):
        problems.append(f"Missing '{list_key}'.")
    if problems:
        return problems

    lead = f"{expl['headline']} {expl['summary']}".lower()
    verdict = facts["verdict"]
    says_not = any(p in lead for p in _NOT_SUITABLE_PHRASES)
    if verdict == "NOT_SUITABLE" and not says_not:
        problems.append("Verdict is NOT_SUITABLE but the headline/summary does not say so.")
    if verdict == "SUITABLE" and (says_not or "suitable" not in lead):
        problems.append("Verdict is SUITABLE but the headline/summary does not say so.")
    if verdict == "REVIEW_REQUIRED" and ("review" not in lead or says_not):
        problems.append("Verdict is REVIEW_REQUIRED but the headline/summary does not say a review is needed.")

    for key in CHECK_KEYS:
        if facts["checks"][key]["status"] == "FAIL" and not any(c in checks[key].lower() for c in _FAIL_CUES):
            problems.append(f"Check '{key}' failed but its explanation does not say so.")

    all_text = " ".join(_texts(expl))
    lower = all_text.lower()
    for phrase in get_suitability_rules().get("llm_forbidden_phrases", []):
        if phrase.lower() in lower:
            problems.append(f"Banned phrase '{phrase}'.")
    if audience == "client" and _CLIENT_LEAK.search(all_text):
        problems.append("Client text mentions compliance-screening details.")

    if facts["product"].get("product_type") == "CPN" and "issuer" not in lower:
        problems.append("A CPN explanation must say that capital protection depends on the issuer.")

    allowed = _allowed_numbers(facts)
    ungrounded = sorted({m for m in _NUMBER.findall(all_text)
                         if not _is_grounded(float(m.replace(",", "")), allowed)})
    if ungrounded:
        problems.append(f"Numbers not in the facts: {', '.join(ungrounded[:5])}.")

    words = len(all_text.split())
    if not 40 <= words <= 500:
        problems.append(f"Length {words} words is outside 40-500.")
    return problems

# ── Templates (deterministic fallback) ────────────────────────────────────────

def _money(x: Optional[float], currency: Optional[str]) -> str:
    if x is None:
        return "n/a"
    return f"{'₹' if (currency or 'INR') == 'INR' else (currency or '') + ' '}{x:,.0f}"


def _lead(verdict: str, audience: str) -> str:
    who = "you" if audience == "client" else "this client"
    return {
        "SUITABLE": f"This product is suitable for {who} under our suitability rules.",
        "NOT_SUITABLE": f"This product is not suitable for {who} under our suitability rules.",
        "REVIEW_REQUIRED": f"This product needs a review before any decision can be made for {who}.",
    }[verdict]


def _history_sentence(facts: Dict[str, Any]) -> str:
    h = facts["history"]
    w = h["worst_period"]
    if h["periods_tested"] is None:
        return (f"In the worst real past market period we tested, this product returned {w['return_pct']:.1f}%. "
                "That is a past period, not a forecast.")
    losses = (f"it lost money in {h['periods_with_a_loss']} of them" if h["periods_with_a_loss"]
              else "it did not lose money in any of them")
    return (f"We replayed it on {h['periods_tested']} real past market periods; {losses}. "
            f"The worst was {w['period']['start']} to {w['period']['end']}, when it returned "
            f"{w['return_pct']:.1f}%. These are past periods, not a forecast.")


def _check_sentences(facts: Dict[str, Any], audience: str) -> Dict[str, str]:
    c = facts["checks"]
    you = "your" if audience == "client" else "the client's"
    ra, hz, lt, cr = (c[k] for k in CHECK_KEYS)
    cur = facts["product"].get("currency")
    risk = {
        "PASS": f"The product's risk level ({ra['product_risk_level'].lower()}) is within {you} "
                f"{ra['client_risk_appetite'].lower()} risk appetite.",
        "REVIEW": f"The product's risk level ({ra['product_risk_level'].lower()}) is one step above {you} "
                  f"{ra['client_risk_appetite'].lower()} risk appetite, so it needs a review.",
        "FAIL": f"The product's risk level ({ra['product_risk_level'].lower()}) is too high for {you} "
                f"{ra['client_risk_appetite'].lower()} risk appetite.",
    }[ra["status"]]
    horizon = (f"The {hz['product_tenor_years']:g}-year term fits within {you} {hz['client_horizon_years']:g}-year horizon."
               if hz["status"] == "PASS" else
               f"The {hz['product_tenor_years']:g}-year term is longer than {you} {hz['client_horizon_years']:g}-year horizon.")
    loss = (f"The worst past result ({lt['worst_historical_return_pct']:.1f}%) stays within {you} "
            f"maximum acceptable loss of {lt['client_max_loss_pct']:.1f}%."
            if lt["status"] == "PASS" else
            f"The worst past result ({lt['worst_historical_return_pct']:.1f}%) is a bigger loss than {you} "
            f"maximum acceptable loss of {lt['client_max_loss_pct']:.1f}%, so it does not meet that limit.")
    exposure = cr["exposure_after_investment_pct"]
    if exposure is None:
        conc = f"There is no liquid net worth on file, so the {_money(cr['investment_amount'], cur)} amount cannot be sized."
    else:
        conc = {
            "PASS": f"Investing {_money(cr['investment_amount'], cur)} brings exposure to {exposure:.1f}% of liquid "
                    f"net worth, within the {cr['comfortable_limit_pct']:.1f}% comfortable limit.",
            "REVIEW": f"Investing {_money(cr['investment_amount'], cur)} brings exposure to {exposure:.1f}% of liquid "
                      f"net worth, above the {cr['comfortable_limit_pct']:.1f}% comfortable limit, so it needs a review.",
            "FAIL": f"Investing {_money(cr['investment_amount'], cur)} brings exposure to {exposure:.1f}% of liquid "
                    f"net worth, above the {cr['hard_limit_pct']:.1f}% limit.",
        }[cr["status"]]
    return dict(zip(CHECK_KEYS, (risk, horizon, loss, conc)))


def _money_pct(v: Optional[float]) -> str:
    return "n/a" if v is None else f"{v:.1f}%"


def product_sentences(facts: Dict[str, Any]) -> Dict[str, str]:
    """Deterministic what / earn / lose text from the product terms and the engine's figures."""
    p, risk = facts["product"], facts.get("risk_figures") or {}
    pt, name = p["product_type"], p.get("underlying", "the underlying")
    tenor = f"{p['tenor_months']:g}-month"
    loss_pct = risk.get("max_loss_pct")
    gain = risk.get("max_gain_pct")
    issuer = risk.get("issuer_default_probability_pct")
    if pt == "ELN":
        barrier, coupon = p.get("barrier_pct"), p.get("coupon_pa", 0.0)
        watch = "on any daily close" if p.get("barrier_monitoring", "daily") == "daily" else "at maturity"
        if barrier is None:
            what = f"This {tenor} Equity-Linked Note is linked to {name} and pays a coupon of {coupon:.1f}% a year."
        elif p.get("coupon_conditional"):
            what = (f"This {tenor} Equity-Linked Note is linked to {name}. It pays a coupon of {coupon:.1f}% a year only "
                    f"if {name} never ends {watch} below {barrier:.1f}% of its starting level; otherwise the coupon is lost.")
        else:
            what = (f"This {tenor} Equity-Linked Note is linked to {name}. It pays a fixed coupon of {coupon:.1f}% a year "
                    f"whatever {name} does, but your principal is at risk if {name} falls below {barrier:.1f}% of its "
                    f"starting level {watch}.")
        earn = ("If the barrier is not breached you receive your principal back plus the coupon"
                + (f", about {_money_pct(gain)} in total over the term." if gain is not None else "."))
        lose = ("If the barrier is breached and the underlying ends below its starting level you share its fall"
                + (f"; in the worst case, a collapse of {name}, the loss could be {_money_pct(loss_pct)} of the amount invested."
                   if loss_pct is not None else "."))
    elif pt == "CPN":
        prot, part = p.get("protection_pct", 100.0), p.get("participation_pct", 0.0)
        what = (f"This {tenor} Capital-Protected Note returns {prot:.0f}% of your money at maturity and passes on "
                f"{part:.0f}% of any rise in {name}.")
        earn = ("If " + name + " rises you receive the participation share on top of the protected amount; there is "
                + ("no fixed upper limit on the gain." if gain is None else f"a cap, so the best case is about {_money_pct(gain)}."))
        lose = (f"Your loss from the market is limited to {_money_pct(loss_pct)} of the amount invested. "
                if loss_pct is not None else "") + (
            "The protection depends on the issuer paying what it owes"
            + (f"; as a generic illustration a typical bank issuer has about a {issuer:.1f}% chance of default over the term."
               if issuer is not None else "."))
    else:  # DCD
        strike, alt = p.get("strike_rate"), p.get("alt_currency")
        what = (f"This {tenor} Dual Currency Deposit pays {p.get('coupon_pa', 0):.1f}% a year in interest, but the bank may "
                f"repay you in {alt} at the {strike:g} strike instead of your deposit currency.")
        earn = "If the exchange rate stays on the safe side of the strike you get your deposit back plus the full interest."
        lose = ("If the rate moves past the strike you are repaid in the other currency at the strike, which is worth less "
                "than your deposit at the market rate"
                + (f"; over the range tested the loss reached {_money_pct(loss_pct)}." if loss_pct is not None else "."))
    return {"what": what, "earn": earn, "lose": lose}


def _additional_sentences(facts: Dict[str, Any]) -> List[str]:
    return [f"{v['reason']}" for v in (facts.get("additional_checks") or {}).values()
            if not v["informational"] and v["status"] != "PASS"]


def client_template(facts: Dict[str, Any]) -> Dict[str, Any]:
    summary = " ".join([_history_sentence(facts)] + _additional_sentences(facts))
    if facts["compliance_review_required"]:
        summary += " The bank also needs to complete some additional checks."
    steps = {
        "SUITABLE": ["Go through the product terms with your relationship manager before deciding."],
        "NOT_SUITABLE": ["Ask your relationship manager about products that match your profile."],
        "REVIEW_REQUIRED": ["Your relationship manager will complete the review and contact you."],
    }[facts["verdict"]]
    return {"headline": _lead(facts["verdict"], "client"), "summary": summary,
            "product": product_sentences(facts),
            "checks": _check_sentences(facts, "client"), "next_steps": steps}


def rm_template(facts: Dict[str, Any]) -> Dict[str, Any]:
    flagged = {k: v for k, v in facts["compliance_flags"].items() if v["status"] != "PASS"}
    compliance = (" ".join(f"{k} = {v['status']}: {v['reason']}" for k, v in flagged.items())
                  if flagged else "All compliance gates passed.")
    actions: List[str] = []
    for k in CHECK_KEYS:
        st = facts["checks"][k]["status"]
        if st != "PASS":
            actions.append(f"{k}: {st} - {facts['check_reasons'][k]}")
    actions += [f"{k}: {v['status']} - resolve before proceeding." for k, v in flagged.items()]
    actions += [f"Data gap: {g}" for g in facts["data_gaps"]]
    flagged_extra = {k: v for k, v in (facts.get("additional_checks") or {}).items() if v["status"] != "PASS"}
    actions += [f"{k.replace('_', ' ')}: {v['status']}{' (note)' if v['informational'] else ''} - {v['reason']}"
                for k, v in flagged_extra.items()]
    summary = f"{_history_sentence(facts)} Rule set {facts['rule_set_version']}."
    return {"headline": _lead(facts["verdict"], "rm"), "summary": summary,
            "product": product_sentences(facts),
            "checks": {k: f"{facts['checks'][k]['status']} - {facts['check_reasons'][k]}" for k in CHECK_KEYS},
            "compliance": compliance,
            "actions": actions or ["No exceptions; proceed with the standard sign-off."]}

# ── Orchestration ─────────────────────────────────────────────────────────────

def _one_audience(
    facts: Dict[str, Any], audience: str, system_prompt: str, template: Callable[[Dict[str, Any]], Dict[str, Any]]
) -> Dict[str, Any]:
    reason = unavailable_reason()
    if reason is None:
        reply = call_llm_json(system_prompt, json.dumps(facts, indent=2, default=str), max_tokens=900)
        if reply is None:
            reason = "The LLM call failed."
        else:
            problems = validate_explanation(reply, facts, audience)
            if not problems:
                return {**reply, "source": "llm", "fallback_reason": None}
            reason = "LLM reply failed validation: " + " ".join(problems[:3])
            logger.warning("Suitability %s explanation rejected: %s", audience, reason)
    return {**template(facts), "source": "template", "fallback_reason": reason}


_LEGACY_VERDICT = {"SUITABLE": "SUITABLE", "REVIEW_REQUIRED": "CONDITIONALLY_SUITABLE",
                   "NOT_SUITABLE": "NOT_SUITABLE"}
_RULE_TAG = {"PASS": "GREEN", "REVIEW": "AMBER", "FAIL": "RED"}
_CLIENT_QUESTIONS = ("Questions to raise with your RM: How does this compare to other options? "
                     "What happens if the issuer defaults? Can you exit early if you need the money?")


def render_client_text(expl: Dict[str, Any]) -> str:
    """Client explanation as the sectioned text the dashboard card parses (**Header** newline body)."""
    prod = expl["product"]
    fit = " ".join([expl["headline"], expl["summary"], *expl["checks"].values(), *expl["next_steps"]])
    return (
        f"**What this product does**\n{prod['what']}\n\n"
        f"**How you could earn**\n{prod['earn']}\n\n"
        f"**When you could lose money and how much**\n{prod['lose']}\n\n"
        f"**Why it does or does not fit you**\n{fit}\n\n"
        f"**What to discuss with your RM**\n{_CLIENT_QUESTIONS}"
    )


def render_rm_text(expl: Dict[str, Any], facts: Dict[str, Any], assessment: Dict[str, Any],
                   metrics: Optional[MetricsBundle], suitability: Optional[Any]) -> str:
    """RM briefing as the line format the dashboard card parses (verdict line, metrics, rules, narrative)."""
    verdict = _LEGACY_VERDICT[assessment["overall_status"]]
    head = f"**Verdict:** {verdict}"
    if suitability is not None:
        head += f" | **Suitability score:** {suitability.score:.0f}/100 | **Risk tier:** {suitability.tier}/5"
    lines = [f"**RM Technical Summary – {facts['product']['product_type']}**", "", head, ""]

    def pct(v: Optional[float]) -> str:
        return "n/a" if v is None else f"{v * 100:.1f}%"

    if metrics is not None:
        r = metrics.replay
        has = r is not None and r.n_windows > 0
        gain = "no fixed upper limit" if metrics.max_gain_pct is None else pct(metrics.max_gain_pct)
        lines += [
            "**Risk metrics:**",
            f"- Max gain: {gain} | Max loss (theoretical): {pct(metrics.max_loss_pct)}",
            f"- Stress loss (configured shock): {pct(metrics.stress_loss_pct)}",
            f"- P(loss) – replay: {pct(r.p_loss) if has else 'n/a'} | CVaR5: {pct(r.cvar5_loss_pct) if has else 'n/a'}",
            f"- Replay windows: {r.n_windows if r else 0}",
            f"- Indicative coupon/participation/interest p.a.: {pct(metrics.pricing.indicative)} "
            "(model-based, not issuer quote)",
            "",
        ]
    if suitability is not None:
        triggered = [f"- [{x.status}] {x.rule_id}: {x.message}" for x in suitability.rules if x.status in ("RED", "AMBER")]
    else:
        triggered = [f"- [{_RULE_TAG[c['status']]}] {k}: {c['reason']}" for k, c in assessment["checks"].items()
                     if c["status"] != "PASS"]
    lines += ["**Rules triggered:**", *(triggered or ["No rules triggered."]), ""]
    lines += [expl["headline"], expl["summary"], expl["product"]["lose"], expl["compliance"],
              *expl["actions"], "", "*Data source and snapshot hash are in the audit trail.*"]
    return "\n".join(lines)


def explain_assessment(
    assessment: Dict[str, Any], simulation: Dict[str, Any], client: Dict[str, Any], data_gaps: List[str],
    *, metrics: Optional[MetricsBundle] = None, suitability: Optional[Any] = None,
) -> Dict[str, Any]:
    """Explain one assessment for the client and the RM. The same function serves /api/analyze and /api/assess.

    Returns the structured explanations (`client`, `rm`) plus the rendered texts (`client_text`,
    `rm_text`) and a `validation` block that re-checks the final text against the facts.
    """
    client_facts, rm_facts = build_facts(assessment, simulation, client, data_gaps, metrics)
    with ThreadPoolExecutor(max_workers=2) as pool:
        client_future = pool.submit(_one_audience, client_facts, "client", CLIENT_SYSTEM_PROMPT, client_template)
        rm_future = pool.submit(_one_audience, rm_facts, "rm", RM_SYSTEM_PROMPT, rm_template)
        client_expl, rm_expl = client_future.result(), rm_future.result()
    used_llm = "llm" in (client_expl["source"], rm_expl["source"])

    checks = []
    for audience, expl, facts in (("client", client_expl, client_facts), ("rm", rm_expl, rm_facts)):
        problems = validate_explanation(expl, facts, audience)
        checks.append({"check_name": f"{audience}_explanation", "passed": not problems,
                       "detail": "; ".join(problems) or None})
    fallback = client_expl["fallback_reason"] or rm_expl["fallback_reason"]
    return {
        "client": client_expl,
        "rm": rm_expl,
        "model": active_model() if used_llm else None,
        "prompt_version": PROMPT_VERSION,
        "source": "llm" if used_llm else "template",
        "fallback_reason": fallback,
        "validation": {"passed": all(c["passed"] for c in checks), "checks": checks},
        "client_text": render_client_text(client_expl),
        "rm_text": render_rm_text(rm_expl, rm_facts, assessment, metrics, suitability),
    }
