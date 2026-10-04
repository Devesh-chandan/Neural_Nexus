"""Authentication API routes."""
from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, Request

router = APIRouter(tags=["auth"])


@router.get("/auth/me")
def get_me(request: Request) -> Dict[str, Any]:
    """Return the Supabase-verified caller profile from the authentication middleware."""
    profile = dict(request.state.user)
    user_type = profile.pop("user_type")
    if user_type == "client":
        profile["client_name"] = profile.get("legal_name")
    else:
        from app.core.rbac import rbac_summary

        profile["rbac"] = rbac_summary(
            profile["access_tier"],
            profile["operating_jurisdiction"],
        )
    return {"role": user_type, "user": profile}
