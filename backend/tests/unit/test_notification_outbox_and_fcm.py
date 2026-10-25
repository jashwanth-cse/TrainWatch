"""Unit tests for Phase 8 notification outbox, FCM sender, and device endpoints."""

from __future__ import annotations

import sys
from datetime import UTC, datetime, timedelta
from typing import Any, cast
from unittest.mock import MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from trainwatch.config import AppSettings
from trainwatch.domain.notifications import (
    DevicePlatform,
    DeviceRecord,
    NotificationDeliveryStatus,
    NotificationRecord,
)
from trainwatch.infrastructure.fcm.sender import FakeFcmSender, FirebaseFcmSender
from trainwatch.infrastructure.firestore.devices import FirestoreDeviceRepository
from trainwatch.infrastructure.firestore.outbox import FirestoreNotificationOutbox
from trainwatch.main import create_app
from trainwatch.ports.identity import AuthenticatedUser
from trainwatch.ports.notifications import NotificationOutboxItem
from trainwatch.services.notification_dispatcher import (
    NotificationDispatcherService,
)


class MockDocRef:
    def __init__(self, doc_id: str, store: dict[str, Any]):
        self.id = doc_id
        self._store = store

    async def get(self) -> Any:
        data = self._store.get(self.id)
        exists = data is not None
        mock = MagicMock()
        mock.exists = exists
        mock.to_dict.return_value = data
        mock.id = self.id
        return mock

    async def set(self, data: dict[str, Any]) -> None:
        self._store[self.id] = dict(data)

    async def delete(self) -> None:
        self._store.pop(self.id, None)

    def collection(self, name: str) -> Any:
        return MockCollectionRef(name, self._store)


class MockCollectionRef:
    def __init__(self, name: str, root_store: dict[str, Any]):
        self.name = name
        self._root_store = root_store

    def document(self, doc_id: str) -> MockDocRef:
        sub = self._root_store.setdefault(f"{self.name}__docs", {})
        return MockDocRef(doc_id, sub)

    async def get(self) -> list[Any]:
        sub = self._root_store.get(f"{self.name}__docs", {})
        docs = []
        for k, v in sub.items():
            mock = MagicMock()
            mock.exists = True
            mock.id = k
            mock.to_dict.return_value = v
            docs.append(mock)
        return docs


class MockFirestoreClient:
    def __init__(self) -> None:
        self._store: dict[str, Any] = {}

    def collection(self, name: str) -> MockCollectionRef:
        return MockCollectionRef(name, self._store)


class MockTokenVerifier:
    def __init__(self, user: AuthenticatedUser) -> None:
        self.user = user

    async def verify(self, bearer_value: str) -> AuthenticatedUser:
        if bearer_value == "invalid":
            from trainwatch.ports.identity import TokenVerificationError

            raise TokenVerificationError
        return self.user


# --- 1. Domain Validation Tests ---


def test_device_record_validation() -> None:
    now = datetime.now(UTC)
    dev = DeviceRecord(
        device_id="dev-123",
        user_id="user-123",
        fcm_token="placeholder",
        platform=DevicePlatform.ANDROID,
        active=True,
        created_at=now,
        updated_at=now,
    )
    assert dev.device_id == "dev-123"
    assert dev.platform is DevicePlatform.ANDROID

    with pytest.raises(ValueError, match="device_id must not be blank"):
        DeviceRecord(
            device_id="   ",
            user_id="user-123",
            fcm_token="placeholder",
            platform=DevicePlatform.ANDROID,
            active=True,
            created_at=now,
            updated_at=now,
        )

    with pytest.raises(ValueError, match="user_id must not be blank"):
        DeviceRecord(
            device_id="dev",
            user_id="",
            fcm_token="placeholder",
            platform=DevicePlatform.ANDROID,
            active=True,
            created_at=now,
            updated_at=now,
        )

    with pytest.raises(ValueError, match="fcm_token must not be blank"):
        DeviceRecord(
            device_id="dev",
            user_id="user",
            fcm_token="",
            platform=DevicePlatform.ANDROID,
            active=True,
            created_at=now,
            updated_at=now,
        )


