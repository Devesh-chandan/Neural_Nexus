"""Standard error shapes and exception handlers."""
from __future__ import annotations

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import ValidationError


def error_body(code: str, message: str) -> dict:
    return {"error": {"code": code, "message": message}}


async def validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    details = exc.errors()
    msg = "; ".join(
        f"{'.'.join(str(l) for l in e['loc'])}: {e['msg']}" for e in details
    )
    return JSONResponse(
        status_code=422,
        content=error_body("VALIDATION_ERROR", msg),
    )


async def generic_exception_handler(
    request: Request, exc: Exception
) -> JSONResponse:
    return JSONResponse(
        status_code=500,
        content=error_body("INTERNAL_ERROR", str(exc)),
    )


class AppError(Exception):
    """Raised by application code with a specific HTTP status and code."""

    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status,
        content=error_body(exc.code, exc.message),
    )
