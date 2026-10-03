"""
FastAPI application entry point.
"""
from __future__ import annotations

import asyncio
from typing import Any

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.requests import Request
from starlette.responses import Response

from app.core.config import get_settings
from app.core.errors import (
    AppError,
    app_error_handler,
    generic_exception_handler,
    validation_exception_handler,
)
from app.core.logging import setup_logging
from app.core.supabase import verify_access_token
from app.store.db import init_db

setup_logging()

settings = get_settings()

# Ensure DB tables exist on startup
init_db()

app = FastAPI(
    title="Neural Nexus – Suitability-Aware Payoff Simulator",
    version="0.1.0",
    description=(
        "Decision-support prototype for structured investment products. "
        "Not investment advice."
    ),
)


_PUBLIC_API_ROUTES = {
    ("GET", "/api/underlyings"),
    ("GET", "/api/registration/access-tiers"),
    ("GET", "/api/registration/jurisdictions"),
    ("POST", "/api/registration/validate/email"),
    ("POST", "/api/registration/client"),
    ("POST", "/api/registration/rm"),
    ("GET", "/api/kyc/providers"),
    ("POST", "/api/kyc/import"),
}


@app.middleware("http")
async def authenticate_api_requests(request: Request, call_next: Any) -> Response:
    """Require Supabase authentication except for public onboarding and market data."""
    path = request.url.path
    method = request.method.upper()
    public = (
        (method, path) in _PUBLIC_API_ROUTES
        or (method == "GET" and path.startswith("/api/market/"))
        or (method == "GET" and path.startswith("/api/product-defaults/"))
    )
    if path.startswith("/api/") and not public and method != "OPTIONS":
        authorization = request.headers.get("authorization", "")
        if not authorization.startswith("Bearer "):
            return JSONResponse(
                status_code=401,
                content={"error": {"code": "UNAUTHORIZED", "message": "A valid Supabase bearer token is required."}},
            )
        try:
            request.state.user = await asyncio.to_thread(
                verify_access_token,
                authorization.removeprefix("Bearer ").strip(),
            )
        except AppError as exc:
            return JSONResponse(
                status_code=exc.status,
                content={"error": {"code": exc.code, "message": exc.message}},
            )
        if (
            path == "/api/registration/rms"
            or path.startswith("/api/registration/rm/")
            or path == "/api/audit/verify-chain"
        ):
            user = request.state.user
            if user.get("user_type") != "rm":
                return JSONResponse(
                    status_code=403,
                    content={"error": {"code": "FORBIDDEN", "message": "This route is restricted to relationship managers."}},
                )
            requested_rm_id = (
                path.removeprefix("/api/registration/rm/").split("/", 1)[0]
                if path.startswith("/api/registration/rm/")
                else ""
            )
            if requested_rm_id and user.get("rm_id") != requested_rm_id:
                return JSONResponse(
                    status_code=403,
                    content={"error": {"code": "FORBIDDEN", "message": "You may only access your own RM account."}},
                )
    return await call_next(request)


# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Exception handlers
app.add_exception_handler(RequestValidationError, validation_exception_handler)  # type: ignore[arg-type]
app.add_exception_handler(AppError, app_error_handler)  # type: ignore[arg-type]
app.add_exception_handler(Exception, generic_exception_handler)


@app.get("/health", tags=["infra"])
async def health() -> dict:
    return {"status": "ok", "version": app.version}


# ── Route registration ────────────────────────────────────────────────────────
from app.api import routes_market        # Phase 1
from app.api import routes_analyze       # Phase 3/4
from app.api import routes_simulation    # module2_simulation_engine: real historical replay
from app.api import routes_cases         # Phase 7
from app.api import routes_audit         # Phase 7
from app.api import routes_explain       # Phase 6
from app.api import routes_recommend     # Phase 5 (stubs)
from app.api import routes_registration  # KYC + RM onboarding
from app.api import routes_auth          # Authentication

app.include_router(routes_auth.router, prefix="/api")
app.include_router(routes_market.router, prefix="/api")
app.include_router(routes_analyze.router, prefix="/api")
app.include_router(routes_simulation.router, prefix="/api")
app.include_router(routes_cases.router, prefix="/api")
app.include_router(routes_audit.router, prefix="/api")
app.include_router(routes_explain.router, prefix="/api")
app.include_router(routes_recommend.router, prefix="/api")
app.include_router(routes_registration.router, prefix="/api")