def test_notification_record_validation() -> None:
    now = datetime.now(UTC)
    item = NotificationRecord(
        notification_id="notif-1",
        idempotency_key="idem-1",
        owner_id="user-1",
        watch_id="watch-1",
        title="Alert",
        body="Seats available",
        status=NotificationDeliveryStatus.PENDING,
        attempts=0,
        created_at=now,
    )
    assert item.status is NotificationDeliveryStatus.PENDING

    with pytest.raises(ValueError, match="notification_id must not be blank"):
        NotificationRecord(
            notification_id="",
            idempotency_key="key",
            owner_id="u",
            watch_id="w",
            title="t",
            body="b",
            status=NotificationDeliveryStatus.PENDING,
            attempts=0,
            created_at=now,
        )

    with pytest.raises(ValueError, match="idempotency_key must not be blank"):
        NotificationRecord(
            notification_id="id",
            idempotency_key=" ",
            owner_id="u",
            watch_id="w",
            title="t",
            body="b",
            status=NotificationDeliveryStatus.PENDING,
            attempts=0,
            created_at=now,
        )

    with pytest.raises(ValueError, match="owner_id must not be blank"):
        NotificationRecord(
            notification_id="id",
            idempotency_key="key",
            owner_id="",
            watch_id="w",
            title="t",
            body="b",
            status=NotificationDeliveryStatus.PENDING,
            attempts=0,
            created_at=now,
        )

    with pytest.raises(ValueError, match="watch_id must not be blank"):
        NotificationRecord(
            notification_id="id",
            idempotency_key="key",
            owner_id="u",
            watch_id="",
            title="t",
            body="b",
            status=NotificationDeliveryStatus.PENDING,
            attempts=0,
            created_at=now,
        )

    with pytest.raises(ValueError, match="attempts must be non-negative"):
        NotificationRecord(
            notification_id="id",
            idempotency_key="key",
            owner_id="u",
            watch_id="w",
            title="t",
            body="b",
            status=NotificationDeliveryStatus.PENDING,
            attempts=-1,
            created_at=now,
        )


# --- 2. Firestore Device Repository Tests ---


@pytest.mark.anyio
async def test_firestore_device_repository() -> None:
    mock_client = MockFirestoreClient()
    repo = FirestoreDeviceRepository(cast(Any, mock_client))
    now = datetime.now(UTC)

    # Register active device
    device = DeviceRecord(
        device_id="phone-1",
        user_id="user-42",
        fcm_token="placeholder",
        platform=DevicePlatform.ANDROID,
        active=True,
        created_at=now,
        updated_at=now,
    )
    await repo.register_device(device)

    # Register inactive device (should be filtered out by get_user_devices)
    device_inactive = DeviceRecord(
        device_id="phone-inactive",
        user_id="user-42",
        fcm_token="replace_me",
        platform=DevicePlatform.IOS,
        active=False,
        created_at=now,
        updated_at=now,
    )
    await repo.register_device(device_inactive)

    # Query active devices
    devices = await repo.get_user_devices("user-42")
    assert len(devices) == 1
    assert devices[0].device_id == "phone-1"
    assert devices[0].fcm_token == "placeholder"

    # Revoke device
    revoked = await repo.revoke_device("user-42", "phone-1")
    assert revoked is True

    # Revoke non-existent
    not_found = await repo.revoke_device("user-42", "non-existent")
    assert not_found is False

    # Deactivate token stub
    count = await repo.deactivate_token("token-42")
    assert count == 0


# --- 3. Firestore Notification Outbox Tests ---


