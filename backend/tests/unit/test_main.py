"""In-process tests for the credential-free application factory."""

from unittest.mock import MagicMock

import pytest

from tests.asgi import request
from trainwatch.config import AppSettings
from trainwatch.infrastructure.firestore.devices import FirestoreDeviceRepository
from trainwatch.infrastructure.firestore.watches import FirestoreWatchRepository
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


def test_create_app_in_staging_initializes_live_adapters(monkeypatch: pytest.MonkeyPatch) -> None:
    """Auto-wire Firestore repositories and production token verifier in staging."""
    mock_create_client = MagicMock()
    mock_client = MagicMock()
    mock_create_client.return_value = mock_client

    import trainwatch.infrastructure.firestore.client as fs_client_mod

    monkeypatch.setattr(fs_client_mod, "create_firestore_client", mock_create_client)

    app = create_app(AppSettings(app_env="staging", project_id="trainwatch-staging"))
    assert isinstance(app.state.watch_repository, FirestoreWatchRepository)
    assert isinstance(app.state.device_repository, FirestoreDeviceRepository)
    mock_create_client.assert_called_once_with(
        project_id="trainwatch-staging",
        database_id="(default)",
        allow_live_access=True,
    )


def test_create_app_in_staging_falls_back_to_default_project_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Fall back to 'trainwatch' project ID when unset in staging."""
    mock_create_client = MagicMock()
    mock_client = MagicMock()
    mock_create_client.return_value = mock_client

    import trainwatch.infrastructure.firestore.client as fs_client_mod

    monkeypatch.setattr(fs_client_mod, "create_firestore_client", mock_create_client)

    app = create_app(AppSettings(app_env="staging", project_id=""))
    assert isinstance(app.state.watch_repository, FirestoreWatchRepository)
    mock_create_client.assert_called_once_with(
        project_id="trainwatch",
        database_id="(default)",
        allow_live_access=True,
    )


def test_create_app_in_staging_preserves_injected_dependencies(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Do not overwrite injected repositories or verifiers."""
    mock_create_client = MagicMock()
    import trainwatch.infrastructure.firestore.client as fs_client_mod

    monkeypatch.setattr(fs_client_mod, "create_firestore_client", mock_create_client)

    injected_watch_repo = MagicMock()
    injected_device_repo = MagicMock()
    injected_verifier = MagicMock()

    app = create_app(
        AppSettings(app_env="staging", project_id="trainwatch"),
        token_verifier=injected_verifier,
        watch_repository=injected_watch_repo,
        device_repository=injected_device_repo,
    )
    assert app.state.watch_repository is injected_watch_repo
    assert app.state.device_repository is injected_device_repo
    mock_create_client.assert_not_called()


def test_create_app_in_production_without_project_id_leaves_repositories_unconfigured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When project_id is empty in production, do not create live firestore client."""
    mock_create_client = MagicMock()
    import trainwatch.infrastructure.firestore.client as fs_client_mod

    monkeypatch.setattr(fs_client_mod, "create_firestore_client", mock_create_client)

    app = create_app(AppSettings(app_env="production", project_id=""))
    assert app.state.watch_repository is None
    assert app.state.device_repository is None
    mock_create_client.assert_not_called()
