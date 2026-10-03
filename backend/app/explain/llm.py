"""
LLM provider wrapper (Section 10.2, 10.4).
Provider-agnostic: supports anthropic, openai, and none (template-only).
Timeout: 8 seconds. Retries: 1.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, Optional, Tuple

from app.core.config import get_settings

logger = logging.getLogger(__name__)

PROMPT_VERSION = "v1.0"
TIMEOUT = 8  # seconds

SYSTEM_PROMPT = """You are a translator of pre-computed financial facts for non-expert clients.

STRICT RULES:
1. Do NOT calculate, estimate, or add facts not in the payload.
2. Do NOT recommend buying or selling.
3. Do NOT soften any flag or suitability verdict.
4. NEVER use the words: guaranteed, risk-free, risk free, safe, no risk, cannot lose, will not lose, 100% safe.
5. ALWAYS state the maximum possible loss and when it happens.
6. ALWAYS mention that capital protection depends on the issuer (for CPN).
7. Use a reading level appropriate for a general adult audience (clear, plain English).
8. Return valid JSON with exactly two keys: "client_text" and "rm_text".
9. client_text: 200–280 words covering sections: "What this product does", "How you could earn", 
   "When you could lose money and how much", "Why it does or does not fit you", "What to discuss with your RM".
10. rm_text: 150–250 words, technical, listing rules triggered and numbers.
11. The client name is provided only as a label — do not use it to personalise in a way that sounds like financial advice.
"""

USER_PROMPT_TEMPLATE = "Here are the pre-computed facts. Generate the explanation JSON:\n\n{facts_json}"


def _call_anthropic(facts: Dict[str, Any]) -> Optional[Tuple[str, str]]:
    settings = get_settings()
    try:
        import anthropic
        client = anthropic.Anthropic(api_key=settings.llm_api_key)
        facts_json = json.dumps(facts, indent=2, default=str)
        msg = client.messages.create(
            model=settings.llm_model or "claude-3-5-sonnet-20241022",
            max_tokens=1024,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": USER_PROMPT_TEMPLATE.format(facts_json=facts_json)}],
            timeout=TIMEOUT,
        )
        raw = msg.content[0].text
        parsed = json.loads(raw)
        return parsed.get("client_text", ""), parsed.get("rm_text", "")
    except Exception as exc:
        logger.warning("Anthropic LLM call failed: %s", exc)
        return None


def _call_openai(facts: Dict[str, Any]) -> Optional[Tuple[str, str]]:
    settings = get_settings()
    try:
        from openai import OpenAI
        client = OpenAI(api_key=settings.llm_api_key, timeout=TIMEOUT)
        facts_json = json.dumps(facts, indent=2, default=str)
        resp = client.chat.completions.create(
            model=settings.llm_model or "gpt-4o",
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": USER_PROMPT_TEMPLATE.format(facts_json=facts_json)},
            ],
            max_tokens=1024,
            response_format={"type": "json_object"},
        )
        raw = resp.choices[0].message.content or "{}"
        parsed = json.loads(raw)
        return parsed.get("client_text", ""), parsed.get("rm_text", "")
    except Exception as exc:
        logger.warning("OpenAI LLM call failed: %s", exc)
        return None


def call_llm(facts: Dict[str, Any]) -> Optional[Tuple[str, str]]:
    """
    Call the configured LLM provider with the facts payload.
    Returns (client_text, rm_text) or None on failure.
    """
    settings = get_settings()
    provider = settings.llm_provider

    if provider == "none":
        return None

    # Try once, retry once on failure
    for attempt in range(2):
        if provider == "anthropic":
            result = _call_anthropic(facts)
        elif provider == "openai":
            result = _call_openai(facts)
        else:
            logger.warning("Unknown LLM provider: %s", provider)
            return None

        if result is not None:
            return result
        if attempt == 0:
            logger.info("LLM call failed; retrying once...")

    return None
