"""Sanitized public API errors and exception handlers."""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException

from trainwatch.api.request_id import REQUEST_ID_HEADER


class ErrorDetail(BaseModel):
    """Stable machine-readable error details."""

    code: str
    message: str


class ErrorResponse(BaseModel):
    """Public error envelope containing no internal exception details."""

    error: ErrorDetail
    request_id: str


class ApiError(Exception):
    """Expected client-facing failure with a safe message."""

    def __init__(self, *, status_code: int, code: str, message: str) -> None:
        super().__init__(code)
        self.status_code = status_code
        self.code = code
        self.message = message


def _request_id(request: Request) -> str:
    """Read the ID assigned by middleware, with a defensive fallback."""
    return str(getattr(request.state, "request_id", "unavailable"))


def _response(request: Request, *, status_code: int, code: str, message: str) -> JSONResponse:
    """Build one sanitized error response."""
    body = ErrorResponse(
        error=ErrorDetail(code=code, message=message),
        request_id=_request_id(request),
    )
    return JSONResponse(
        status_code=status_code,
        content=body.model_dump(),
        headers={REQUEST_ID_HEADER: body.request_id},
    )


def install_error_handlers(application: FastAPI) -> None:
    """Install consistent handlers without leaking stack traces or raw details."""

    @application.exception_handler(ApiError)
    async def api_error_handler(request: Request, exc: ApiError) -> JSONResponse:
        return _response(
            request,
            status_code=exc.status_code,
            code=exc.code,
            message=exc.message,
        )

    @application.exception_handler(RequestValidationError)
    async def validation_error_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        del exc
        return _response(
            request,
            status_code=422,
            code="invalid_request",
            message="Request validation failed",
        )

    @application.exception_handler(StarletteHTTPException)
    async def http_error_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        messages = {
            404: ("not_found", "Resource not found"),
            405: ("method_not_allowed", "Method not allowed"),
        }
        code, message = messages.get(
            exc.status_code,
            ("http_error", "Request could not be completed"),
        )
        return _response(request, status_code=exc.status_code, code=code, message=message)

    @application.exception_handler(Exception)
    async def unexpected_error_handler(request: Request, exc: Exception) -> JSONResponse:
        del exc
        return _response(
            request,
            status_code=500,
            code="internal_error",
            message="An unexpected error occurred",
        )
