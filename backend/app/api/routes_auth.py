"""
Authentication API routes.

POST /api/auth/rm/login     – RM login with corporate_email + employee_id
POST /api/auth/client/login – Client login with email + password
POST /api/auth/logout       – Invalidate session token
GET  /api/auth/me           – Validate token + return current user info
"""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter, Header
from pydantic import BaseModel

from app.core.errors import AppError
from app.store.auth import (
    client_login,
    create_session,
    destroy_session,
    get_session,
    rm_login,
)
from app.store.cases import get_case
from app.store.db import init_db

logger = logging.getLogger(__name__)
router = APIRouter(tags=["auth"])


# ── Request / Response models ──────────────────────────────────────────────────

class RMLoginRequest(BaseModel):
    corporate_email: str
    employee_id: str


class ClientLoginRequest(BaseModel):
    email: str
    password: str


class LoginResponse(BaseModel):
    token: str
    role: str  # "rm" | "client"
    user: Dict[str, Any]


class MeResponse(BaseModel):
    role: str
    user: Dict[str, Any]


# ── RM Login ───────────────────────────────────────────────────────────────────

@router.post("/auth/rm/login", response_model=LoginResponse)
async def rm_login_route(req: RMLoginRequest) -> LoginResponse:
    """
    Authenticate an RM using corporate email + employee ID.
    These are the existing credentials from registration (no separate password).
    Returns a session token.
    """
    init_db()

    record = rm_login(req.corporate_email, req.employee_id)
    if record is None:
        raise AppError(
            401,
            "INVALID_CREDENTIALS",
            "No RM found with that email and employee ID combination. "
            "Please check your credentials or register first.",
        )

    # Build RBAC summary
    from app.core.rbac import rbac_summary
    rbac = rbac_summary(record["access_tier"], record["operating_jurisdiction"])

    user_info = {
        "rm_id": record["rm_id"],
        "legal_name": record["legal_name"],
        "corporate_email": record["corporate_email"],
        "employee_id": record["employee_id"],
        "institution": record["institution"],
        "branch_code": record["branch_code"],
        "department": record.get("department"),
        "access_tier": record["access_tier"],
        "operating_jurisdiction": record["operating_jurisdiction"],
        "authorised_product_types": record["authorised_product_types"],
        "rbac": rbac,
    }

    token = create_session({"role": "rm", "rm_id": record["rm_id"], **user_info})
    logger.info("RM %s (%s) logged in", record["rm_id"], record["legal_name"])

    return LoginResponse(token=token, role="rm", user=user_info)


# ── Client Login ───────────────────────────────────────────────────────────────

@router.post("/auth/client/login", response_model=LoginResponse)
async def client_login_route(req: ClientLoginRequest) -> LoginResponse:
    """
    Authenticate a client using email + password set during registration.
    Returns a session token.
    """
    init_db()

    account = client_login(req.email, req.password)
    if account is None:
        raise AppError(
            401,
            "INVALID_CREDENTIALS",
            "Invalid email or password. Please check your credentials.",
        )

    # Load the case profile
    case = get_case(account["case_id"])
    profile: Dict[str, Any] = {}
    if case:
        try:
            profile = json.loads(case["profile_json"]) if isinstance(case.get("profile_json"), str) else (case.get("profile") or {})
        except Exception:
            profile = {}

    user_info = {
        "account_id": account["account_id"],
        "case_id": account["case_id"],
        "client_name": account["client_name"],
        "email": account["email"],
        "profile": profile,
    }

    token = create_session({"role": "client", "case_id": account["case_id"], **user_info})
    logger.info("Client %s (case %s) logged in", account["client_name"], account["case_id"])

    return LoginResponse(token=token, role="client", user=user_info)


# ── Logout ─────────────────────────────────────────────────────────────────────

@router.post("/auth/logout")
async def logout(authorization: Optional[str] = Header(default=None)) -> Dict[str, str]:
    """Invalidate a session token."""
    if authorization and authorization.startswith("Bearer "):
        token = authorization.removeprefix("Bearer ").strip()
        destroy_session(token)
    return {"status": "logged_out"}


# ── Me (token validation) ──────────────────────────────────────────────────────

@router.get("/auth/me", response_model=MeResponse)
async def get_me(authorization: Optional[str] = Header(default=None)) -> MeResponse:
    """Validate session token and return current user info."""
    if not authorization or not authorization.startswith("Bearer "):
        raise AppError(401, "UNAUTHORIZED", "Missing or invalid Authorization header.")

    token = authorization.removeprefix("Bearer ").strip()
    session = get_session(token)
    if session is None:
        raise AppError(401, "SESSION_EXPIRED", "Session not found or expired. Please log in again.")

    role = session.get("role", "unknown")
    # Return user info (everything except 'role' key)
    user = {k: v for k, v in session.items() if k != "role"}

    return MeResponse(role=role, user=user)
