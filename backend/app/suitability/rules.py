"""
Suitability rules (Section 7.3).

Each rule is a pure function returning a RuleResult.
Thresholds are read from suitability_rules.yaml.
"""
from __future__ import annotations

from typing import Any, Dict

from app.core.config import get_products_config, get_suitability_rules, get_underlyings
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


def rule_loss(metrics: MetricsBundle, profile: ClientProfile) -> RuleResult:
    """R-LOSS: Loss tolerance check."""
    cfg = get_suitability_rules()
    tol = profile.loss_tolerance_pct / 100.0  # fraction
    stress = metrics.stress_loss_pct
    cvar5 = metrics.replay.cvar5_loss_pct if metrics.replay and metrics.replay.n_windows > 0 else stress
    worst = metrics.replay.worst_loss_pct if metrics.replay and metrics.replay.n_windows > 0 else stress

    facts = {
        "stress_loss_pct": round(stress, 4),
        "cvar5_loss_pct": round(cvar5, 4),
        "worst_loss_pct": round(worst, 4),
        "loss_tolerance_pct": round(tol, 4),
    }

    if stress > tol:
        return _rule(
            "R-LOSS", "loss_tolerance", "RED", 1.0,
            "rloss_stress_exceeds_tolerance",
            f"Stress loss {stress:.1%} exceeds your loss tolerance of {tol:.1%}.",
            facts,
        )
    if cvar5 > tol or worst > 1.5 * tol:
        severity = 0.7 if cvar5 > tol else 0.5
        return _rule(
            "R-LOSS", "loss_tolerance", "AMBER", severity,
            "rloss_tail_risk_elevated",
            f"Tail loss ({cvar5:.1%} CVaR) or worst historical loss ({worst:.1%}) "
            f"is high relative to your tolerance of {tol:.1%}.",
            facts,
        )
    return _rule("R-LOSS", "loss_tolerance", "GREEN", 0.0, "rloss_ok", "Loss risk within tolerance.", facts)


def rule_horizon(
    config: object, profile: ClientProfile
) -> RuleResult:
    """R-HORIZON: Tenor vs client horizon check."""
    cfg = get_suitability_rules()["rules"]["R-HORIZON"]
    tenor = config.tenor_months  # type: ignore[attr-defined]
    horizon = profile.horizon_months
    liquidity = profile.needs_liquidity_within_months

    facts = {
        "tenor_months": tenor,
        "horizon_months": horizon,
        "needs_liquidity_within_months": liquidity,
    }

    red_mul = cfg["red_multiplier"]
    amber_mul = cfg["amber_multiplier"]

    if tenor > red_mul * horizon:
        return _rule(
            "R-HORIZON", "horizon", "RED", 1.0,
            "rhorizon_tenor_far_exceeds_horizon",
            f"Product tenor ({tenor}m) is more than {red_mul}× your investment horizon ({horizon}m).",
            facts,
        )
    if liquidity is not None and liquidity < tenor:
        return _rule(
            "R-HORIZON", "horizon", "RED", 0.9,
            "rhorizon_liquidity_mismatch",
            f"You may need liquidity in {liquidity}m, but the product matures in {tenor}m and has no early exit.",
            facts,
        )
    if tenor > amber_mul * horizon:
        return _rule(
            "R-HORIZON", "horizon", "AMBER", 0.6,
            "rhorizon_tenor_exceeds_horizon",
            f"Product tenor ({tenor}m) exceeds your investment horizon ({horizon}m).",
            facts,
        )
    return _rule("R-HORIZON", "horizon", "GREEN", 0.0, "rhorizon_ok", "Tenor fits your horizon.", facts)


