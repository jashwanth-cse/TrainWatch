"""In-process tests for the credential-free application factory."""

from unittest.mock import AsyncMock, MagicMock

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
        doc1.to_dict.return_value = {"status": "active", "createdAt": datetime.now(UTC)}
        doc2 = MagicMock()
        doc2.to_dict.return_value = {"status": "paused", "createdAt": datetime.now(UTC)}
        return [doc1, doc2]

    mock_group.get = fake_get
    mock_client.collection_group.return_value = mock_group
    mock_group.where.return_value = mock_group
    mock_group.order_by.return_value = mock_group
    mock_group.limit.return_value = mock_group
    cursor_ref = mock_client.collection.return_value.document.return_value
    cursor_ref.get = AsyncMock(return_value=MagicMock(to_dict=lambda: {}))
    cursor_ref.set = AsyncMock()

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
    mock_group.where.return_value = mock_group
    mock_group.order_by.return_value = mock_group
    mock_group.limit.return_value = mock_group
    cursor_ref = mock_client.collection.return_value.document.return_value
    cursor_ref.get = AsyncMock(return_value=MagicMock(to_dict=lambda: {}))
    cursor_ref.set = AsyncMock()

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
    snap_avl_unparseable = AvailabilitySnapshot(
        status=AvailabilityStatus.AVAILABLE,
        raw_availability="NO_DIGITS",
        observed_at=now,
        position=None,
    )

    # 1. Active doc with seats_below met (first check, no previous -> triggers threshold alert)
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

    # 2. Legacy RAC watch -> auto-dissolved with zero API calls
    doc_legacy = MagicMock()
    doc_legacy.id = "w_002"
    doc_legacy.to_dict.return_value = {
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
    doc_legacy.reference.update = AsyncMock()

    # 3. Active doc inferring owner_id from parent document ref with decreasing AVL
    doc_parent_owner = MagicMock()
    doc_parent_owner.id = "w_003"
    parent_doc = MagicMock()
    parent_doc.id = "user_parent"
    parent_col = MagicMock()
    parent_col.parent = parent_doc
    doc_parent_owner.reference.parent = parent_col
    doc_parent_owner.to_dict.return_value = {
        "schemaVersion": 1,
        "status": "active",
        "lastAvlCount": 140,
        "query": {
            "trainNumber": "12661",
            "source": "MS",
            "destination": "TEN",
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
    doc_parent_owner.reference.update = AsyncMock()

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
        "lastAlertedKey": "alert:w_004:baseline:AVAILABLE:120",
        "createdAt": now,
        "updatedAt": now,
    }
    doc_dup.reference.update = AsyncMock()

    # 5. Doc with previous observation where seats decrease further
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
            "rawAvailability": "AVAILABLE 145",
            "position": None,
            "observedAt": now.isoformat(),
        },
        "createdAt": now,
        "updatedAt": now,
    }
    doc_prev.reference.update = AsyncMock()

    # 6. Expired doc -> auto-dissolved in Firestore with isActive=False
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
            "departureTime": "20:00",
        },
        "condition": {
            "kind": "seats_below",
            "maximumPosition": 160,
        },
        "createdAt": now,
        "updatedAt": now,
    }
    doc_expired.reference.update = AsyncMock()

    # 7. Malformed / decoding error doc
    doc_bad = MagicMock()
    doc_bad.id = "w_007"
    doc_bad.to_dict.return_value = {"status": "active", "schemaVersion": 999}

    # 8. Unparseable seats doc without update method
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
            "kind": "seats_below",
            "targetStatus": None,
            "maximumPosition": 10,
        },
        "createdAt": now,
        "updatedAt": now,
    }
    doc_unparseable.reference = MagicMock(spec=["path"])  # no update method

    # 9. Expired doc without update method (covers branch cleanly)
    doc_expired_no_ref = MagicMock()
    doc_expired_no_ref.id = "w_009"
    doc_expired_no_ref.to_dict.return_value = {
        "schemaVersion": 1,
        "status": "active",
        "ownerId": "user_123",
        "query": {
            "trainNumber": "06031",
            "source": "RJPM",
            "destination": "CNV",
            "journeyDate": "2026-10-01",
            "travelClass": "SL",
            "quota": "GN",
        },
        "condition": {"kind": "seats_below", "maximumPosition": 10},
        "createdAt": now,
        "updatedAt": now,
    }
    doc_expired_no_ref.reference = MagicMock(spec=["path"])

    async def fake_get_all() -> list[MagicMock]:
        return [
            doc_seats_below,
            doc_legacy,
            doc_parent_owner,
            doc_dup,
            doc_prev,
            doc_expired,
            doc_bad,
            doc_unparseable,
            doc_expired_no_ref,
        ]

    mock_group.get = fake_get_all

    fetched_trains: list[str] = []

    async def fake_fetch(q: TrainQuery) -> AvailabilityObservation:
        fetched_trains.append(q.train_number)
        if q.train_number == "99999":
            return AvailabilityObservation.success(snap_avl_unparseable)
        return AvailabilityObservation.success(snap_avl)

    mock_provider.fetch = fake_fetch

    dispatcher = FirestoreWatchDispatcher(
        mock_client,
        availability_provider=mock_provider,
        outbox=mock_outbox,
        notification_dispatcher=mock_notif_disp,
    )

    count = await dispatcher.dispatch_due_jobs(now=now)
    assert count == 9
    assert mock_outbox.save_notification.call_count == 3
    assert mock_notif_disp.dispatch_pending.call_count == 1
    # Departed and legacy watches never queried train API
    assert "06031" not in fetched_trains
    doc_expired.reference.update.assert_awaited_once()
    expired_payload = doc_expired.reference.update.call_args.args[0]
    assert expired_payload["status"] == "expired"
    assert expired_payload["isActive"] is False
    assert expired_payload["expiredReason"] == "train_departed"
    doc_legacy.reference.update.assert_awaited_once()
    assert doc_legacy.reference.update.call_args.args[0]["expiredReason"] == "avl_only_policy"

    # Also test provider failure path
    mock_provider.fetch = AsyncMock(
        return_value=AvailabilityObservation.failed(ProviderFailure.TIMEOUT)
    )
    count_fail = await dispatcher.dispatch_due_jobs(now=now)
    assert count_fail == 9

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
