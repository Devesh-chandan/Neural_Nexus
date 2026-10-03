"""
Recommendation engine (Phase 5).

Algorithm:
  1. Build a candidate grid from products.yaml grids × all valid underlyings.
  2. For each candidate: run metrics + suitability (no LLM).
  3. Score each candidate (fit_score = suitability_score + return_bonus - pricing_penalty).
  4. Return ranked list, best candidate, and comparison table.
     If no suitable candidate exists, still return the ranked list with rejection notes.

Capped at config.recommendation.max_candidates to stay within target_time_seconds.
"""
from __future__ import annotations

import itertools
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from app.analytics.metrics import compute_metrics
from app.core.config import get_products_config, get_underlyings
from app.market.service import get_history
from app.schemas.client import ClientProfile
from app.schemas.product import CPNConfig, DCDConfig, ELNConfig
from app.schemas.recommend import (
    ComparisonRow,
    FixItResponse,
    FixItSuggestion,
    ProductCandidate,
    RecommendationResult,
)
from app.schemas.suitability import Verdict
from app.suitability.engine import evaluate_suitability
from app.store.runs import generate_run_id, save_run

logger = logging.getLogger(__name__)


# ── Candidate builders ─────────────────────────────────────────────────────────

def _eln_candidates(
    cfg: Dict[str, Any],
    underlying_key: str,
    underlying_meta: Dict[str, Any],
) -> List[ELNConfig]:
    """Generate ELN grid candidates for one equity/equity_index underlying."""
    grids = cfg["ELN"]["grids"]
    defaults = cfg["ELN"]["defaults"]
    candidates = []
    for tenor, barrier in itertools.product(grids["tenors"], grids["barriers"]):
        try:
            c = ELNConfig(
                underlying=underlying_key,
                tenor_months=int(tenor),
                principal=float(defaults["principal"]),
                currency=underlying_meta.get("currency", "INR"),
                barrier_pct=float(barrier),
                coupon_pa=float(defaults["coupon_pa"]),
                coupon_conditional=bool(defaults["coupon_conditional"]),
                barrier_monitoring=defaults["barrier_monitoring"],
            )
            candidates.append(c)
        except Exception:
            pass
    return candidates


def _cpn_candidates(
    cfg: Dict[str, Any],
    underlying_key: str,
    underlying_meta: Dict[str, Any],
) -> List[CPNConfig]:
    """Generate CPN grid candidates for one equity/equity_index underlying."""
    grids = cfg["CPN"]["grids"]
    defaults = cfg["CPN"]["defaults"]
    candidates = []
    for tenor, protection, cap in itertools.product(
        grids["tenors"], grids["protections"], grids["caps"]
    ):
        try:
            c = CPNConfig(
                underlying=underlying_key,
                tenor_months=int(tenor),
                principal=float(defaults["principal"]),
                currency=underlying_meta.get("currency", "INR"),
                protection_pct=float(protection),
                participation_pct=float(defaults["participation_pct"]),
                cap_pct=float(cap) if cap is not None else None,
            )
            candidates.append(c)
        except Exception:
            pass
    return candidates


