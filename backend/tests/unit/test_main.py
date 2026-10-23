"""In-process tests for the credential-free application factory."""

import pytest

from tests.asgi import request
from trainwatch.config import AppSettings
from trainwatch.main import create_app


@pytest.mark.anyio
async def test_versioned_health_routes_are_local_and_non_sensitive() -> None:
    """Return only process metadata without probing external services."""
    app = create_app(AppSettings(app_env="test"))
    live = await request(app, "GET", "/api/v1/health/live")
    ready = await request(app, "GET", "/api/v1/health/ready")

    assert live.status_code == 200
    assert live.json() == {"status": "ok", "service": "trainwatch-api", "environment": "test"}
    assert ready.status_code == 200
    assert ready.json() == {
        "status": "ready",
        "service": "trainwatch-api",
        "environment": "test",
    }


def test_schema_and_interactive_docs_remain_disabled() -> None:
    """Avoid exposing discovery endpoints before an explicit API-doc decision."""
    app = create_app(AppSettings(app_env="test"))
    assert app.openapi_url is None
    assert app.docs_url is None
    assert app.redoc_url is None