@pytest.mark.anyio
async def test_firestore_notification_outbox() -> None:
    mock_client = MockFirestoreClient()
    outbox = FirestoreNotificationOutbox(cast(Any, mock_client))
    now = datetime.now(UTC)

    item = NotificationOutboxItem(
        idempotency_key="alert:w1:AVL:0",
        owner_id="u1",
        watch_id="w1",
        title="Seat Available",
        body="Train 12345 has seats",
        created_at=now,
        data={"train": "12345"},
    )

    # Initial save succeeds
    saved = await outbox.save_notification(item)
    assert saved is True

    # Duplicate save is idempotent and returns False
    saved_again = await outbox.save_notification(item)
    assert saved_again is False

    # Retrieve by key
    rec = await outbox.get_by_key("alert:w1:AVL:0")
    assert rec is not None
    assert rec.status is NotificationDeliveryStatus.PENDING
    assert rec.data["train"] == "12345"

    # Retrieve non-existent
    missing = await outbox.get_by_key("non-existent-key")
    assert missing is None

    # Claim pending with active lease
    claimed = await outbox.claim_pending_notifications(
        batch_size=10,
        lease_seconds=60,
        now=now,
    )
    assert len(claimed) == 1
    assert claimed[0].attempts == 1

    # Claim again while lease is still active: should be skipped
    claimed_again = await outbox.claim_pending_notifications(
        batch_size=10,
        lease_seconds=60,
        now=now + timedelta(seconds=10),
    )
    assert len(claimed_again) == 0

    # Claim again after lease expired: should be successfully reclaimed
    reclaimed = await outbox.claim_pending_notifications(
        batch_size=10,
        lease_seconds=60,
        now=now + timedelta(seconds=70),
    )
    assert len(reclaimed) == 1
    assert reclaimed[0].attempts == 2

    # Batch size limit break test
    rec2 = NotificationOutboxItem(
        idempotency_key="alert:w1:AVL:1",
        owner_id="u1",
        watch_id="w1",
        title="Title 2",
        body="Body 2",
        data={"train": "12345"},
        created_at=now,
    )
    await outbox.save_notification(rec2)
    claimed_batch_limited = await outbox.claim_pending_notifications(
        batch_size=1,
        lease_seconds=60,
        now=now + timedelta(seconds=200),
    )
    assert len(claimed_batch_limited) == 1

    # Empty document mock
    empty_doc_mock = MagicMock()
    empty_doc_mock.exists = True
    empty_doc_mock.to_dict.return_value = None
    with patch.object(MockDocRef, "get", return_value=empty_doc_mock):
        assert await outbox.get_by_key("some_key") is None
    with patch.object(MockCollectionRef, "get", return_value=[empty_doc_mock]):
        res = await outbox.claim_pending_notifications(batch_size=1, lease_seconds=60, now=now)
        assert len(res) == 0

    # Mark delivered
    await outbox.mark_delivered(
        idempotency_key="alert:w1:AVL:0",
        sent_at=now,
    )
    await outbox.mark_delivered(
        idempotency_key="alert:w1:AVL:1",
        sent_at=now,
    )
    after_delivered = await outbox.get_by_key("alert:w1:AVL:0")
    assert after_delivered is not None
    assert after_delivered.status is NotificationDeliveryStatus.DELIVERED

    # Claim after delivered: should not claim delivered status
    claimed_delivered = await outbox.claim_pending_notifications(
        batch_size=10,
        lease_seconds=60,
        now=now + timedelta(minutes=10),
    )
    assert len(claimed_delivered) == 0

    # Mark failed with retry_at
    await outbox.mark_failed(
        idempotency_key="alert:w1:AVL:0",
        error="test_error",
        retry_at=now + timedelta(seconds=30),
        now=now,
    )
    retrying = await outbox.get_by_key("alert:w1:AVL:0")
    assert retrying is not None
    assert retrying.last_error == "test_error"

    # Mark terminal failure (retry_at=None)
    await outbox.mark_failed(
        idempotency_key="alert:w1:AVL:0",
        error="fatal_error",
        retry_at=None,
        now=now,
    )
    failed = await outbox.get_by_key("alert:w1:AVL:0")
    assert failed is not None
    assert failed.status is NotificationDeliveryStatus.FAILED

    # Mark delivered and mark failed on non-existent document do not crash
    await outbox.mark_delivered(idempotency_key="missing", sent_at=now)
    await outbox.mark_failed(idempotency_key="missing", error="err", retry_at=None, now=now)


# --- 4. FCM Senders Tests ---