def rule_concentration(
    config: object, profile: ClientProfile
) -> RuleResult:
    """R-CONC: Concentration check."""
    cfg_rules = get_suitability_rules()["rules"]["R-CONC"]

    amount_pct = profile.amount_pct_of_assets  # fraction
    existing_exp = profile.existing_exposure_underlying_pct / 100.0
    existing_struct = profile.existing_structured_pct / 100.0

    # Post-trade underlying exposure
    post_trade_exp = existing_exp + amount_pct
    single_product_pct = amount_pct
    structured_total = existing_struct + amount_pct

    facts = {
        "post_trade_underlying_exposure": round(post_trade_exp, 4),
        "single_product_pct": round(single_product_pct, 4),
        "existing_structured_pct": round(existing_struct, 4),
        "structured_total": round(structured_total, 4),
        "investment_amount": config.principal,  # type: ignore[attr-defined]
        "investable_assets": profile.investable_assets,
    }

    red_und = cfg_rules["red_underlying_exposure"]
    red_single = cfg_rules["red_single_product_pct"]
    amb_und = cfg_rules["amber_underlying_exposure"]
    amb_single = cfg_rules["amber_single_product_pct"]
    amb_struct = cfg_rules["amber_structured_total"]

    if post_trade_exp >= red_und or single_product_pct >= red_single:
        return _rule(
            "R-CONC", "concentration", "RED", 1.0,
            "rconc_overconcentrated",
            f"Post-trade exposure to this underlying ({post_trade_exp:.1%}) or "
            f"single product allocation ({single_product_pct:.1%}) is too high.",
            facts,
        )
    if post_trade_exp >= amb_und or single_product_pct >= amb_single or structured_total >= amb_struct:
        return _rule(
            "R-CONC", "concentration", "AMBER", 0.6,
            "rconc_elevated_concentration",
            f"Concentration is elevated: underlying exposure {post_trade_exp:.1%}, "
            f"structured total {structured_total:.1%}.",
            facts,
        )
    return _rule("R-CONC", "concentration", "GREEN", 0.0, "rconc_ok", "Concentration within limits.", facts)


def rule_risk_appetite(
    metrics: MetricsBundle, profile: ClientProfile, tier: int
) -> RuleResult:
    """R-RISK: Risk appetite vs product tier."""
    cfg_suits = get_suitability_rules()
    appetite_limits = cfg_suits["appetite_limits"][profile.risk_appetite]
    max_tier = appetite_limits["max_tier"]
    max_p_loss = appetite_limits["max_p_loss"]
    p_loss = metrics.replay.p_loss if metrics.replay and metrics.replay.n_windows > 0 else (1.0 if metrics.stress_loss_pct > 0 else 0.0)

    facts = {
        "product_tier": tier,
        "max_allowed_tier": max_tier,
        "p_loss": round(p_loss, 4),
        "max_p_loss": max_p_loss,
        "risk_appetite": profile.risk_appetite,
    }

    red_excess = cfg_suits["rules"]["R-RISK"]["red_tier_excess"]
    if tier > max_tier + red_excess:
        return _rule(
            "R-RISK", "risk_appetite", "RED", 1.0,
            "rrisk_tier_too_high",
            f"Product risk tier ({tier}) exceeds what is allowed for a {profile.risk_appetite} investor (max tier {max_tier}).",
            facts,
        )
    if tier > max_tier or p_loss > max_p_loss:
        return _rule(
            "R-RISK", "risk_appetite", "AMBER", 0.7,
            "rrisk_tier_borderline",
            f"Product tier ({tier}) or probability of loss ({p_loss:.1%}) is at the limit for your risk appetite.",
            facts,
        )
    return _rule("R-RISK", "risk_appetite", "GREEN", 0.0, "rrisk_ok", "Risk level consistent with your appetite.", facts)


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

    client_currency = "INR"  # simplified assumption: INR client
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


def evaluate_all_rules(
    config: object,
    profile: ClientProfile,
    metrics: MetricsBundle,
    tier: int,
) -> list:
    """Return all rule results in standard order."""
    return [
        rule_loss(metrics, profile),
        rule_horizon(config, profile),
        rule_concentration(config, profile),
        rule_risk_appetite(metrics, profile, tier),
        rule_complexity(config, profile),
        rule_fx(config, profile),
        rule_pricing(metrics),
    ]
