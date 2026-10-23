"""FastAPI process entry point for the Phase 0 startup probe."""

from fastapi import FastAPI
from pydantic import BaseModel

from trainwatch.config import AppSettings


class LivenessResponse(BaseModel):
    """Public, non-sensitive process liveness response."""

    status: str
    service: str
    environment: str


def create_app(settings: AppSettings | None = None) -> FastAPI:
    """Create an isolated application without initializing external clients."""
    resolved_settings = settings or AppSettings.from_environment()
    application = FastAPI(
        title="TrainWatch API",
        version="0.0.1",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )

    @application.get("/health/live", response_model=LivenessResponse)
    def liveness() -> LivenessResponse:
        return LivenessResponse(
            status="ok",
            service="trainwatch-api",
            environment=resolved_settings.app_env,
        )

    return application


app = create_app()
