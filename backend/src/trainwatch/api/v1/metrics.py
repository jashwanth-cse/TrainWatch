"""Metrics endpoint providing Prometheus and JSON observability snapshots."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request, Response
from fastapi.responses import PlainTextResponse

router = APIRouter(tags=["metrics"])


@router.get("/metrics")
def get_metrics(request: Request) -> Any:
    """Return runtime metrics in Prometheus text format or JSON."""
    metrics = getattr(request.app.state, "metrics", None)
    if metrics is None:
        return PlainTextResponse("", media_type="text/plain; version=0.0.4")

    accept = request.headers.get("accept", "")
    if "application/json" in accept and "text/plain" not in accept:
        return metrics.snapshot()

    return Response(
        content=metrics.to_prometheus_text(),
        media_type="text/plain; version=0.0.4",
    )