@pytest.mark.anyio
async def test_fake_fcm_sender() -> None:
    sender = FakeFcmSender()
    sender.invalid_tokens.add("bad-token")

    res = await sender.send_multicast(
        tokens=["good-token-1", "bad-token", "good-token-2"],
        title="Alert",
        body="Available",
        data={"route": "NDLS-CNB"},
    )
    assert res.success_count == 2
    assert res.failure_count == 1
    assert res.unregistered_tokens == ["bad-token"]
    assert res.is_partial_or_total_success is True
    assert len(sender.sent_messages) == 1

    sender.simulate_failure = True
    with pytest.raises(RuntimeError, match="simulated_fcm_network_failure"):
        await sender.send_multicast(
            tokens=["good-token-1"],
            title="Alert",
            body="Available",
            data={},
        )


@pytest.mark.anyio
async def test_firebase_fcm_sender_empty_tokens() -> None:
    sender = FirebaseFcmSender(app=None)
    res = await sender.send_multicast(tokens=[], title="t", body="b", data={})
    assert res.success_count == 0
    assert res.failure_count == 0


@pytest.mark.anyio
async def test_firebase_fcm_sender_success_and_error() -> None:
    sender = FirebaseFcmSender(app=None)

    # 1. Success mock
    mock_resp = MagicMock()
    mock_resp.success_count = 1
    mock_resp.failure_count = 0
    mock_resp.responses = [MagicMock(success=True)]

    mock_messaging = MagicMock()
    mock_messaging.send_each_for_multicast.return_value = mock_resp
    mock_firebase_admin = MagicMock(messaging=mock_messaging)

    fcm_modules = {
        "firebase_admin": mock_firebase_admin,
        "firebase_admin.messaging": mock_messaging,
    }

    with patch.dict(sys.modules, fcm_modules):
        res = await sender.send_multicast(
            tokens=["valid_token"],
            title="Title",
            body="Body",
            data={"k": "v"},
        )
        assert res.success_count == 1
        assert res.failure_count == 0

    # 2. Failure mock with unregistered token and generic error token
    mock_resp_fail = MagicMock()
    mock_resp_fail.success_count = 0
    mock_resp_fail.failure_count = 2
    bad_res = MagicMock(success=False)
    bad_res.exception = MagicMock(code="messaging/registration-token-not-registered")
    generic_bad_res = MagicMock(success=False)
    generic_bad_res.exception = MagicMock(code="messaging/internal-error")
    mock_resp_fail.responses = [bad_res, generic_bad_res]
    mock_messaging.send_each_for_multicast.return_value = mock_resp_fail

    with patch.dict(sys.modules, fcm_modules):
        res_fail = await sender.send_multicast(
            tokens=["invalid_token", "error_token"],
            title="Title",
            body="Body",
            data={},
        )
        assert res_fail.success_count == 0
        assert res_fail.failure_count == 2
        assert res_fail.unregistered_tokens == ["invalid_token"]

    # 3. Exception raised
    mock_messaging.send_each_for_multicast.side_effect = RuntimeError("network_down")
    with (
        patch.dict(sys.modules, fcm_modules),
        pytest.raises(RuntimeError, match="FCM delivery error"),
    ):
        await sender.send_multicast(
            tokens=["valid_token"],
            title="Title",
            body="Body",
            data={},
        )


# --- 5. Notification Dispatcher Service Tests ---


