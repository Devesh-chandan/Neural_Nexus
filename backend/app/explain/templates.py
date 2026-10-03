"""
Deterministic fill-in-the-blank explanation templates (Section 10.4).
Used when LLM_PROVIDER=none, on API failure, timeout, or validation failure.
"""
from __future__ import annotations

from typing import Any, Dict


def _pct(v: float) -> str:
    return f"{v * 100:.1f}%"


def _inr(v: float) -> str:
    """Format as Indian rupee with lakh/crore notation."""
    if v >= 1e7:
        return f"₹{v/1e7:.2f} Cr"
    if v >= 1e5:
        return f"₹{v/1e5:.2f} L"
    return f"₹{v:,.0f}"


def client_template(facts: Dict[str, Any]) -> str:
    """Generate client-facing explanation from facts payload."""
    product = facts.get("product", {})
    profile = facts.get("profile", {})
    metrics = facts.get("metrics", {})
    suitability = facts.get("suitability", {})
    verdict = suitability.get("verdict", "CONDITIONALLY_SUITABLE")
    pt = product.get("product_type", "product")
    underlying = product.get("underlying", "the underlying")
    tenor = product.get("tenor_months", 12)
    principal = product.get("principal", 0)
    currency = product.get("currency", "INR")

    max_gain_pct = metrics.get("max_gain_pct", 0)
    max_loss_pct = metrics.get("max_loss_pct", 0)
    stress_loss = metrics.get("stress_loss_pct", 0)
    p_loss = metrics.get("p_loss", 0)

    # Product-specific line
    if pt == "ELN":
        barrier = product.get("barrier_pct", 0.70)
        coupon_pa = product.get("coupon_pa", 0.10)
        what_line = (
            f"This Equity-Linked Note is linked to {underlying}. You earn a fixed coupon of "
            f"{_pct(coupon_pa)} per year as long as {underlying} does not fall below "
            f"{_pct(barrier)} of its starting level at maturity."
        )
        earn_line = (
            f"If the investment ends well, you receive your full {_inr(principal)} back plus "
            f"the coupon — up to {_pct(max_gain_pct)} total over {tenor} months."
        )
        lose_line = (
            f"If {underlying} falls below the {_pct(barrier)} barrier, you lose money. "
            f"In the worst historical scenario, the loss was {_pct(max_loss_pct)} of your investment. "
            f"In a severe stress test (−30% market drop), the estimated loss is {_pct(stress_loss)}."
        )
    elif pt == "CPN":
        protection = product.get("protection_pct", 1.00)
        participation = product.get("participation_pct", 0.80)
        what_line = (
            f"This Capital-Protected Note guarantees {_pct(protection)} of your "
            f"{_inr(principal)} at maturity, while letting you participate in {_pct(participation)} "
            f"of any rise in {underlying}."
        )
        earn_line = (
            f"If {underlying} rises by 20%, you receive {_pct(participation * 0.20)} extra on top "
            f"of your protected {_pct(protection)}. Maximum potential gain: {_pct(max_gain_pct)}."
        )
        lose_line = (
            f"Your maximum loss is {_pct(max_loss_pct)} of your investment "
            f"({_inr(principal * max_loss_pct)}). However, this protection depends on the issuer "
            f"honouring its obligations — issuer credit risk is not modelled here."
        )
    else:  # DCD
        strike = product.get("strike", 0)
        interest_pa = product.get("interest_pa", 0.08)
        what_line = (
            f"This Dual Currency Deposit earns you {_pct(interest_pa)} per year interest on your "
            f"deposit. However, if the exchange rate moves against you (above {strike:.2f}), "
            f"your deposit is converted to the other currency at a less favourable rate."
        )
        earn_line = (
            f"If the exchange rate stays below {strike:.2f}, you receive your full deposit plus "
            f"{_pct(interest_pa * tenor / 12)} interest for the {tenor}-month period."
        )
        lose_line = (
            f"If the rate moves above {strike:.2f}, you receive the other currency. "
            f"In that case, your effective return in your home currency could be as low as "
            f"−{_pct(max_loss_pct)}. In a stress scenario, the estimated loss is {_pct(stress_loss)}."
        )

    # Verdict line
    if verdict == "SUITABLE":
        fit_line = (
            f"Based on your profile — {tenor}-month horizon, "
            f"{_pct(profile.get('loss_tolerance_pct', 0) / 100)} loss tolerance, "
            f"{profile.get('risk_appetite', 'moderate')} risk appetite — this product appears "
            f"consistent with your situation. Please confirm with your RM."
        )
    elif verdict == "CONDITIONALLY_SUITABLE":
        mismatches = suitability.get("mismatches", [])
        m_txt = "; ".join(m.get("message", "") for m in mismatches[:2]) if mismatches else "some parameters need review"
        fit_line = (
            f"This product has some considerations for your profile: {m_txt}. "
            f"Please review these points with your RM before proceeding."
        )
    else:
        mismatches = suitability.get("mismatches", [])
        m_txt = "; ".join(m.get("message", "") for m in mismatches[:2]) if mismatches else "it does not fit your profile"
        fit_line = (
            f"Based on the analysis, this product does not fit your profile: {m_txt}. "
            f"Please discuss alternatives with your RM."
        )

    discuss_line = (
        "Questions to raise with your RM: How does this compare to other options? "
        "What happens if the issuer defaults? Can you exit early if you need the money?"
    )

    return (
        f"**What this product does**\n{what_line}\n\n"
        f"**How you could earn**\n{earn_line}\n\n"
        f"**When you could lose money and how much**\n{lose_line}\n\n"
        f"**Why it does or does not fit you**\n{fit_line}\n\n"
        f"**What to discuss with your RM**\n{discuss_line}"
    )


