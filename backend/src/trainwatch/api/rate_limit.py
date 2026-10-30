"""In-memory sliding-window rate limiting middleware with rate limit headers."""

from __future__ import annotations

import threading
import time
from collections import defaultdict
from collections.abc import Awaitable, Callable
from typing import Any

from fastapi import Request, Response
from fastapi.responses import JSONResponse

_EXEMPT_PATHS = frozenset(
    {
        "/healthz",
        "/readyz",
        "/api/v1/health/live",
        "/api/v1/health/ready",
        "/api/v1/metrics",
    }
)


class SlidingWindowRateLimiter:
    """Sliding-window counter rate limiter per client key."""

    def __init__(self, window_seconds: int = 60) -> None:
        self.window_seconds = window_seconds
        self._lock = threading.Lock()
        self._hits: dict[str, list[float]] = defaultdict(list)

    def check(self, key: str, max_requests: int, now: float | None = None) -> tuple[bool, int, int]:
        """Check if client exceeds limit.

        Returns: (allowed, remaining, reset_seconds)
        """
        current_time = now if now is not None else time.time()
        window_start = current_time - self.window_seconds

        with self._lock:
            # Filter out entries older than the window
            timestamps = [ts for ts in self._hits[key] if ts > window_start]
            if len(timestamps) >= max_requests:
                oldest = timestamps[0]
                reset_seconds = max(1, int(oldest + self.window_seconds - current_time))
                self._hits[key] = timestamps
                return False, 0, reset_seconds

            timestamps.append(current_time)
            self._hits[key] = timestamps
            remaining = max(0, max_requests - len(timestamps))
            oldest = timestamps[0]
            reset_seconds = max(1, int(oldest + self.window_seconds - current_time))
            return True, remaining, reset_seconds

    def reset(self) -> None:
        """Clear all rate limits."""
        with self._lock:
            self._hits.clear()


default_rate_limiter = SlidingWindowRateLimiter(window_seconds=60)


def resolve_client_key(request: Request) -> str:
    """Identify the caller by authenticated user ID or client IP."""
    user: Any = getattr(request.state, "user", None)
    if user is not None and getattr(user, "uid", None):
        return f"user:{user.uid}"
    client_ip = request.client.host if request.client else "unknown"
    return f"ip:{client_ip}"


async def rate_limit_middleware(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    """Enforce rate limiting on non-exempt endpoints."""
    path = request.url.path
    if path in _EXEMPT_PATHS:
        return await call_next(request)

    settings = getattr(request.app.state, "settings", None)
    enabled = getattr(settings, "enable_rate_limiter", True) if settings else True
    if not enabled:
        return await call_next(request)

    limit = getattr(settings, "rate_limit_per_minute", 60) if settings else 60
    limiter: SlidingWindowRateLimiter = getattr(
        request.app.state, "rate_limiter", default_rate_limiter
    )
    key = resolve_client_key(request)

    allowed, remaining, reset_seconds = limiter.check(key=key, max_requests=limit)

    if not allowed:
        request_id = getattr(request.state, "request_id", "unknown")
        error_response = JSONResponse(
            status_code=429,
            content={
                "error": {
                    "code": "rate_limit_exceeded",
                    "message": "Too many requests. Please try again later.",
                }
            },
            headers={
                "Retry-After": str(reset_seconds),
                "X-RateLimit-Limit": str(limit),
                "X-RateLimit-Remaining": "0",
                "X-RateLimit-Reset": str(reset_seconds),
                "X-Request-ID": request_id,
            },
        )
        return error_response

    response = await call_next(request)
    response.headers["X-RateLimit-Limit"] = str(limit)
    response.headers["X-RateLimit-Remaining"] = str(remaining)
    response.headers["X-RateLimit-Reset"] = str(reset_seconds)
    return response