def _dcd_candidates(
    cfg: Dict[str, Any],
    underlying_key: str,
    underlying_meta: Dict[str, Any],
    s0: float,
) -> List[DCDConfig]:
    """Generate DCD grid candidates for one FX underlying."""
    grids = cfg["DCD"]["grids"]
    defaults = cfg["DCD"]["defaults"]
    candidates = []
    base_ccy = underlying_meta.get("base_currency", "USD")
    alt_ccy = underlying_meta.get("alt_currency", "INR")
    for tenor, strike_offset in itertools.product(grids["tenors"], grids["strike_offsets"]):
        strike = round(s0 * float(strike_offset), 4)
        try:
            c = DCDConfig(
                underlying=underlying_key,
                tenor_months=int(tenor),
                principal=float(defaults["principal"]),
                currency=base_ccy,
                strike=strike,
                interest_pa=float(defaults["interest_pa"]),
                base_currency=base_ccy,
                alt_currency=alt_ccy,
            )
            candidates.append(c)
        except Exception:
            pass
    return candidates


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

    allowed_product_types: Optional[List[str]] = None
    if filters and "product_types" in filters:
        allowed_product_types = [pt.upper() for pt in filters["product_types"]]

    results: List[Tuple[object, str, str]] = []

    for key, meta in underlyings.items():
        asset_type = meta.get("type", "equity")

        # Filter by preferred_underlying_types if set
        if profile.preferred_underlying_types:
            if asset_type not in profile.preferred_underlying_types and key not in profile.preferred_underlying_types:
                continue

        # Get s0 (best-effort, skip if unavailable)
        try:
            df, _, _, _ = get_history(key)
            s0 = float(df["close"].iloc[-1])
        except Exception as exc:
            logger.warning("Skipping %s: cannot get history: %s", key, exc)
            continue

        if asset_type in ("equity", "equity_index"):
            if allowed_product_types is None or "ELN" in allowed_product_types:
                for c in _eln_candidates(cfg, key, meta):
                    results.append((c, key, "ELN"))
            if allowed_product_types is None or "CPN" in allowed_product_types:
                for c in _cpn_candidates(cfg, key, meta):
                    results.append((c, key, "CPN"))
        elif asset_type == "fx":
            if allowed_product_types is None or "DCD" in allowed_product_types:
                for c in _dcd_candidates(cfg, key, meta, s0):
                    results.append((c, key, "DCD"))

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
    + return_bonus: up to +10 for return above FD baseline (scaled by return_score_scale_pp)
    - pricing_penalty: -3 if pricing flag not ok
    + target_return_bonus: up to +10 if median_ann_return close to target
    """
    rec_cfg = cfg["recommendation"]
    scale_pp = rec_cfg["return_score_scale_pp"] / 100.0  # convert pp to fraction
    return_bonus_max = rec_cfg.get("return_score_scale_pp", 6.0)  # max points
    target_bonus_max = rec_cfg.get("target_return_bonus_max", 10.0)
    tol = rec_cfg.get("target_return_tolerance_pp", 1.0) / 100.0

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


# ── Main engine ────────────────────────────────────────────────────────────────

def run_recommendation(
    profile: ClientProfile,
    filters: Optional[Dict[str, Any]] = None,
) -> RecommendationResult:
    """
    Core recommendation engine.
    Sweeps grid → scores → ranks → returns RecommendationResult.
    """
    cfg = get_products_config()
    fd_rate = cfg["fd_baseline_rate"]
    recommendation_id = str(uuid.uuid4()).replace("-", "")[:16].upper()
    as_of = datetime.now(timezone.utc).date().isoformat()

    candidates_input = _build_all_candidates(profile, filters)
    logger.info("Recommendation: evaluating %d candidates", len(candidates_input))

    ranking: List[ProductCandidate] = []
    comparison_rows: List[ComparisonRow] = []

    for config_obj, underlying_key, product_type in candidates_input:
        try:
            df, source, data_as_of, snap = get_history(underlying_key)
            metrics = compute_metrics(config_obj, df["close"], include_monte_carlo=False)
            suitability = evaluate_suitability(config_obj, profile, metrics)
        except Exception as exc:
            logger.debug("Candidate failed evaluation: %s – %s", config_obj, exc)
            continue

        # Key metrics
        p_loss = metrics.replay.p_loss if metrics.replay and metrics.replay.n_windows > 0 else (
            1.0 if metrics.stress_loss_pct > 0 else 0.0
        )
        cvar5 = metrics.replay.cvar5_loss_pct if metrics.replay and metrics.replay.n_windows > 0 else metrics.stress_loss_pct
        median_ann_ret = metrics.replay.median_annualised_return if metrics.replay and metrics.replay.n_windows > 0 else 0.0
        pricing_ok = metrics.pricing.flag == "ok"
        indicative_flag = metrics.pricing.flag

        fit = _fit_score(
            suitability.score,
            median_ann_ret,
            fd_rate,
            profile.target_return_pa,
            pricing_ok,
            cfg,
        )

        is_suitable = suitability.verdict in ("SUITABLE", "CONDITIONALLY_SUITABLE")
        rejected_reasons = [r.message for r in suitability.mismatches]

        # Key params summary
        key_params: Dict[str, Any] = {"product_type": product_type, "underlying": underlying_key}
        for attr in ("tenor_months", "barrier_pct", "coupon_pa", "protection_pct",
                     "participation_pct", "cap_pct", "strike", "interest_pa"):
            if hasattr(config_obj, attr):
                key_params[attr] = getattr(config_obj, attr)

        # Save run (no suitability/explanation stored here for speed)
        run_id = generate_run_id()
        try:
            save_run(
                run_id=run_id,
                case_id=None,
                product_json=config_obj.__dict__,
                metrics_json=metrics.model_dump(),
                suitability_json=suitability.model_dump(),
                explanation_json=None,
                data_source=source,
                as_of=data_as_of,
                snapshot_id=snap,
            )
        except Exception as exc:
            logger.warning("Failed to save recommendation run %s: %s", run_id, exc)

        candidate = ProductCandidate(
            product_type=product_type,
            run_id=run_id,
            config=config_obj.__dict__,
            metrics_summary={
                "p_loss": round(p_loss, 4),
                "cvar5_loss_pct": round(cvar5, 4),
                "median_annualised_return": round(median_ann_ret, 4),
                "max_loss_pct": round(metrics.max_loss_pct, 4),
                "max_gain_pct": round(metrics.max_gain_pct, 4),
                "stress_loss_pct": round(metrics.stress_loss_pct, 4),
            },
            suitability=suitability.model_dump(),
            fit_score=fit,
            verdict=suitability.verdict,
            is_suitable=is_suitable,
            rejected_reasons=rejected_reasons,
        )
        ranking.append(candidate)

        comparison_rows.append(ComparisonRow(
            product_type=product_type,
            underlying=underlying_key,
            key_params=key_params,
            verdict=suitability.verdict,
            score=suitability.score,
            p_loss=round(p_loss, 4),
            cvar5=round(cvar5, 4),
            median_annualised_return=round(median_ann_ret, 4),
            indicative_flag=indicative_flag,
            fit_score=fit,
            rejected_reasons=rejected_reasons,
            rank=0,  # placeholder
        ))

    # Sort: suitable first, then by fit_score descending
    ranking.sort(
        key=lambda c: (0 if c.is_suitable else 1, -c.fit_score)
    )

    # Assign ranks and update comparison table
    for i, cand in enumerate(ranking):
        ranking[i] = cand.model_copy(update={})  # re-use same object
    for i, row in enumerate(comparison_rows):
        # match to ranking position by run_id
        pass

    # Re-sort comparison rows to match ranking order
    rank_order = {c.run_id: i + 1 for i, c in enumerate(ranking)}
    for i, row in enumerate(comparison_rows):
        # find matching candidate by product_type+underlying+key_params
        pass  # comparison table is independently useful; leave in evaluation order

    for i, cand in enumerate(ranking):
        # rank is implicit by list index
        pass

    # Re-build comparison rows in sorted order
    ranked_comparison = []
    for rank_idx, cand in enumerate(ranking, 1):
        # Find matching comparison row by run_id (stored in config)
        for row in comparison_rows:
            if (
                row.product_type == cand.product_type
                and row.underlying == cand.config.get("underlying", "")
                and row.fit_score == cand.fit_score
            ):
                ranked_comparison.append(ComparisonRow(
                    **{**row.model_dump(), "rank": rank_idx}
                ))
                break

    best = next((c for c in ranking if c.is_suitable), None)
    if best is None and ranking:
        # No suitable candidate – annotate the best overall with rejection note
        top = ranking[0]
        ranking[0] = top.model_copy(update={
            "rejection_note": "No suitable candidate found. Showing best available with unresolved mismatches."
        })

    return RecommendationResult(
        recommendation_id=recommendation_id,
        best=best,
        ranking=ranking[:20],  # return top 20
        comparison_table=ranked_comparison[:20],
        rationale_text=None,  # LLM narration optional
        as_of=as_of,
    )


# ── Fix-it engine ──────────────────────────────────────────────────────────────

def run_fixit(
    config_dict: Dict[str, Any],
    profile: ClientProfile,
) -> FixItResponse:
    """
    Given a NOT_SUITABLE or CONDITIONALLY_SUITABLE product + profile,
    propose parameter tweaks that improve suitability.
    """
    pt = config_dict.get("product_type", "").upper()
    cfg = get_products_config()
    grids = cfg.get(pt, {}).get("grids", {})

    # Parse original config
    try:
        if pt == "ELN":
            original_config = ELNConfig(**config_dict)
        elif pt == "CPN":
            original_config = CPNConfig(**config_dict)
        elif pt == "DCD":
            original_config = DCDConfig(**config_dict)
        else:
            raise ValueError(f"Unknown product_type: {pt}")
    except Exception as exc:
        raise ValueError(f"Invalid product config: {exc}")

    underlying_key = original_config.underlying  # type: ignore[attr-defined]
    df, _, _, _ = get_history(underlying_key)
    metrics_original = compute_metrics(original_config, df["close"], include_monte_carlo=False)
    suitability_original = evaluate_suitability(original_config, profile, metrics_original)

    suggestions: List[FixItSuggestion] = []

    # Strategy 1: shorten tenor (reduces horizon and concentration risk)
    if pt in ("ELN", "CPN") and grids.get("tenors"):
        current_tenor = original_config.tenor_months  # type: ignore[attr-defined]
        for shorter in [t for t in sorted(grids["tenors"]) if t < current_tenor]:
            try:
                new_cfg_dict = {**config_dict, "tenor_months": shorter}
                if pt == "ELN":
                    new_config = ELNConfig(**new_cfg_dict)
                else:
                    new_config = CPNConfig(**new_cfg_dict)
                new_metrics = compute_metrics(new_config, df["close"])
                new_suit = evaluate_suitability(new_config, profile, new_metrics)
                if new_suit.score > suitability_original.score + 2:
                    suggestions.append(FixItSuggestion(
                        change_description=f"Shorten tenor from {current_tenor}m → {shorter}m",
                        new_config={**config_dict, "tenor_months": shorter},
                        new_verdict=new_suit.verdict,
                        new_score=new_suit.score,
                        tradeoff=f"Lower return potential but better horizon alignment.",
                    ))
                    break
            except Exception:
                continue

    # Strategy 2: raise barrier for ELN (reduces loss risk)
    if pt == "ELN" and grids.get("barriers"):
        current_barrier = original_config.barrier_pct  # type: ignore[attr-defined]
        for higher in [b for b in sorted(grids["barriers"], reverse=True) if b > current_barrier]:
            try:
                new_config = ELNConfig(**{**config_dict, "barrier_pct": higher, "coupon_pa": max(0.0, original_config.coupon_pa - 0.02)})  # type: ignore[attr-defined]
                new_metrics = compute_metrics(new_config, df["close"])
                new_suit = evaluate_suitability(new_config, profile, new_metrics)
                if new_suit.score > suitability_original.score + 2:
                    suggestions.append(FixItSuggestion(
                        change_description=f"Raise barrier from {current_barrier:.0%} → {higher:.0%} (coupon adjusted)",
                        new_config=new_config.__dict__,
                        new_verdict=new_suit.verdict,
                        new_score=new_suit.score,
                        tradeoff="Higher downside protection; coupon reduced slightly.",
                    ))
                    break
            except Exception:
                continue

    # Strategy 3: raise protection for CPN
    if pt == "CPN" and grids.get("protections"):
        current_prot = original_config.protection_pct  # type: ignore[attr-defined]
        for higher in [p for p in sorted(grids["protections"], reverse=True) if p > current_prot]:
            try:
                new_config = CPNConfig(**{**config_dict, "protection_pct": higher, "participation_pct": max(0.10, original_config.participation_pct - 0.10)})  # type: ignore[attr-defined]
                new_metrics = compute_metrics(new_config, df["close"])
                new_suit = evaluate_suitability(new_config, profile, new_metrics)
                if new_suit.score > suitability_original.score + 2:
                    suggestions.append(FixItSuggestion(
                        change_description=f"Raise protection from {current_prot:.0%} → {higher:.0%}",
                        new_config=new_config.__dict__,
                        new_verdict=new_suit.verdict,
                        new_score=new_suit.score,
                        tradeoff="More capital protection; participation rate reduced.",
                    ))
                    break
            except Exception:
                continue

    # Strategy 4: DCD – move strike closer to spot (less conversion risk)
    if pt == "DCD" and grids.get("strike_offsets"):
        current_strike = original_config.strike  # type: ignore[attr-defined]
        s0 = float(df["close"].iloc[-1])
        for offset in sorted(grids["strike_offsets"]):
            new_strike = round(s0 * offset, 4)
            if new_strike < current_strike:
                try:
                    new_config = DCDConfig(**{**config_dict, "strike": new_strike})
                    new_metrics = compute_metrics(new_config, df["close"])
                    new_suit = evaluate_suitability(new_config, profile, new_metrics)
                    if new_suit.score > suitability_original.score + 2:
                        suggestions.append(FixItSuggestion(
                            change_description=f"Lower DCD strike from {current_strike:.2f} → {new_strike:.2f}",
                            new_config=new_config.__dict__,
                            new_verdict=new_suit.verdict,
                            new_score=new_suit.score,
                            tradeoff="Lower conversion risk; interest rate slightly reduced.",
                        ))
                        break
                except Exception:
                    continue

    if not suggestions:
        suggestions.append(FixItSuggestion(
            change_description="No parameter adjustment resolves suitability issues.",
            new_config=config_dict,
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