def rm_template(facts: Dict[str, Any]) -> str:
    """Generate RM-facing technical explanation from facts payload."""
    product = facts.get("product", {})
    metrics = facts.get("metrics", {})
    suitability = facts.get("suitability", {})
    verdict = suitability.get("verdict", "CONDITIONALLY_SUITABLE")
    score = suitability.get("score", 0)
    rules = suitability.get("rules", [])
    tier = suitability.get("tier", 3)
    pt = product.get("product_type", "product")

    max_gain_pct = metrics.get("max_gain_pct", 0)
    max_loss_pct = metrics.get("max_loss_pct", 0)
    stress_loss = metrics.get("stress_loss_pct", 0)
    p_loss = metrics.get("p_loss", 0)
    cvar5 = metrics.get("cvar5_loss_pct", 0)
    replay_windows = metrics.get("n_windows", 0)
    indicative = metrics.get("indicative_pa", 0)

    rules_triggered = [r for r in rules if r.get("status") in ("RED", "AMBER")]
    rules_txt = "\n".join(
        f"- [{r.get('status')}] {r.get('rule_id')}: {r.get('message', '')}"
        for r in rules_triggered
    ) or "No rules triggered."

    return (
        f"**RM Technical Summary – {pt}**\n\n"
        f"**Verdict:** {verdict} | **Suitability score:** {score:.0f}/100 | **Risk tier:** {tier}/5\n\n"
        f"**Risk metrics:**\n"
        f"- Max gain: {_pct(max_gain_pct)} | Max loss (theoretical): {_pct(max_loss_pct)}\n"
        f"- Stress loss (configured shock): {_pct(stress_loss)}\n"
        f"- P(loss) – replay: {_pct(p_loss)} | CVaR5: {_pct(cvar5)}\n"
        f"- Replay windows: {replay_windows}\n"
        f"- Indicative coupon/participation/interest p.a.: {_pct(indicative)} (model-based, not issuer quote)\n\n"
        f"**Rules triggered:**\n{rules_txt}\n\n"
        f"*Data source and snapshot hash are in the audit trail.*"
    )
