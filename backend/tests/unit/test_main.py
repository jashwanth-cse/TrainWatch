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


def test_create_app_in_staging_partial_injection(monkeypatch: pytest.MonkeyPatch) -> None:
    """Initialize only unprovided repositories in staging."""
    mock_create_client = MagicMock()
    mock_client = MagicMock()
    mock_create_client.return_value = mock_client
    import trainwatch.infrastructure.firestore.client as fs_client_mod

    monkeypatch.setattr(fs_client_mod, "create_firestore_client", mock_create_client)
    injected_watch_repo = MagicMock()
    app1 = create_app(
        AppSettings(app_env="staging", project_id="trainwatch"),
        watch_repository=injected_watch_repo,
    )
    assert app1.state.watch_repository is injected_watch_repo
    assert isinstance(app1.state.device_repository, FirestoreDeviceRepository)

    injected_device_repo = MagicMock()
    app2 = create_app(
        AppSettings(app_env="staging", project_id="trainwatch"),
        device_repository=injected_device_repo,
    )
    assert isinstance(app2.state.watch_repository, FirestoreWatchRepository)
    assert app2.state.device_repository is injected_device_repo

    injected_notif = MagicMock()
    injected_disp = MagicMock()
    app3 = create_app(
        AppSettings(app_env="staging", project_id="trainwatch"),
        notification_dispatcher_service=injected_notif,
        dispatcher_service=injected_disp,
    )
    assert app3.state.notification_dispatcher_service is injected_notif
    assert app3.state.dispatcher_service is injected_disp


@pytest.mark.anyio
async def test_firestore_watch_dispatcher_execution() -> None:
    """Validate FirestoreWatchDispatcher counts active reminders and handles errors."""
    from datetime import UTC, datetime

    from trainwatch.main import FirestoreWatchDispatcher

    mock_client = MagicMock()
    mock_group = MagicMock()

    async def fake_get() -> list[MagicMock]:
        doc1 = MagicMock()
        doc1.to_dict.return_value = {"status": "active"}
        doc2 = MagicMock()
        doc2.to_dict.return_value = {"status": "paused"}
        return [doc1, doc2]

    mock_group.get = fake_get
    mock_client.collection_group.return_value = mock_group

    dispatcher = FirestoreWatchDispatcher(mock_client)
    count = await dispatcher.dispatch_due_jobs(now=datetime.now(UTC))
    assert count == 1

    async def fake_err() -> list[MagicMock]:
        raise RuntimeError("network error")

    mock_group.get = fake_err
    err_count = await dispatcher.dispatch_due_jobs(now=datetime.now(UTC))
    assert err_count == 0


