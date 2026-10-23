"""Opaque request-ID validation and response propagation."""

from __future__ import annotations

import re
import uuid
from collections.abc import Awaitable, Callable

from fastapi import Request, Response

REQUEST_ID_HEADER = "X-Request-ID"
_SAFE_REQUEST_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}")


def resolve_request_id(candidate: str | None) -> str:
    """Keep a bounded opaque ID or replace unsafe input with a random value."""
    if candidate is not None and _SAFE_REQUEST_ID.fullmatch(candidate) is not None:
        return candidate
    return uuid.uuid4().hex


async def request_id_middleware(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    """Attach a safe request ID to request state and every response."""
    request_id = resolve_request_id(request.headers.get(REQUEST_ID_HEADER))
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers[REQUEST_ID_HEADER] = request_id
    return response
