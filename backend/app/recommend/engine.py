"""
Recommendation engine (Phase 5).

Algorithm:
  1. Build a candidate grid from products.yaml grids × all valid underlyings. Every
     candidate is sized at the client's stated investment amount (converted into the
     underlying's currency at the latest FX close) and priced with the indicative
     model: ELN coupon, CPN participation and DCD interest are the model's affordable
     level rounded down to the configured step.
  2. For each candidate: run metrics + suitability (no LLM).
  3. Score each candidate (fit_score = suitability_score + return_bonus - pricing_penalty).
  4. Return the ranked top list, best candidate, and comparison table. Only the
     returned candidates are persisted as runs (linked to the client's case).
     If no suitable candidate exists, still return the ranked list with rejection notes.

Capped at config.recommendation.max_candidates to stay within target_time_seconds.
"""
from __future__ import annotations

import itertools
import logging
import math
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

from app.analytics.metrics import compute_metrics
from app.analytics.pricing import compute_pricing
from app.analytics.vol import compute_vol
from app.core.config import get_products_config, get_underlyings
from app.core.errors import AppError
from app.market.fx import inr_rate
from app.market.service import get_history
from app.schemas.client import ClientProfile
from app.schemas.product import CPNConfig, DCDConfig, ELNConfig, parse_product_dict
from app.schemas.recommend import (
    ComparisonRow,
    FixItResponse,
    FixItSuggestion,
    ProductCandidate,
    RecommendationResult,
)
from app.assessment.service import case_compliance_meta
from app.store.cases import get_case
from app.suitability.engine import evaluate_suitability
from app.store.runs import generate_run_id, save_run

logger = logging.getLogger(__name__)

TOP_N = 20


# ── Indicative pricing of grid terms ───────────────────────────────────────────

def _sigma(close: pd.Series) -> float:
    vol = compute_vol(close)
    ewma, realised = vol["ewma"], vol["realised_1y"]
    if not np.isnan(ewma) and ewma > 0:
        return float(ewma)
    return float(realised)


def _floor_to(value: float, step: float) -> float:
    return math.floor(value / step + 1e-9) * step


def _priced(config: object, sigma: float, s0: float, field: str, step: float, lo: float, hi: float) -> Optional[object]:
    """Set `field` to the indicative fair level (rounded down to `step`), or None if unaffordable."""
    indicative = compute_pricing(config, sigma, s0).indicative
    level = round(min(hi, _floor_to(indicative, step)), 6)
    if level < lo:
        return None
    return config.model_copy(update={field: level})  # type: ignore[attr-defined]


# ── Candidate builders ─────────────────────────────────────────────────────────

def _eln_candidates(cfg, key, meta, principal, sigma, s0) -> List[ELNConfig]:
    grids, defaults, bounds = cfg["ELN"]["grids"], cfg["ELN"]["defaults"], cfg["ELN"]["bounds"]
    out = []
    for tenor, barrier in itertools.product(grids["tenors"], grids["barriers"]):
        base = ELNConfig(
            underlying=key, tenor_months=int(tenor), principal=principal,
            currency=meta["currency"], barrier_pct=float(barrier), coupon_pa=0.0,
            coupon_conditional=bool(defaults["coupon_conditional"]),
            barrier_monitoring=defaults["barrier_monitoring"],
        )
        priced = _priced(base, sigma, s0, "coupon_pa", grids["coupon_step"],
                         bounds["coupon_pa_min"], bounds["coupon_pa_max"])
        if priced is not None:
            out.append(priced)
    return out


def _cpn_candidates(cfg, key, meta, principal, sigma, s0) -> List[CPNConfig]:
    grids, bounds = cfg["CPN"]["grids"], cfg["CPN"]["bounds"]
    out = []
    for tenor, protection, cap in itertools.product(grids["tenors"], grids["protections"], grids["caps"]):
        base = CPNConfig(
            underlying=key, tenor_months=int(tenor), principal=principal,
            currency=meta["currency"], protection_pct=float(protection),
            participation_pct=bounds["participation_pct_min"],
            cap_pct=float(cap) if cap is not None else None,
        )
        priced = _priced(base, sigma, s0, "participation_pct", grids["participation_step"],
                         bounds["participation_pct_min"], bounds["participation_pct_max"])
        if priced is not None:
            out.append(priced)
    return out


