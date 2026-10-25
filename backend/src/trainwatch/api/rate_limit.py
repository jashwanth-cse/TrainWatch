"""In-memory sliding-window rate limiting middleware with rate limit headers."""

from __future__ import annotations

import threading
import time
from collections import defaultdict
from collections.abc import Awaitable, Callable
from typing import Any

from fastapi import Request, Response
from fastapi.responses import JSONResponse

from trainwatch.api.errors import ApiError

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
        """Create isolated client buckets and a periodic eviction counter."""
        self.window_seconds = window_seconds
        self._lock = threading.Lock()
        self._hits: dict[str, list[float]] = defaultdict(list)
        self._calls = 0

    def check(self, key: str, max_requests: int, now: float | None = None) -> tuple[bool, int, int]:
        """Check if client exceeds limit.

        Returns: (allowed, remaining, reset_seconds)
        """
        current_time = now if now is not None else time.time()
        window_start = current_time - self.window_seconds

        with self._lock:
            self._calls += 1
            if self._calls % 1024 == 0:
                stale_keys = [
                    key
                    for key, timestamps in self._hits.items()
                    if not timestamps or timestamps[-1] <= window_start
                ]
                for stale_key in stale_keys:
                    del self._hits[stale_key]
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
            self._calls = 0


default_rate_limiter = SlidingWindowRateLimiter(window_seconds=60)


def resolve_client_key(request: Request) -> str:
    """Identify the caller by authenticated user ID or client IP."""
    user: Any = getattr(request.state, "user", None)
    if user is not None and getattr(user, "uid", None):
        return f"user:{user.uid}"
    client_ip = request.client.host if request.client else "unknown"
    return f"ip:{client_ip}"


def _rate_limit_response(request: Request, limit: int, reset_seconds: int) -> Response:
    """Return the existing quota error and retry headers for either limiting tier."""
    request_id = getattr(request.state, "request_id", "unknown")
    return JSONResponse(
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
    dependency = getattr(request.app.state, "current_user_dependency", None)
    authorization = request.headers.get("authorization")
    if dependency is not None and authorization is not None:
        auth_limit = getattr(settings, "auth_attempts_per_minute", 600) if settings else 600
        client_ip = request.client.host if request.client else "unknown"
        auth_allowed, _, auth_reset = limiter.check(
            key=f"auth-ip:{client_ip}", max_requests=auth_limit
        )
        if not auth_allowed:
            return _rate_limit_response(request, auth_limit, auth_reset)
        try:
            await dependency(request=request, authorization=authorization)
        except ApiError as exc:
            if exc.status_code != 401:
                raise
            # Invalid credentials share the anonymous IP bucket; protected routes
            # still return the cached, sanitized authentication error.
    key = resolve_client_key(request)

    allowed, remaining, reset_seconds = limiter.check(key=key, max_requests=limit)

    if not allowed:
        return _rate_limit_response(request, limit, reset_seconds)

    response = await call_next(request)
    response.headers["X-RateLimit-Limit"] = str(limit)
    response.headers["X-RateLimit-Remaining"] = str(remaining)
    response.headers["X-RateLimit-Reset"] = str(reset_seconds)
    return response
