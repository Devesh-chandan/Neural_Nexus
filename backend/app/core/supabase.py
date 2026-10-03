"""Server-side Supabase Auth and profile helpers."""
from __future__ import annotations

from typing import Any
from urllib.parse import quote

import httpx

from app.core.config import get_settings
from app.core.errors import AppError


def _settings() -> tuple[str, str, str]:
    settings = get_settings()
    if not settings.supabase_url or not settings.supabase_anon_key:
        raise AppError(503, "AUTH_NOT_CONFIGURED", "Supabase authentication is not configured.")
    return (
        settings.supabase_url,
        settings.supabase_anon_key,
        settings.supabase_service_role_key,
    )


def verify_access_token(token: str) -> dict[str, Any]:
    """Ask Supabase Auth to validate the bearer token and load its profile under RLS."""
    base_url, anon_key, _ = _settings()
    headers = {"apikey": anon_key, "Authorization": f"Bearer {token}"}
    try:
        response = httpx.get(
            f"{base_url}/auth/v1/user",
            headers=headers,
            timeout=10.0,
        )
    except httpx.HTTPError as exc:
        raise AppError(503, "AUTH_PROVIDER_UNAVAILABLE", "Supabase Auth could not be reached.") from exc
    if response.status_code != 200:
        raise AppError(401, "UNAUTHORIZED", "Your session is invalid or expired.")

    auth_user = response.json()
    user_id = auth_user.get("id")
    if not isinstance(user_id, str):
        raise AppError(401, "UNAUTHORIZED", "Supabase returned an invalid user session.")
    try:
        profile_response = httpx.get(
            f"{base_url}/rest/v1/user_profiles",
            params={"select": "*", "id": f"eq.{user_id}"},
            headers=headers,
            timeout=10.0,
        )
    except httpx.HTTPError as exc:
        raise AppError(503, "PROFILE_PROVIDER_UNAVAILABLE", "Supabase profile storage could not be reached.") from exc
    if profile_response.status_code != 200:
        raise AppError(503, "PROFILE_LOOKUP_FAILED", "Could not load the authenticated user profile.")

    profiles = profile_response.json()
    if not profiles:
        raise AppError(403, "PROFILE_REQUIRED", "Your account does not have a registered profile.")
    profile = profiles[0]
    if profile.get("user_type") not in {"client", "rm"}:
        raise AppError(403, "INVALID_ROLE", "Your account has no valid application role.")
    profile["email"] = auth_user.get("email")
    return profile


def create_auth_user(
    *,
    email: str,
    password: str,
    user_type: str,
    profile: dict[str, Any],
) -> str:
    """Create a confirmed Supabase Auth user and upsert its application profile."""
    base_url, _, service_key = _settings()
    if not service_key:
        raise AppError(
            503,
            "AUTH_ADMIN_NOT_CONFIGURED",
            "Set SUPABASE_SERVICE_ROLE_KEY on the backend to enable account registration.",
        )

    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
    }
    body = {
        "email": email.strip().lower(),
        "password": password,
        "email_confirm": True,
        "app_metadata": {"user_type": user_type},
        "user_metadata": {"legal_name": profile.get("legal_name", "")},
    }
    try:
        response = httpx.post(
            f"{base_url}/auth/v1/admin/users",
            headers=headers,
            json=body,
            timeout=15.0,
        )
    except httpx.HTTPError as exc:
        raise AppError(503, "AUTH_PROVIDER_UNAVAILABLE", "Supabase Auth could not be reached.") from exc
    if response.status_code == 422 and "already" in response.text.lower():
        raise AppError(409, "EMAIL_ALREADY_REGISTERED", "An account with this email already exists.")
    if response.status_code not in {200, 201}:
        raise AppError(502, "AUTH_ACCOUNT_CREATE_FAILED", "Supabase could not create the account.")

    user_id = response.json().get("id")
    if not isinstance(user_id, str):
        raise AppError(502, "AUTH_ACCOUNT_CREATE_FAILED", "Supabase returned an invalid account.")

    profile_payload = {"id": user_id, "user_type": user_type, **profile}
    try:
        profile_response = httpx.post(
            f"{base_url}/rest/v1/user_profiles",
            params={"on_conflict": "id"},
            headers={
                **headers,
                "Prefer": "resolution=merge-duplicates,return=minimal",
            },
            json=profile_payload,
            timeout=15.0,
        )
    except httpx.HTTPError as exc:
        _delete_auth_user(base_url, headers, user_id)
        raise AppError(503, "PROFILE_PROVIDER_UNAVAILABLE", "Supabase profile storage could not be reached.") from exc
    if profile_response.status_code not in {200, 201, 204}:
        _delete_auth_user(base_url, headers, user_id)
        raise AppError(502, "PROFILE_CREATE_FAILED", "Supabase could not save the user profile.")
    return user_id


def update_auth_profile(user_id: str, profile: dict[str, Any]) -> None:
    base_url, _, service_key = _settings()
    if not service_key:
        raise AppError(503, "AUTH_ADMIN_NOT_CONFIGURED", "Supabase account administration is not configured.")
    response = httpx.patch(
        f"{base_url}/rest/v1/user_profiles",
        params={"id": f"eq.{user_id}"},
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        },
        json=profile,
        timeout=15.0,
    )
    if response.status_code not in {200, 204}:
        raise AppError(502, "PROFILE_UPDATE_FAILED", "Supabase could not update the user profile.")


def delete_auth_user(user_id: str) -> None:
    base_url, _, service_key = _settings()
    if not service_key:
        return
    _delete_auth_user(
        base_url,
        {"apikey": service_key, "Authorization": f"Bearer {service_key}"},
        user_id,
    )


def _delete_auth_user(base_url: str, headers: dict[str, str], user_id: str) -> None:
    response = httpx.delete(
        f"{base_url}/auth/v1/admin/users/{quote(user_id, safe='')}",
        headers=headers,
        timeout=10.0,
    )
    if response.status_code not in {200, 204, 404}:
        raise AppError(502, "AUTH_ROLLBACK_FAILED", "Could not remove the incomplete Supabase account.")
