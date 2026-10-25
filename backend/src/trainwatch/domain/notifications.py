"""Domain types for device registration and notification records."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum


class DevicePlatform(StrEnum):
    """Supported client operating systems."""

    ANDROID = "android"
    IOS = "ios"
    WEB = "web"


@dataclass(frozen=True, slots=True)
class DeviceRecord:
    """A registered user device eligible to receive push notifications."""

    device_id: str
    user_id: str
    fcm_token: str
    platform: DevicePlatform
    active: bool
    created_at: datetime
    updated_at: datetime

    def __post_init__(self) -> None:
        """Validate non-empty identifiers and token."""
        if not self.device_id.strip():
            raise ValueError("device_id must not be blank")
        if not self.user_id.strip():
            raise ValueError("user_id must not be blank")
        if not self.fcm_token.strip():
            raise ValueError("fcm_token must not be blank")


class NotificationDeliveryStatus(StrEnum):
    """Lifecycle statuses for outbox notification items."""

    PENDING = "pending"
    DELIVERED = "delivered"
    FAILED = "failed"


@dataclass(frozen=True, slots=True)
class NotificationRecord:
    """A persistent record of a notification delivery attempt."""

    notification_id: str
    idempotency_key: str
    owner_id: str
    watch_id: str
    title: str
    body: str
    status: NotificationDeliveryStatus
    attempts: int
    created_at: datetime
    sent_at: datetime | None = None
    last_error: str | None = None
    lease_until: datetime | None = None
    data: dict[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        """Ensure non-empty mandatory IDs."""
        if not self.notification_id.strip():
            raise ValueError("notification_id must not be blank")
        if not self.idempotency_key.strip():
            raise ValueError("idempotency_key must not be blank")
        if not self.owner_id.strip():
            raise ValueError("owner_id must not be blank")
        if not self.watch_id.strip():
            raise ValueError("watch_id must not be blank")
        if self.attempts < 0:
            raise ValueError("attempts must be non-negative")