def _dcd_candidates(cfg, key, meta, principal, sigma, s0) -> List[DCDConfig]:
    grids, bounds = cfg["DCD"]["grids"], cfg["DCD"]["bounds"]
    out = []
    for tenor, strike_offset in itertools.product(grids["tenors"], grids["strike_offsets"]):
        base = DCDConfig(
            underlying=key, tenor_months=int(tenor), principal=principal,
            currency=meta["base_currency"], strike=round(s0 * float(strike_offset), 4),
            interest_pa=0.0, base_currency=meta["base_currency"], alt_currency=meta["alt_currency"],
        )
        priced = _priced(base, sigma, s0, "interest_pa", grids["interest_step"],
                         bounds["interest_pa_min"], bounds["interest_pa_max"])
        if priced is not None:
            out.append(priced)
    return out


def _build_all_candidates(
    profile: ClientProfile,
    filters: Optional[Dict[str, Any]],
) -> List[Tuple[object, str, str]]:
    """
    Return list of (config, underlying_key, product_type) tuples.
    Respects profile.preferred_underlying_types and filters.
    """
    cfg = get_products_config()
    underlyings = get_underlyings()
    max_cands = cfg["recommendation"]["max_candidates"]
    amount_inr = float(profile.investment_amount)  # type: ignore[arg-type]

    allowed_product_types: Optional[List[str]] = None
    if filters and "product_types" in filters:
        allowed_product_types = [pt.upper() for pt in filters["product_types"]]

    def wanted(pt: str) -> bool:
        return allowed_product_types is None or pt in allowed_product_types

    results: List[Tuple[object, str, str]] = []
    for key, meta in underlyings.items():
        asset_type = meta.get("type", "equity")
        if profile.preferred_underlying_types:
            if asset_type not in profile.preferred_underlying_types and key not in profile.preferred_underlying_types:
                continue

        try:
            df, _, _, _ = get_history(key)
            close = df["close"]
            s0 = float(close.iloc[-1])
            sigma = _sigma(close)
            ccy = meta["base_currency"] if asset_type == "fx" else meta["currency"]
            principal = round(amount_inr / inr_rate(ccy).inr_per_unit, 2)
        except (ValueError, AppError) as exc:
            logger.warning("Skipping %s: %s", key, exc)
            continue

        if asset_type in ("equity", "equity_index"):
            if wanted("ELN"):
                results += [(c, key, "ELN") for c in _eln_candidates(cfg, key, meta, principal, sigma, s0)]
            if wanted("CPN"):
                results += [(c, key, "CPN") for c in _cpn_candidates(cfg, key, meta, principal, sigma, s0)]
        elif asset_type == "fx" and wanted("DCD"):
            results += [(c, key, "DCD") for c in _dcd_candidates(cfg, key, meta, principal, sigma, s0)]

        if len(results) >= max_cands:
            break

    return results[:max_cands]


# ── Scoring ────────────────────────────────────────────────────────────────────