@pytest.mark.anyio
async def test_firestore_watch_dispatcher_full_evaluation(monkeypatch: pytest.MonkeyPatch) -> None:
    """Validate FirestoreWatchDispatcher evaluates watches, alerts, and dispatches notifications."""
    from datetime import UTC, datetime
    from unittest.mock import AsyncMock, MagicMock

    from trainwatch.config import AppSettings
    from trainwatch.domain.availability import (
        AvailabilityObservation,
        AvailabilitySnapshot,
        AvailabilityStatus,
        ProviderFailure,
    )
    from trainwatch.domain.watch import TrainQuery
    from trainwatch.main import FirestoreWatchDispatcher, create_app

    now = datetime(2026, 11, 1, 10, 0, 0, tzinfo=UTC)

    mock_client = MagicMock()
    mock_group = MagicMock()
    mock_client.collection_group.return_value = mock_group

    mock_provider = MagicMock()
    mock_outbox = MagicMock()
    mock_outbox.save_notification = AsyncMock()
    mock_notif_disp = MagicMock()
    mock_notif_disp.dispatch_pending = AsyncMock()

    snap_avl = AvailabilitySnapshot(
        status=AvailabilityStatus.AVAILABLE,
        raw_availability="AVAILABLE 120",
        observed_at=now,
        position=None,
    )
    snap_rac = AvailabilitySnapshot(
        status=AvailabilityStatus.RAC,
        raw_availability="RAC 30",
        observed_at=now,
        position=30,
    )
    snap_avl_unparseable = AvailabilitySnapshot(
        status=AvailabilityStatus.AVAILABLE,
        raw_availability="NO_DIGITS",
        observed_at=now,
        position=None,
    )

    # 1. Active doc with seats_below met (first check, no previous)
    doc_seats_below = MagicMock()
    doc_seats_below.id = "w_001"
    doc_seats_below.to_dict.return_value = {
        "schemaVersion": 1,
        "status": "active",
        "ownerId": "user_123",
        "query": {
            "trainNumber": "06030",
            "source": "RJPM",
            "destination": "CNV",
            "journeyDate": "2026-11-05",
            "travelClass": "SL",
            "quota": "GN",
        },
        "condition": {
            "kind": "seats_below",
            "targetStatus": None,
            "maximumPosition": 160,
        },
        "createdAt": now,
        "updatedAt": now,
    }
    doc_seats_below.reference.update = AsyncMock()

    # 2. Active doc with reaches_threshold met (first check)
    doc_threshold = MagicMock()
    doc_threshold.id = "w_002"
    doc_threshold.to_dict.return_value = {
        "schemaVersion": 1,
        "status": "active",
        "ownerId": "user_123",
        "query": {
            "trainNumber": "06030",
            "source": "RJPM",
            "destination": "CNV",
            "journeyDate": "2026-11-05",
            "travelClass": "SL",
            "quota": "GN",
        },
        "condition": {
            "kind": "reaches_threshold",
            "targetStatus": "RAC",
            "maximumPosition": 50,
        },
        "createdAt": now,
        "updatedAt": now,
    }
    doc_threshold.reference.update = AsyncMock()

    # 3. Active doc with becomes_available met
    doc_becomes_avl = MagicMock()
    doc_becomes_avl.id = "w_003"
    parent_doc = MagicMock()
    parent_doc.id = "user_parent"
    parent_col = MagicMock()
    parent_col.parent = parent_doc
    doc_becomes_avl.reference.parent = parent_col
    doc_becomes_avl.to_dict.return_value = {
        "schemaVersion": 1,
        "status": "active",
        "query": {
            "trainNumber": "12661",
            "source": "MS",
            "destination": "TEN",
            "journeyDate": "2026-11-05",
            "travelClass": "SL",
            "quota": "GN",
        },
        "condition": {
            "kind": "becomes_available",
            "targetStatus": None,
            "maximumPosition": None,
        },
        "createdAt": now,
        "updatedAt": now,
    }
    doc_becomes_avl.reference.update = AsyncMock()

    # 4. Doc already alerted with same key
    doc_dup = MagicMock()
    doc_dup.id = "w_004"
    doc_dup.to_dict.return_value = {
        "schemaVersion": 1,
        "status": "active",
        "ownerId": "user_123",
        "query": {
            "trainNumber": "06030",
            "source": "RJPM",
            "destination": "CNV",
            "journeyDate": "2026-11-05",
            "travelClass": "SL",
            "quota": "GN",
        },
        "condition": {
            "kind": "seats_below",
            "targetStatus": None,
            "maximumPosition": 160,
        },
        "lastAlertedKey": "alert:w_004:RAC:30",
        "createdAt": now,
        "updatedAt": now,
    }
    doc_dup.reference.update = AsyncMock()

    # 5. Doc with previous observation where should_alert triggers
    doc_prev = MagicMock()
    doc_prev.id = "w_005"
    doc_prev.to_dict.return_value = {
        "schemaVersion": 1,
        "status": "active",
        "ownerId": "user_123",
        "query": {
            "trainNumber": "06030",
            "source": "RJPM",
            "destination": "CNV",
            "journeyDate": "2026-11-05",
            "travelClass": "SL",
            "quota": "GN",
        },
        "condition": {
            "kind": "seats_below",
            "targetStatus": None,
            "maximumPosition": 160,
        },
        "lastObservation": {
            "status": "AVAILABLE",
            "rawAvailability": "AVAILABLE 180",
            "position": None,
            "observedAt": now.isoformat(),
        },
        "createdAt": now,
        "updatedAt": now,
    }
    doc_prev.reference.update = AsyncMock()

    # 6. Expired doc
    doc_expired = MagicMock()
    doc_expired.id = "w_006"
    doc_expired.to_dict.return_value = {
        "schemaVersion": 1,
        "status": "active",
        "ownerId": "user_123",
        "query": {
            "trainNumber": "06030",
            "source": "RJPM",
            "destination": "CNV",
            "journeyDate": "2026-10-01",  # in the past
            "travelClass": "SL",
            "quota": "GN",
        },
        "condition": {
            "kind": "seats_below",
            "maximumPosition": 160,
        },
        "createdAt": now,
        "updatedAt": now,
    }

    # 7. Malformed / decoding error doc
    doc_bad = MagicMock()
    doc_bad.id = "w_007"
    doc_bad.to_dict.return_value = {"status": "active", "schemaVersion": 999}

    # 8. Unparseable seats and condition that does not match
    doc_unparseable = MagicMock()
    doc_unparseable.id = "w_008"
    doc_unparseable.to_dict.return_value = {
        "schemaVersion": 1,
        "status": "active",
        "ownerId": "user_123",
        "query": {
            "trainNumber": "99999",
            "source": "ABC",
            "destination": "XYZ",
            "journeyDate": "2026-11-05",
            "travelClass": "SL",
            "quota": "GN",
        },
        "condition": {
            "kind": "rapid_rac_increase",
            "targetStatus": None,
            "maximumPosition": None,
        },
        "createdAt": now,
        "updatedAt": now,
    }
    doc_unparseable.reference = None  # test hasattr(ref, 'update') is False

    async def fake_get_all() -> list[MagicMock]:
        return [
            doc_seats_below,
            doc_threshold,
            doc_becomes_avl,
            doc_dup,
            doc_prev,
            doc_expired,
            doc_bad,
            doc_unparseable,
        ]

    mock_group.get = fake_get_all

    async def fake_fetch(q: TrainQuery) -> AvailabilityObservation:
        if q.train_number == "12661":
            return AvailabilityObservation.success(snap_avl)
        if q.train_number == "99999":
            return AvailabilityObservation.success(snap_avl_unparseable)
        if (
            q.train_number == "06030"
            and q.source == "RJPM"
            and doc_threshold.to_dict()["condition"]["kind"] == "reaches_threshold"
        ):
            return AvailabilityObservation.success(snap_rac)
        return AvailabilityObservation.success(snap_avl)

    mock_provider.fetch = fake_fetch

    dispatcher = FirestoreWatchDispatcher(
        mock_client,
        availability_provider=mock_provider,
        outbox=mock_outbox,
        notification_dispatcher=mock_notif_disp,
    )

    count = await dispatcher.dispatch_due_jobs(now=now)
    assert count == 8
    assert mock_outbox.save_notification.call_count >= 3
    assert mock_notif_disp.dispatch_pending.call_count == 1

    # Also test provider failure path
    mock_provider.fetch = AsyncMock(
        return_value=AvailabilityObservation.failed(ProviderFailure.TIMEOUT)
    )
    count_fail = await dispatcher.dispatch_due_jobs(now=now)
    assert count_fail == 8

    # Test empty docs branch (loop exit)
    mock_group.get = AsyncMock(return_value=[])
    count_empty = await dispatcher.dispatch_due_jobs(now=now)
    assert count_empty == 0

    # Test default staging wiring without looking up credentials.
    import trainwatch.infrastructure.firestore.client as fs_client_mod

    mock_create_client = MagicMock(return_value=mock_client)
    monkeypatch.setattr(fs_client_mod, "create_firestore_client", mock_create_client)
    app_default = create_app(
        AppSettings(
            app_env="staging",
            project_id="trainwatch",
            train_api_base_url="https://dreamdestiny.cloud.run",
        )
    )
    assert app_default.state.dispatcher_service is not None
    assert app_default.state.notification_dispatcher_service is not None
    mock_create_client.assert_called_once_with(
        project_id="trainwatch", database_id="(default)", allow_live_access=True
    )
