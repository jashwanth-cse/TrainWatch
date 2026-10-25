"""Port and domain types for notification outbox persistence."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Protocol

from trainwatch.domain.notifications import NotificationRecord


@dataclass(frozen=True, slots=True)
class NotificationOutboxItem:
    """An alert notification to be reliably delivered by Phase 8."""

    idempotency_key: str
    owner_id: str
    watch_id: str
    title: str
    body: str
    created_at: datetime
    data: dict[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        """Enforce non-empty idempotency key and user/watch IDs."""
        if not self.idempotency_key.strip():
            raise ValueError("idempotency_key must not be blank")
        if not self.owner_id.strip():
            raise ValueError("owner_id must not be blank")
        if not self.watch_id.strip():
            raise ValueError("watch_id must not be blank")


class NotificationOutbox(Protocol):
    """Reliable outbox ensuring notifications are stored idempotently."""

    async def save_notification(self, item: NotificationOutboxItem) -> bool:
        """Atomically persist notification; return False if idempotency key already exists."""
        ...

    async def get_by_key(self, idempotency_key: str) -> NotificationRecord | None:
        """Retrieve an outbox item by its idempotency key."""
        ...

    async def claim_pending_notifications(
        self,
        *,
        batch_size: int,
        lease_seconds: int,
        now: datetime,
    ) -> list[NotificationRecord]:
        """Claim a batch of pending/due notifications under lease."""
        ...

    async def mark_delivered(self, *, idempotency_key: str, sent_at: datetime) -> None:
        """Mark notification as delivered."""
        ...

    async def mark_failed(
        self,
        *,
        idempotency_key: str,
        error: str,
        retry_at: datetime | None,
        now: datetime,
    ) -> None:
        """Record delivery failure and schedule retry or mark terminal."""
        ...