def _fit_score(
    suitability_score: float,
    median_ann_return: float,
    fd_baseline: float,
    target_return_pa: Optional[float],
    pricing_ok: bool,
    cfg: Dict[str, Any],
) -> float:
    """
    Composite fit score (0-100).
    Base = suitability_score (0-100)
    + return_bonus: up to +return_score_scale_pp for return above FD baseline
    - pricing_penalty: -3 if pricing flag not ok
    + target_return_bonus: up to +10 if median_ann_return close to target
    """
    rec_cfg = cfg["recommendation"]
    scale_pp = rec_cfg["return_score_scale_pp"] / 100.0  # convert pp to fraction
    return_bonus_max = rec_cfg["return_score_scale_pp"]  # max points
    target_bonus_max = rec_cfg["target_return_bonus_max"]
    tol = rec_cfg["target_return_tolerance_pp"] / 100.0

    excess_return = median_ann_return - fd_baseline
    return_bonus = min(return_bonus_max, max(0.0, excess_return / scale_pp * return_bonus_max))

    pricing_penalty = 0.0 if pricing_ok else 3.0

    target_bonus = 0.0
    if target_return_pa is not None:
        gap = abs(median_ann_return - target_return_pa)
        if gap <= tol:
            target_bonus = target_bonus_max
        elif gap < tol * 5:
            target_bonus = target_bonus_max * (1.0 - (gap - tol) / (tol * 4))

    raw = suitability_score + return_bonus - pricing_penalty + target_bonus
    return round(max(0.0, min(100.0, raw)), 2)


def _key_params(config_obj: object, product_type: str, underlying_key: str) -> Dict[str, Any]:
    params: Dict[str, Any] = {"product_type": product_type, "underlying": underlying_key}
    for attr in ("tenor_months", "principal", "currency", "barrier_pct", "coupon_pa", "protection_pct",
                 "participation_pct", "cap_pct", "strike", "interest_pa"):
        if hasattr(config_obj, attr):
            params[attr] = getattr(config_obj, attr)
    return params


# ── Main engine ────────────────────────────────────────────────────────────────

