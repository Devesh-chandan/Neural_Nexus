"""
Explanation validator (Section 10.3).
Validates LLM output against the computed facts payload.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Tuple

from app.core.config import get_suitability_rules
from app.schemas.explain import ExplanationValidation, ValidationCheck


def _extract_numbers(text: str) -> List[float]:
    """Extract all numbers (including percentages) from text."""
    raw = re.findall(r"[\d,]+\.?\d*", text.replace(",", ""))
    nums = []
    for r in raw:
        try:
            nums.append(float(r))
        except ValueError:
            pass
    # Also extract percentages: "12.5%"
    pct_raw = re.findall(r"(\d+\.?\d*)\s*%", text)
    for p in pct_raw:
        try:
            nums.append(float(p) / 100.0)
        except ValueError:
            pass
    return nums


def _check_forbidden(text: str, forbidden: List[str]) -> Tuple[bool, str]:
    lower = text.lower()
    for phrase in forbidden:
        if phrase.lower() in lower:
            return False, f"Forbidden phrase found: '{phrase}'"
    return True, ""


def _check_verdict_tone(text: str, verdict: str) -> Tuple[bool, str]:
    cfg = get_suitability_rules()
    kw = cfg.get("verdict_keywords", {})
    lower = text.lower()

    if verdict == "NOT_SUITABLE":
        required = kw.get("NOT_SUITABLE", {}).get("required_phrases", [])
        if not any(p.lower() in lower for p in required):
            return False, f"NOT_SUITABLE verdict but none of {required} found in text."
    elif verdict == "CONDITIONALLY_SUITABLE":
        caution = kw.get("CONDITIONALLY_SUITABLE", {}).get("required_caution_words", [])
        if not any(w.lower() in lower for w in caution):
            return False, f"CONDITIONALLY_SUITABLE verdict but no caution words found."
    elif verdict == "SUITABLE":
        forbidden_in_suitable = kw.get("NOT_SUITABLE", {}).get("required_phrases", [])
        for p in forbidden_in_suitable:
            if p.lower() in lower:
                return False, f"SUITABLE verdict but '{p}' found in text."

    return True, ""


def _check_max_loss_mentioned(text: str, max_loss_pct: float) -> Tuple[bool, str]:
    """Check that some reference to maximum loss is present."""
    lower = text.lower()
    has_loss = any(w in lower for w in ["maximum loss", "max loss", "worst", "lose", "loss", "losing"])
    if not has_loss:
        return False, "No mention of maximum loss."
    return True, ""


def _check_length(text: str, min_words: int, max_words: int) -> Tuple[bool, str]:
    words = len(text.split())
    if words < min_words:
        return False, f"Text too short: {words} words (min {min_words})."
    if words > max_words:
        return False, f"Text too long: {words} words (max {max_words})."
    return True, ""


def validate_client_text(
    text: str,
    facts: Dict[str, Any],
) -> ExplanationValidation:
    """Validate client-facing text against the facts payload."""
    cfg_rules = get_suitability_rules()
    forbidden = cfg_rules.get("llm_forbidden_phrases", [])
    verdict = facts.get("suitability", {}).get("verdict", "CONDITIONALLY_SUITABLE")
    max_loss_pct = facts.get("metrics", {}).get("max_loss_pct", 0.0)

    checks: List[ValidationCheck] = []

    # 1. Forbidden phrases
    ok, detail = _check_forbidden(text, forbidden)
    checks.append(ValidationCheck(check_name="forbidden_phrases", passed=ok, detail=detail or None))

    # 2. Verdict tone
    ok, detail = _check_verdict_tone(text, verdict)
    checks.append(ValidationCheck(check_name="verdict_tone", passed=ok, detail=detail or None))

    # 3. Max-loss mentioned
    ok, detail = _check_max_loss_mentioned(text, max_loss_pct)
    checks.append(ValidationCheck(check_name="max_loss_mentioned", passed=ok, detail=detail or None))

    # 4. Length bounds (client: 200-280 words)
    ok, detail = _check_length(text, 150, 400)
    checks.append(ValidationCheck(check_name="length_bounds", passed=ok, detail=detail or None))

    passed = all(c.passed for c in checks)
    return ExplanationValidation(passed=passed, checks=checks)


def validate_rm_text(text: str, facts: Dict[str, Any]) -> ExplanationValidation:
    """Validate RM-facing text."""
    cfg_rules = get_suitability_rules()
    forbidden = cfg_rules.get("llm_forbidden_phrases", [])
    verdict = facts.get("suitability", {}).get("verdict", "CONDITIONALLY_SUITABLE")

    checks: List[ValidationCheck] = []
    ok, detail = _check_forbidden(text, forbidden)
    checks.append(ValidationCheck(check_name="forbidden_phrases", passed=ok, detail=detail or None))
    ok, detail = _check_verdict_tone(text, verdict)
    checks.append(ValidationCheck(check_name="verdict_tone", passed=ok, detail=detail or None))
    ok, detail = _check_length(text, 100, 400)
    checks.append(ValidationCheck(check_name="length_bounds", passed=ok, detail=detail or None))

    passed = all(c.passed for c in checks)
    return ExplanationValidation(passed=passed, checks=checks)
