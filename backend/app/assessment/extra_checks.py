"""
Profile-and-product checks that the core replay rules (`rules_engine`) do not cover.

Decisive (can change the verdict): product complexity vs experience, life stage, affordability
(position vs liquid net worth and income) and liquidity needs. Informational (reported, never
change the verdict): currency risk, indicative-pricing sanity and KYC data completeness.

Thresholds come from config/suitability_rules.yaml and config/registration.yaml.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from app.core.config import (
    get_registration_config,
    get_suitability_rules,
    get_underlyings,
)
from app.schemas.analysis import MetricsBundle
from app.schemas.client import ClientProfile
from app.schemas.suitability import RuleResult


def _rule(
    rule_id: str,
    dimension: str,
    status: str,
    severity: float,
    message_key: str,
    message: str,
    facts: Dict[str, Any],
) -> RuleResult:
    return RuleResult(
        rule_id=rule_id,
        dimension=dimension,
        status=status,
        severity=round(severity, 4),
        message_key=message_key,
        message=message,
        facts=facts,
    )


def rule_complexity(config: object, profile: ClientProfile) -> RuleResult:
    """R-COMPLEX: Complexity vs investor experience."""
    cfg = get_suitability_rules()["rules"]["R-COMPLEX"]
    complexity_scores = cfg["complexity_scores"]
    experience_levels = cfg["experience_levels"]

    pt = config.product_type  # type: ignore[attr-defined]
    complexity = complexity_scores.get(pt, 2)
    exp_level = experience_levels.get(profile.experience, 0)
    diff = complexity - (exp_level + 1)

    facts = {
        "product_type": pt,
        "complexity_score": complexity,
        "experience": profile.experience,
        "experience_level": exp_level,
        "diff": diff,
    }

    if diff >= cfg["red_diff"]:
        return _rule(
            "R-COMPLEX", "complexity", "RED", 1.0,
            "rcomplex_too_complex",
            f"{pt} is too complex (score {complexity}) for a {profile.experience} investor.",
            facts,
        )
    if diff >= cfg["amber_diff"]:
        return _rule(
            "R-COMPLEX", "complexity", "AMBER", 0.5,
            "rcomplex_borderline",
            f"{pt} complexity (score {complexity}) may be challenging for a {profile.experience} investor.",
            facts,
        )
    return _rule("R-COMPLEX", "complexity", "GREEN", 0.0, "rcomplex_ok", "Product complexity matches your experience.", facts)


def rule_fx(config: object, profile: ClientProfile) -> RuleResult:
    """R-FX: Currency risk informational flag."""
    underlyings = get_underlyings()
    underlying_key = config.underlying  # type: ignore[attr-defined]
    asset_info = underlyings.get(underlying_key, {})
    asset_type = asset_info.get("type", "equity")
    asset_currency = asset_info.get("currency", "INR")
    is_dcd = config.product_type == "DCD"  # type: ignore[attr-defined]

    client_currency = "INR"  # client net worth and income are recorded in INR
    has_fx_risk = is_dcd or (asset_currency != client_currency)

    facts = {
        "product_type": config.product_type,  # type: ignore[attr-defined]
        "underlying": underlying_key,
        "asset_currency": asset_currency,
        "client_assumed_currency": client_currency,
        "is_dcd": is_dcd,
    }

    if has_fx_risk:
        return _rule(
            "R-FX", "currency_risk", "AMBER", 0.3,
            "rfx_currency_risk",
            "This product involves foreign currency exposure. Exchange rate movements may affect returns.",
            facts,
        )
    return _rule("R-FX", "currency_risk", "GREEN", 0.0, "rfx_ok", "No additional currency risk.", facts)


def rule_pricing(metrics: MetricsBundle) -> RuleResult:
    """R-PRICE: Pricing sanity informational flag."""
    flag = metrics.pricing.flag
    facts = {
        "pricing_flag": flag,
        "indicative_pa": metrics.pricing.indicative,
    }
    if flag == "coupon_above_indicative":
        return _rule(
            "R-PRICE", "pricing_sanity", "AMBER", 0.3,
            "rprice_above_indicative",
            "The coupon/return looks unusually high relative to the modelled fair value – verify with the issuer.",
            facts,
        )
    return _rule("R-PRICE", "pricing_sanity", "GREEN", 0.0, "rprice_ok", "Coupon is within the indicative range.", facts)


def rule_life_stage(config: object, profile: ClientProfile) -> RuleResult:
    """
    R-AGE: Life-stage vs product lock-up.

    Age exists for one reason: do not lock money up past the point where the
    client needs it. Thresholds are illustrative (see config/registration.yaml).
    """
    th = get_registration_config()["client_thresholds"]
    min_age = th["min_investor_age"]
    retirement_age = th["assumed_retirement_age"]

    age = profile.age_years
    tenor = config.tenor_months  # type: ignore[attr-defined]
    horizon = profile.horizon_months

    facts: Dict[str, Any] = {
        "age_years": age,
        "min_investor_age": min_age,
        "assumed_retirement_age": retirement_age,
        "tenor_months": tenor,
        "horizon_months": horizon,
        "years_to_retirement": None if age is None else round(retirement_age - age, 2),
    }

    if age is None:
        return _rule(
            "R-AGE", "life_stage", "GREEN", 0.0,
            "rage_age_unknown",
            "Date of birth not captured; life-stage check skipped.",
            facts,
        )

    if age < min_age:
        return _rule(
            "R-AGE", "life_stage", "RED", 1.0,
            "rage_below_minimum_age",
            f"Investor age {age} is below the minimum age of {min_age} for structured products.",
            facts,
        )

    years_to_retirement = retirement_age - age
    if years_to_retirement <= 0:
        if tenor > horizon:
            return _rule(
                "R-AGE", "life_stage", "RED", 0.9,
                "rage_lockup_past_retirement",
                f"You are past the assumed retirement age of {retirement_age}, and this product "
                f"locks money up for longer ({tenor}m) than your stated horizon ({horizon}m).",
                facts,
            )
        return _rule(
            "R-AGE", "life_stage", "AMBER", 0.5,
            "rage_post_retirement",
            f"You are past the assumed retirement age of {retirement_age}. Confirm this position "
            "is funded from capital rather than from income you need.",
            facts,
        )

    if horizon / 12.0 > years_to_retirement:
        return _rule(
            "R-AGE", "life_stage", "AMBER", 0.6,
            "rage_horizon_beyond_retirement",
            f"Your stated horizon ({horizon / 12:.1f} years) runs past your assumed retirement "
            f"in {years_to_retirement:.1f} years.",
            facts,
        )

    return _rule(
        "R-AGE", "life_stage", "GREEN", 0.0,
        "rage_ok",
        f"Lock-up period ends well before retirement (~{years_to_retirement:.0f} years away).",
        facts,
    )


def rule_affordability(config: object, profile: ClientProfile) -> RuleResult:
    """
    R-AFFORD: Can the client actually absorb this position?

    Compares the ticket size against liquid net worth and annual income, so the
    engine never recommends a position that would damage the client's cash flow.
    """
    th = get_registration_config()["client_thresholds"]
    amber_alloc = th["amber_allocation_of_liquid_net_worth"]
    red_alloc = th["red_allocation_of_liquid_net_worth"]
    amber_income_mult = th["amber_income_multiple"]
    red_income_mult = th["red_income_multiple"]

    amount = profile.investment_amount
    allocation = profile.allocation_of_liquid_net_worth
    income_multiple = profile.income_multiple
    lumpy = config.product_type in ("CPN", "DCD")  # type: ignore[attr-defined]

    facts: Dict[str, Any] = {
        "investment_amount": amount,
        "liquid_net_worth": profile.liquid_net_worth,
        "allocation_of_liquid_net_worth": None if allocation is None else round(allocation, 4),
        "amber_allocation_threshold": amber_alloc,
        "red_allocation_threshold": red_alloc,
        "annual_income": profile.annual_income,
        "income_multiple": None if income_multiple is None else round(income_multiple, 2),
        "is_lumpy_product": lumpy,
    }

    # Hard affordability failure: ticket larger than liquid net worth.
    if allocation is not None and allocation > 1.0:
        return _rule(
            "R-AFFORD", "affordability", "RED", 1.0,
            "rafford_exceeds_liquid_net_worth",
            "The investment amount exceeds your liquid net worth.",
            facts,
        )

    if allocation is not None and allocation >= red_alloc:
        return _rule(
            "R-AFFORD", "affordability", "RED", 0.9,
            "rafford_allocation_too_large",
            f"This position is {allocation:.1%} of your liquid net worth, above the "
            f"{red_alloc:.0%} limit for a single structured product.",
            facts,
        )

    if allocation is not None and allocation >= amber_alloc:
        return _rule(
            "R-AFFORD", "affordability", "AMBER", 0.6,
            "rafford_allocation_elevated",
            f"This position is {allocation:.1%} of your liquid net worth "
            f"(guideline: below {amber_alloc:.0%}).",
            facts,
        )

    if income_multiple is not None and income_multiple >= red_income_mult:
        return _rule(
            "R-AFFORD", "affordability", "RED", 0.85,
            "rafford_income_multiple_too_high",
            f"This position is {income_multiple:.1f}× your annual income. A single "
            "illiquid position of this size would be unsafe for your cash flow.",
            facts,
        )

    if income_multiple is not None and income_multiple >= amber_income_mult:
        return _rule(
            "R-AFFORD", "affordability", "AMBER", 0.5,
            "rafford_income_multiple_elevated",
            f"This position is {income_multiple:.1f}× your annual income; keep it below "
            f"{amber_income_mult:.0f}× so it is not load-bearing for your expenses.",
            facts,
        )

    return _rule(
        "R-AFFORD", "affordability", "GREEN", 0.0,
        "rafford_ok",
        "Position size is comfortable relative to your liquid assets and income.",
        facts,
    )


def rule_kyc_completeness(profile: ClientProfile) -> RuleResult:
    """
    R-KYC: KYC / AML completeness.

    Informational and weighted at zero points: missing tax ID must not change a
    suitability verdict, but it is surfaced for the compliance file. Above the
    AML threshold, an undeclared source of funds becomes an AMBER.
    """
    th = get_registration_config()["client_thresholds"]
    aml_threshold = th["aml_source_of_funds_threshold"]

    has_tax_id = bool(profile.national_tax_id)
    has_sof = bool(profile.source_of_funds)

    facts: Dict[str, Any] = {
        "kyc_source": profile.kyc_source,
        "kyc_provider": profile.kyc_provider,
        "kyc_verified": profile.kyc_verified,
        "national_tax_id_present": has_tax_id,
        "source_of_funds_declared": has_sof,
        "investment_amount": profile.investment_amount,
        "aml_threshold": aml_threshold,
    }

    if (profile.investment_amount or 0.0) >= aml_threshold and not has_sof:
        return _rule(
            "R-KYC", "kyc_aml", "AMBER", 0.4,
            "rkyc_source_of_funds_missing",
            f"For tickets at or above {aml_threshold:,.0f} the source of funds must be "
            "declared before the recommendation can be actioned (AML control).",
            facts,
        )

    if not has_tax_id:
        return _rule(
            "R-KYC", "kyc_aml", "AMBER", 0.2,
            "rkyc_tax_id_missing",
            "No national tax identifier on file. Acceptable for this demo, mandatory "
            "for production KYC and fraud controls.",
            facts,
        )

    return _rule(
        "R-KYC", "kyc_aml", "GREEN", 0.0,
        "rkyc_ok",
        "KYC identity and source-of-funds evidence on file.",
        facts,
    )


def rule_liquidity(config: object, profile: ClientProfile) -> RuleResult:
    """R-LIQ: the client may need the money before the note matures (there is no early redemption)."""
    tenor = config.tenor_months  # type: ignore[attr-defined]
    liquidity = profile.needs_liquidity_within_months
    facts = {"tenor_months": tenor, "needs_liquidity_within_months": liquidity}
    if liquidity is not None and liquidity < tenor:
        return _rule(
            "R-LIQ", "liquidity", "RED", 0.9,
            "rliq_liquidity_mismatch",
            f"You may need liquidity in {liquidity}m, but the product matures in {tenor}m and has no early exit.",
            facts,
        )
    return _rule("R-LIQ", "liquidity", "GREEN", 0.0, "rliq_ok", "No liquidity need before maturity.", facts)


# Informational rules: shown to the user, never change the verdict.
INFORMATIONAL = ("R-FX", "R-PRICE", "R-KYC")


def evaluate_extras(config: object, profile: ClientProfile, metrics: Optional[MetricsBundle]) -> List[RuleResult]:
    """All checks outside the core replay rules, in a fixed order (no pricing note without metrics)."""
    return [r for r in [
        rule_complexity(config, profile),
        rule_life_stage(config, profile),
        rule_affordability(config, profile),
        rule_liquidity(config, profile),
        rule_fx(config, profile),
        rule_pricing(metrics) if metrics is not None else None,
        rule_kyc_completeness(profile),
    ] if r is not None]