def run_recommendation(
    profile: ClientProfile,
    filters: Optional[Dict[str, Any]] = None,
    case_id: Optional[str] = None,
) -> RecommendationResult:
    """
    Core recommendation engine.
    Sweeps grid → scores → ranks → persists the returned candidates → RecommendationResult.
    """
    if profile.investment_amount is None:
        raise AppError(
            422, "INVESTMENT_AMOUNT_REQUIRED",
            "State how much you plan to invest so candidates can be sized for you.",
        )
    cfg = get_products_config()
    fd_rate = cfg["fd_baseline_rate"]
    recommendation_id = str(uuid.uuid4()).replace("-", "")[:16].upper()
    as_of = datetime.now(timezone.utc).date().isoformat()

    # Compliance screening comes from the client's case (if any); without it the AML gate is REVIEW.
    meta = case_compliance_meta(get_case(case_id)) if case_id else None
    candidates_input = _build_all_candidates(profile, filters)
    logger.info("Recommendation: evaluating %d candidates", len(candidates_input))

    evaluated: List[Dict[str, Any]] = []
    for config_obj, underlying_key, product_type in candidates_input:
        try:
            df, source, data_as_of, snap = get_history(underlying_key)
            metrics = compute_metrics(config_obj, df["close"], include_monte_carlo=False)
            suitability = evaluate_suitability(config_obj, profile, metrics, meta=meta)
        except Exception as exc:
            logger.debug("Candidate failed evaluation: %s – %s", config_obj, exc)
            continue

        has_replay = metrics.replay is not None and metrics.replay.n_windows > 0
        p_loss = metrics.replay.p_loss if has_replay else 0.0
        cvar5 = metrics.replay.cvar5_loss_pct if has_replay else 0.0
        median_ann_ret = metrics.replay.median_annualised_return if has_replay else 0.0
        fit = _fit_score(suitability.score, median_ann_ret, fd_rate, profile.target_return_pa,
                         metrics.pricing.flag == "ok", cfg)
        evaluated.append({
            "run_id": generate_run_id(),
            "config": config_obj,
            "underlying": underlying_key,
            "product_type": product_type,
            "metrics": metrics,
            "suitability": suitability,
            "source": source,
            "as_of": data_as_of,
            "snapshot_id": snap,
            "p_loss": p_loss,
            "cvar5": cvar5,
            "median_ann_ret": median_ann_ret,
            "fit": fit,
            "is_suitable": suitability.verdict in ("SUITABLE", "CONDITIONALLY_SUITABLE"),
        })

    # Suitable first, then by fit score; only the returned candidates are persisted.
    evaluated.sort(key=lambda e: (0 if e["is_suitable"] else 1, -e["fit"]))
    top = evaluated[:TOP_N]

    ranking: List[ProductCandidate] = []
    comparison: List[ComparisonRow] = []
    for rank, e in enumerate(top, 1):
        config_obj, metrics, suitability = e["config"], e["metrics"], e["suitability"]
        save_run(
            run_id=e["run_id"],
            case_id=case_id,
            product_json=config_obj.model_dump(mode="json"),
            metrics_json=metrics.model_dump(),
            suitability_json=suitability.model_dump(),
            explanation_json=None,
            data_source=e["source"],
            as_of=e["as_of"],
            snapshot_id=e["snapshot_id"],
        )
        rejected = [r.message for r in suitability.mismatches]
        ranking.append(ProductCandidate(
            product_type=e["product_type"],
            run_id=e["run_id"],
            config=config_obj.model_dump(mode="json"),
            metrics_summary={
                "p_loss": round(e["p_loss"], 4),
                "cvar5_loss_pct": round(e["cvar5"], 4),
                "median_annualised_return": round(e["median_ann_ret"], 4),
                "max_loss_pct": round(metrics.max_loss_pct, 4),
                "max_gain_pct": None if metrics.max_gain_pct is None else round(metrics.max_gain_pct, 4),
                "stress_loss_pct": round(metrics.stress_loss_pct, 4),
            },
            suitability=suitability.model_dump(),
            fit_score=e["fit"],
            verdict=suitability.verdict,
            is_suitable=e["is_suitable"],
            rejected_reasons=rejected,
        ))
        comparison.append(ComparisonRow(
            product_type=e["product_type"],
            underlying=e["underlying"],
            key_params=_key_params(config_obj, e["product_type"], e["underlying"]),
            verdict=suitability.verdict,
            score=suitability.score,
            p_loss=round(e["p_loss"], 4),
            cvar5=round(e["cvar5"], 4),
            median_annualised_return=round(e["median_ann_ret"], 4),
            indicative_flag=metrics.pricing.flag,
            fit_score=e["fit"],
            rejected_reasons=rejected,
            rank=rank,
        ))

    best = next((c for c in ranking if c.is_suitable), None)
    if best is None and ranking:
        ranking[0] = ranking[0].model_copy(update={
            "rejection_note": "No suitable candidate found. Showing best available with unresolved mismatches."
        })

    sources = sorted({e["source"] for e in top})
    return RecommendationResult(
        recommendation_id=recommendation_id,
        best=best,
        ranking=ranking,
        comparison_table=comparison,
        rationale_text=None,
        data_source=sources[0] if len(sources) == 1 else "mixed",
        as_of=max((e["as_of"] for e in top), default=as_of),
    )


# ── Fix-it engine ──────────────────────────────────────────────────────────────

