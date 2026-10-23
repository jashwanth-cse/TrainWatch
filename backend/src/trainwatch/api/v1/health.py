"""Credential-free local process health routes."""

from fastapi import APIRouter, Request
from pydantic import BaseModel

router = APIRouter(prefix="/health", tags=["health"])


class HealthResponse(BaseModel):
    """Non-sensitive process health response."""

    status: str
    service: str
    environment: str


@router.get("/live", response_model=HealthResponse)
def liveness(request: Request) -> HealthResponse:
    """Report that the local API process can serve requests."""
    return HealthResponse(
        status="ok",
        service="trainwatch-api",
        environment=request.app.state.settings.app_env,
    )


@router.get("/ready", response_model=HealthResponse)
def readiness(request: Request) -> HealthResponse:
    """Report local readiness without probing external dependencies."""
    return HealthResponse(
        status="ready",
        service="trainwatch-api",
        environment=request.app.state.settings.app_env,
    )