@pytest.mark.anyio
async def test_notification_dispatcher_service_flow() -> None:
    mock_client = MockFirestoreClient()
    outbox = FirestoreNotificationOutbox(cast(Any, mock_client))
    device_repo = FirestoreDeviceRepository(cast(Any, mock_client))
    fcm_sender = FakeFcmSender()
    dispatcher = NotificationDispatcherService(
        outbox=outbox,
        device_repository=device_repo,
        fcm_sender=fcm_sender,
        max_attempts=3,
    )
    now = datetime.now(UTC)

    # 1. Dispatch with zero notifications in outbox
    empty_res = await dispatcher.dispatch_pending(now=now)
    assert empty_res.claimed_count == 0

    # 2. Add notification for user with no registered devices
    item_no_dev = NotificationOutboxItem(
        idempotency_key="alert:no_dev",
        owner_id="user_no_dev",
        watch_id="w1",
        title="Title",
        body="Body",
        created_at=now,
    )
    await outbox.save_notification(item_no_dev)

    # Dispatch: user has no devices -> marks delivered (no-op)
    res1 = await dispatcher.dispatch_pending(now=now)
    assert res1.claimed_count == 1
    assert res1.delivered_count == 1

    # 3. Add device for user_dev and create notification
    device = DeviceRecord(
        device_id="dev-phone",
        user_id="user_dev",
        fcm_token="placeholder",
        platform=DevicePlatform.ANDROID,
        active=True,
        created_at=now,
        updated_at=now,
    )
    await device_repo.register_device(device)

    item_with_dev = NotificationOutboxItem(
        idempotency_key="alert:with_dev",
        owner_id="user_dev",
        watch_id="w2",
        title="Seat Cleared",
        body="RAC to Available",
        created_at=now,
        data={"train": "12451"},
    )
    await outbox.save_notification(item_with_dev)

    # Dispatch: sends push via FakeFcmSender and marks delivered
    res2 = await dispatcher.dispatch_pending(now=now)
    assert res2.claimed_count == 1
    assert res2.delivered_count == 1
    assert len(fcm_sender.sent_messages) == 1
    assert fcm_sender.sent_messages[0]["tokens"] == ["placeholder"]

    # 4. Already delivered record returns 'delivered' immediately
    rec = await outbox.get_by_key("alert:with_dev")
    assert rec is not None
    single_res = await dispatcher.process_single(record=rec, now=now)
    assert single_res == "delivered"

    # 5. FCM exception handling and retry scheduling
    fcm_sender.simulate_failure = True
    item_fail = NotificationOutboxItem(
        idempotency_key="alert:failure",
        owner_id="user_dev",
        watch_id="w3",
        title="Fail",
        body="Test Fail",
        created_at=now,
    )
    await outbox.save_notification(item_fail)

    res3 = await dispatcher.dispatch_pending(now=now)
    assert res3.claimed_count == 1
    assert res3.retry_scheduled_count == 1

    # Dispatch with max_attempts=1 triggers failed_count in dispatch_pending loop
    dispatcher_terminal = NotificationDispatcherService(
        outbox=outbox,
        device_repository=device_repo,
        fcm_sender=fcm_sender,
        max_attempts=1,
    )
    item_term = NotificationOutboxItem(
        idempotency_key="alert:term",
        owner_id="user_dev",
        watch_id="w_term",
        title="Terminal",
        body="Body",
        created_at=now,
    )
    await outbox.save_notification(item_term)
    res_term = await dispatcher_terminal.dispatch_pending(now=now)
    assert res_term.failed_count == 1

    # Exhaust max attempts
    rec_fail = await outbox.get_by_key("alert:failure")
    assert rec_fail is not None
    # Simulate attempt 3 of 3
    rec_max = NotificationRecord(
        notification_id=rec_fail.notification_id,
        idempotency_key=rec_fail.idempotency_key,
        owner_id=rec_fail.owner_id,
        watch_id=rec_fail.watch_id,
        title=rec_fail.title,
        body=rec_fail.body,
        status=rec_fail.status,
        attempts=3,
        created_at=rec_fail.created_at,
    )
    exhausted_res = await dispatcher.process_single(record=rec_max, now=now)
    assert exhausted_res == "failed"

    # 6. All tokens rejected without exception (e.g. invalid tokens)
    fcm_sender.simulate_failure = False
    fcm_sender.invalid_tokens.add("placeholder")

    item_rejected = NotificationOutboxItem(
        idempotency_key="alert:rejected",
        owner_id="user_dev",
        watch_id="w4",
        title="Rejected",
        body="Bad token",
        created_at=now,
    )
    await outbox.save_notification(item_rejected)

    rec_rej = await outbox.get_by_key("alert:rejected")
    assert rec_rej is not None
    # Attempt 1 -> retry
    retry_rej = await dispatcher.process_single(record=rec_rej, now=now)
    assert retry_rej == "retry"

    # Attempt max -> failed
    rec_rej_max = NotificationRecord(
        notification_id=rec_rej.notification_id,
        idempotency_key=rec_rej.idempotency_key,
        owner_id=rec_rej.owner_id,
        watch_id=rec_rej.watch_id,
        title=rec_rej.title,
        body=rec_rej.body,
        status=rec_rej.status,
        attempts=3,
        created_at=rec_rej.created_at,
    )
    fail_rej = await dispatcher.process_single(record=rec_rej_max, now=now)
    assert fail_rej == "failed"