def run_fixit(
    config_dict: Dict[str, Any],
    profile: ClientProfile,
) -> FixItResponse:
    """
    Given a NOT_SUITABLE or CONDITIONALLY_SUITABLE product + profile,
    propose parameter tweaks that improve suitability. Every changed term is
    re-priced with the indicative model, so a safer structure carries the lower
    coupon / participation / interest it can actually afford.
    """
    try:
        original = parse_product_dict(config_dict)
    except Exception as exc:
        raise ValueError(f"Invalid product config: {exc}")
    pt = original.product_type
    cfg = get_products_config()
    grids, bounds = cfg[pt]["grids"], cfg[pt]["bounds"]

    df, _, _, _ = get_history(original.underlying)
    close = df["close"]
    s0, sigma = float(close.iloc[-1]), _sigma(close)
    metrics_original = compute_metrics(original, close, include_monte_carlo=False)
    suitability_original = evaluate_suitability(original, profile, metrics_original)

    def evaluate(candidate: object):
        m = compute_metrics(candidate, close, include_monte_carlo=False)
        return evaluate_suitability(candidate, profile, m)

    def reprice(candidate: object, field: str, step: float, lo: float, hi: float) -> Optional[object]:
        """Never raise the client's term above what they had, only lower it to what is affordable."""
        priced = _priced(candidate, sigma, s0, field, step, lo, hi)
        if priced is None:
            return None
        return priced.model_copy(update={field: min(getattr(original, field), getattr(priced, field))})  # type: ignore[attr-defined]

    suggestions: List[FixItSuggestion] = []

    def offer(candidate: object, description: str, tradeoff: str) -> bool:
        new_suit = evaluate(candidate)
        if new_suit.score > suitability_original.score + 2:
            suggestions.append(FixItSuggestion(
                change_description=description,
                new_config=candidate.model_dump(mode="json"),  # type: ignore[attr-defined]
                new_verdict=new_suit.verdict,
                new_score=new_suit.score,
                tradeoff=tradeoff,
            ))
            return True
        return False

    # Strategy 1: shorten tenor (reduces horizon mismatch)
    if pt in ("ELN", "CPN"):
        for shorter in [t for t in sorted(grids["tenors"]) if t < original.tenor_months]:
            if offer(original.model_copy(update={"tenor_months": shorter}),
                     f"Shorten tenor from {original.tenor_months}m → {shorter}m",
                     "Same terms over a shorter period: less time exposed, less total coupon/upside."):
                break

    # Strategy 2: raise the ELN barrier, coupon re-priced at the new barrier
    if pt == "ELN":
        for higher in [b for b in sorted(grids["barriers"], reverse=True) if b > original.barrier_pct]:
            candidate = reprice(original.model_copy(update={"barrier_pct": higher}), "coupon_pa",
                                grids["coupon_step"], bounds["coupon_pa_min"], bounds["coupon_pa_max"])
            if candidate is not None and offer(
                candidate,
                f"Raise barrier from {original.barrier_pct:.0%} → {higher:.0%}",
                f"Coupon at the indicative level for this barrier: {original.coupon_pa:.2%} → {candidate.coupon_pa:.2%} p.a.",
            ):
                break

    # Strategy 3: raise CPN protection, participation re-priced
    if pt == "CPN":
        for higher in [p for p in sorted(grids["protections"], reverse=True) if p > original.protection_pct]:
            candidate = reprice(original.model_copy(update={"protection_pct": higher}), "participation_pct",
                                grids["participation_step"], bounds["participation_pct_min"],
                                bounds["participation_pct_max"])
            if candidate is not None and offer(
                candidate,
                f"Raise protection from {original.protection_pct:.0%} → {higher:.0%}",
                f"Affordable participation at this protection: {original.participation_pct:.0%} → {candidate.participation_pct:.0%}.",
            ):
                break

    # Strategy 4: DCD strike further from spot (less conversion risk), interest re-priced
    if pt == "DCD":
        for offset in sorted(grids["strike_offsets"], reverse=True):
            new_strike = round(s0 * offset, 4)
            if new_strike <= original.strike:
                continue
            candidate = reprice(original.model_copy(update={"strike": new_strike}), "interest_pa",
                                grids["interest_step"], bounds["interest_pa_min"], bounds["interest_pa_max"])
            if candidate is not None and offer(
                candidate,
                f"Move DCD strike from {original.strike:.4g} → {new_strike:.4g}",
                f"Lower conversion risk; indicative interest {original.interest_pa:.2%} → {candidate.interest_pa:.2%} p.a.",
            ):
                break

    if not suggestions:
        suggestions.append(FixItSuggestion(
            change_description="No parameter adjustment resolves suitability issues.",
            new_config=original.model_dump(mode="json"),
            new_verdict=suitability_original.verdict,
            new_score=suitability_original.score,
            tradeoff=(
                "The mismatch stems from client profile (risk appetite, horizon, or tolerance). "
                "Consider choosing a different product type or adjusting the investment amount."
            ),
        ))

    return FixItResponse(
        original_verdict=suitability_original.verdict,
        original_score=suitability_original.score,
        suggestions=suggestions,
    )
