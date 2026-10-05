"""What a client may see of a suitability result and its explanation.

Relationship managers get the full detail. Clients never receive compliance-screening results
(AML, FATCA, vulnerability, profile freshness), KYC data-completeness notes, or the RM briefing;
they only learn that the bank needs to complete additional checks.
"""
from __future__ import annotations

import copy
from typing import Any, Dict, Optional

_CLIENT_COMPLIANCE_MESSAGE = "The bank needs to complete some additional checks before any decision."
_HIDDEN_RULES = {"R-KYC"}


def is_rm(user: Dict[str, Any]) -> bool:
    return user.get("user_type") == "rm"


def redact_suitability(suitability: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not suitability:
        return suitability
    s = copy.deepcopy(suitability)
    assessment = s.get("assessment")
    if isinstance(assessment, dict):
        flags = assessment.pop("compliance_flags", None) or {}
        assessment["additional_checks_required"] = any(f.get("status") != "PASS" for f in flags.values())
        assessment["additional_checks"] = {
            k: v for k, v in (assessment.get("additional_checks") or {}).items() if k != "kyc_data"}
    for key in ("rules", "mismatches"):
        kept = []
        for rule in s.get(key) or []:
            if rule.get("rule_id") in _HIDDEN_RULES:
                continue
            if rule.get("rule_id") == "R-COMPLIANCE":
                rule = {**rule, "message": _CLIENT_COMPLIANCE_MESSAGE, "facts": {}}
            kept.append(rule)
        s[key] = kept
    s["score_drivers"] = [d for d in s.get("score_drivers") or [] if d.get("rule_id") not in _HIDDEN_RULES]
    return s


def redact_explanation(explanation: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not explanation:
        return explanation
    e = {k: v for k, v in explanation.items() if k != "rm"}
    e["rm_text"] = ""
    return e
