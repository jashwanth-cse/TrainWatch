"""In-process tests for the minimal Phase 0 API."""

from collections.abc import Callable
from typing import cast

from fastapi.routing import APIRoute

from trainwatch.config import AppSettings
from trainwatch.main import LivenessResponse, create_app


def get_liveness_endpoint() -> Callable[[], LivenessResponse]:
    """Return the registered endpoint without opening a socket or event loop."""
    settings = AppSettings(app_env="test")
    app = create_app(settings)
    route = next(
        route
        for route in app.routes
        if isinstance(route, APIRoute) and route.path == "/health/live"
    )
    return cast(Callable[[], LivenessResponse], route.endpoint)


def test_liveness_is_local_and_non_sensitive() -> None:
    response = get_liveness_endpoint()()

    assert response.model_dump() == {
        "status": "ok",
        "service": "trainwatch-api",
        "environment": "test",
    }


def test_schema_and_interactive_docs_are_not_exposed_in_phase_zero() -> None:
    app = create_app(AppSettings(app_env="test"))

    assert app.openapi_url is None
    assert app.docs_url is None
    assert app.redoc_url is None