# --- 6. Device API Endpoints Tests ---


@pytest.mark.anyio
async def test_device_api_endpoints() -> None:
    mock_client = MockFirestoreClient()
    device_repo = FirestoreDeviceRepository(cast(Any, mock_client))
    user = AuthenticatedUser(uid="user_api_123")
    verifier = MockTokenVerifier(user)

    app = create_app(
        settings=AppSettings(app_env="test"),
        token_verifier=verifier,
        device_repository=device_repo,
    )

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        # 1. Register device
        put_res = await client.put(
            "/api/v1/devices/my-phone-id",
            headers={"Authorization": "Bearer token_valid"},
            json={"fcm_token": "placeholder", "platform": "android"},
        )
        assert put_res.status_code == 200
        data = put_res.json()
        assert data["status"] == "registered"
        assert data["device_id"] == "my-phone-id"

        # 2. Register invalid device ID
        invalid_id_res = await client.put(
            "/api/v1/devices/invalid@id!",
            headers={"Authorization": "Bearer token_valid"},
            json={"fcm_token": "placeholder", "platform": "android"},
        )
        assert invalid_id_res.status_code == 400

        # 3. Revoke device
        del_res = await client.delete(
            "/api/v1/devices/my-phone-id",
            headers={"Authorization": "Bearer token_valid"},
        )
        assert del_res.status_code == 200
        assert del_res.json()["status"] == "revoked"

        # 4. Revoke again returns 404
        del_again = await client.delete(
            "/api/v1/devices/my-phone-id",
            headers={"Authorization": "Bearer token_valid"},
        )
        assert del_again.status_code == 404

        # 5. Revoke invalid device ID returns 400
        del_invalid = await client.delete(
            "/api/v1/devices/invalid@id!",
            headers={"Authorization": "Bearer token_valid"},
        )
        assert del_invalid.status_code == 400


@pytest.mark.anyio
async def test_device_api_unconfigured_repository() -> None:
    user = AuthenticatedUser(uid="user_api_123")
    verifier = MockTokenVerifier(user)
    app = create_app(
        settings=AppSettings(app_env="test"),
        token_verifier=verifier,
        device_repository=None,
    )

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        res = await client.put(
            "/api/v1/devices/phone-1",
            headers={"Authorization": "Bearer valid"},
            json={"fcm_token": "placeholder", "platform": "android"},
        )
        assert res.status_code == 503
        data = res.json()
        assert data["error"]["code"] == "service_unavailable"


# --- 7. Internal Notification Dispatch Endpoint Tests ---


@pytest.mark.anyio
async def test_internal_notification_process_endpoint() -> None:
    mock_client = MockFirestoreClient()
    outbox = FirestoreNotificationOutbox(cast(Any, mock_client))
    device_repo = FirestoreDeviceRepository(cast(Any, mock_client))
    fcm_sender = FakeFcmSender()
    dispatcher = NotificationDispatcherService(
        outbox=outbox,
        device_repository=device_repo,
        fcm_sender=fcm_sender,
    )

    app = create_app(
        settings=AppSettings(app_env="test"),
        notification_dispatcher_service=dispatcher,
    )

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        # Trigger notification processing
        res = await client.post(
            "/api/v1/internal/notifications/process",
            json={"batch_size": 20, "lease_seconds": 60},
        )
        assert res.status_code == 200
        data = res.json()
        assert "claimed" in data
        assert "delivered" in data
        assert "failed" in data


@pytest.mark.anyio
async def test_internal_notification_unconfigured_service() -> None:
    app = create_app(
        settings=AppSettings(app_env="test"),
        notification_dispatcher_service=None,
    )

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        res = await client.post(
            "/api/v1/internal/notifications/process",
            json={"batch_size": 20, "lease_seconds": 60},
        )
        assert res.status_code == 503
        data = res.json()
        assert data["error"]["code"] == "service_unavailable"
