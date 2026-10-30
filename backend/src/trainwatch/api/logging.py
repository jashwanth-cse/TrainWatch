"""Structured JSON access and audit logging with token/credential redaction."""

from __future__ import annotations

import json
import logging
import time
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

from fastapi import Request, Response

_SENSITIVE_HEADERS = frozenset(
    {
        "authorization",
        "cookie",
        "set-cookie",
        "x-internal-token",
        "x-api-key",
        "fcm-token",
        "token",
    }
)

logger = logging.getLogger("trainwatch.access")


def _record_request_metrics(request: Request, status_code: int, duration_ms: float) -> None:
    """Record completions using a route template or one fixed unmatched label."""
    metrics = getattr(request.app.state, "metrics", None)
    if metrics is not None:
        route = request.scope.get("route")
        metrics.record_request(
            method=request.method,
            path=getattr(route, "path", "/unmatched"),
            status_code=status_code,
            duration_seconds=duration_ms / 1000.0,
        )


def sanitize_headers(headers: dict[str, str] | Any) -> dict[str, str]:
    """Redact sensitive header values to prevent credential leakage in logs."""
    sanitized: dict[str, str] = {}
    items = headers.items() if hasattr(headers, "items") else []
    for key, value in items:
        lower_key = str(key).lower()
        if lower_key in _SENSITIVE_HEADERS or "token" in lower_key or "secret" in lower_key:
            sanitized[str(key)] = "[REDACTED]"
        else:
            sanitized[str(key)] = str(value)
    return sanitized


def format_log_entry(
    *,
    timestamp: datetime,
    severity: str,
    request_id: str,
    method: str,
    path: str,
    status_code: int,
    duration_ms: float,
    client_ip: str,
    extra: dict[str, Any] | None = None,
) -> str:
    """Produce a deterministic, single-line JSON log entry."""
    entry: dict[str, Any] = {
        "timestamp": timestamp.isoformat(),
        "severity": severity,
        "request_id": request_id,
        "method": method,
        "path": path,
        "status_code": status_code,
        "duration_ms": duration_ms,
        "client_ip": client_ip,
    }
    if extra:
        entry["extra"] = extra
    return json.dumps(entry, separators=(",", ":"))


async def structured_logging_middleware(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    """Measure request execution and output structured JSON access logs."""
    start_time = time.perf_counter()
    request_id = getattr(request.state, "request_id", "unknown")
    client_ip = request.client.host if request.client else "unknown"

    try:
        response = await call_next(request)
        duration_ms = round((time.perf_counter() - start_time) * 1000, 2)
        severity = "INFO" if response.status_code < 500 else "ERROR"

        entry = format_log_entry(
            timestamp=datetime.now(UTC),
            severity=severity,
            request_id=request_id,
            method=request.method,
            path=request.url.path,
            status_code=response.status_code,
            duration_ms=duration_ms,
            client_ip=client_ip,
        )
        if severity == "ERROR":
            logger.error(entry)
        else:
            logger.info(entry)

        _record_request_metrics(request, response.status_code, duration_ms)

        return response
    except Exception as exc:
        duration_ms = round((time.perf_counter() - start_time) * 1000, 2)
        entry = format_log_entry(
            timestamp=datetime.now(UTC),
            severity="ERROR",
            request_id=request_id,
            method=request.method,
            path=request.url.path,
            status_code=500,
            duration_ms=duration_ms,
            client_ip=client_ip,
            extra={"error": type(exc).__name__},
        )
        logger.error(entry)
        _record_request_metrics(request, 500, duration_ms)
        raise
