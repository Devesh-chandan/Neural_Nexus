"""
LLM provider wrapper (Section 10.2, 10.4).
Provider-agnostic: supports groq, anthropic, openai, and none (template-only).
Timeout: 8 seconds. Retries: 1.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, Optional

from app.core.config import get_settings

logger = logging.getLogger(__name__)

TIMEOUT = 8  # seconds

GROQ_BASE_URL = "https://api.groq.com/openai/v1"
DEFAULT_MODELS = {
    "groq": "llama-3.3-70b-versatile",
    "anthropic": "claude-3-5-sonnet-20241022",
    "openai": "gpt-4o",
}

# Set when the provider reports a permanent configuration error (bad key / unknown model), so the
# app stops paying a retry + timeout on every analysis and falls straight back to the template.
_PERMANENT_FAILURE: Optional[str] = None
_PERMANENT_STATUSES = (401, 403, 404)


def _note_failure(label: str, exc: Exception) -> None:
    global _PERMANENT_FAILURE
    status = getattr(exc, "status_code", None)
    if status in _PERMANENT_STATUSES:
        _PERMANENT_FAILURE = (
            f"{label} rejected the request (HTTP {status}); check the API key and LLM_MODEL. "
            "LLM calls are disabled until the server restarts."
        )
        logger.error(_PERMANENT_FAILURE)


def active_model() -> Optional[str]:
    """Model id the configured provider will use, or None when no LLM is configured."""
    settings = get_settings()
    if settings.llm_provider not in DEFAULT_MODELS:
        return None
    return settings.llm_model or DEFAULT_MODELS[settings.llm_provider]


def unavailable_reason() -> Optional[str]:
    """Why no LLM call will be made (shown as the fallback reason), or None if one will."""
    settings = get_settings()
    if _PERMANENT_FAILURE:
        return _PERMANENT_FAILURE
    if settings.llm_provider == "none":
        return "LLM_PROVIDER is 'none'."
    if settings.llm_provider not in DEFAULT_MODELS:
        return f"Unknown LLM_PROVIDER '{settings.llm_provider}'."
    if settings.llm_provider == "groq" and not settings.groq_api_key:
        return "GROQ_API_KEY is not set."
    if settings.llm_provider != "groq" and not settings.llm_api_key:
        return "LLM_API_KEY is not set."
    return None


def _call_anthropic(system_prompt: str, user_prompt: str, max_tokens: int) -> Optional[Dict[str, Any]]:
    settings = get_settings()
    try:
        import anthropic
        client = anthropic.Anthropic(api_key=settings.llm_api_key)
        msg = client.messages.create(
            model=active_model(),
            max_tokens=max_tokens,
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}],
            timeout=TIMEOUT,
        )
        return json.loads(msg.content[0].text)
    except Exception as exc:
        logger.warning("Anthropic LLM call failed: %s", exc)
        _note_failure("Anthropic", exc)
        return None


def _call_openai_compatible(
    system_prompt: str, user_prompt: str, max_tokens: int, *, api_key: str, base_url: Optional[str], label: str
) -> Optional[Dict[str, Any]]:
    try:
        from openai import OpenAI
        client = OpenAI(api_key=api_key, base_url=base_url, timeout=TIMEOUT)
        resp = client.chat.completions.create(
            model=active_model(),
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            max_tokens=max_tokens,
            temperature=0.2,
            response_format={"type": "json_object"},
        )
        return json.loads(resp.choices[0].message.content or "{}")
    except Exception as exc:
        logger.warning("%s LLM call failed: %s", label, exc)
        _note_failure(label, exc)
        return None


def call_llm_json(system_prompt: str, user_prompt: str, max_tokens: int = 1024) -> Optional[Dict[str, Any]]:
    """
    Send one system + user prompt to the configured provider and parse its JSON reply.
    Returns None when no LLM is configured or both attempts fail.
    """
    settings = get_settings()
    reason = unavailable_reason()
    if reason is not None:
        logger.info("Skipping LLM call: %s", reason)
        return None

    provider = settings.llm_provider
    for attempt in range(2):
        if provider == "groq":
            result = _call_openai_compatible(system_prompt, user_prompt, max_tokens,
                                             api_key=settings.groq_api_key, base_url=GROQ_BASE_URL, label="Groq")
        elif provider == "openai":
            result = _call_openai_compatible(system_prompt, user_prompt, max_tokens,
                                             api_key=settings.llm_api_key, base_url=None, label="OpenAI")
        else:
            result = _call_anthropic(system_prompt, user_prompt, max_tokens)

        if isinstance(result, dict):
            return result
        if _PERMANENT_FAILURE:
            break
        if attempt == 0:
            logger.info("LLM call failed; retrying once...")

    return None
