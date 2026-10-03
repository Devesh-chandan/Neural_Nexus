"""
Explanation service orchestrator (Section 10.4).
Tries LLM → validates → falls back to template if needed.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from app.explain.llm import PROMPT_VERSION, call_llm
from app.explain.templates import client_template, rm_template
from app.explain.validator import validate_client_text, validate_rm_text
from app.schemas.explain import ExplanationResult

logger = logging.getLogger(__name__)


def generate_explanation(
    facts: Dict[str, Any],
    model: Optional[str] = None,
) -> ExplanationResult:
    """
    Generate explanation: LLM if available and valid, else template.
    Returns ExplanationResult with source tag.
    """
    llm_result = call_llm(facts)
    source = "template"
    fallback_reason: Optional[str] = None

    if llm_result is not None:
        client_text_raw, rm_text_raw = llm_result
        client_val = validate_client_text(client_text_raw, facts)
        rm_val = validate_rm_text(rm_text_raw, facts)

        if client_val.passed and rm_val.passed:
            return ExplanationResult(
                client_text=client_text_raw,
                rm_text=rm_text_raw,
                source="llm",
                validation=client_val,
                model=model,
                prompt_version=PROMPT_VERSION,
            )
        else:
            failed_checks = [c.detail for c in client_val.checks + rm_val.checks if not c.passed and c.detail]
            fallback_reason = "LLM validation failed: " + "; ".join(failed_checks[:3])
            logger.warning("LLM explanation failed validation: %s", fallback_reason)

    # Template fallback
    client_text = client_template(facts)
    rm_text = rm_template(facts)
    client_val = validate_client_text(client_text, facts)

    return ExplanationResult(
        client_text=client_text,
        rm_text=rm_text,
        source="template",
        validation=client_val,
        model=None,
        prompt_version=PROMPT_VERSION,
        fallback_reason=fallback_reason,
    )
