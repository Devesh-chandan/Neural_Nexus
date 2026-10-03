"""
FastAPI application entry point.
"""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.core.errors import (
    AppError,
    app_error_handler,
    generic_exception_handler,
    validation_exception_handler,
)
from app.core.logging import setup_logging
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
from app.api import routes_cases         # Phase 7
from app.api import routes_audit         # Phase 7
from app.api import routes_explain       # Phase 6
from app.api import routes_recommend     # Phase 5 (stubs)
from app.api import routes_registration  # KYC + RM onboarding
from app.api import routes_auth          # Authentication

app.include_router(routes_auth.router, prefix="/api")
app.include_router(routes_market.router, prefix="/api")
app.include_router(routes_analyze.router, prefix="/api")
app.include_router(routes_cases.router, prefix="/api")
app.include_router(routes_audit.router, prefix="/api")
app.include_router(routes_explain.router, prefix="/api")
app.include_router(routes_recommend.router, prefix="/api")
app.include_router(routes_registration.router, prefix="/api")
