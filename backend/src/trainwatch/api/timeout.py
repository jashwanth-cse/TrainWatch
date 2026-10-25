"""Request execution timeout middleware."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable

from fastapi import Request, Response
from fastapi.responses import JSONResponse


async def timeout_middleware(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    """Enforce bounded execution time on every HTTP request."""
    settings = getattr(request.app.state, "settings", None)
    timeout_seconds = getattr(settings, "request_timeout_seconds", 15.0) if settings else 15.0

    try:
        async with asyncio.timeout(timeout_seconds):
            return await call_next(request)
    except TimeoutError:
        request_id = getattr(request.state, "request_id", "unknown")
        return JSONResponse(
            status_code=504,
            content={
                "error": {
                    "code": "request_timeout",
                    "message": "Request execution timed out.",
                }
            },
            headers={"X-Request-ID": request_id},
        )
