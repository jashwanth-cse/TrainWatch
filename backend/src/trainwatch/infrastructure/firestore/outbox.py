"""Firestore implementation of notification outbox."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from trainwatch.domain.notifications import NotificationDeliveryStatus, NotificationRecord
from trainwatch.ports.notifications import NotificationOutboxItem


class FirestoreNotificationOutbox:
    """Stores outbox notifications under notificationOutbox/{idempotencyKey}."""

    def __init__(self, client: Any) -> None:
        """Initialize with an async Firestore client."""
        self._client = client

    def _collection(self) -> Any:
        """Select the top-level notification outbox collection."""
        return self._client.collection("notificationOutbox")

    async def save_notification(self, item: NotificationOutboxItem) -> bool:
        """Persist outbox item idempotently; return False if already exists."""
        doc_ref = self._collection().document(item.idempotency_key)
        snapshot = await doc_ref.get()
        if snapshot.exists:
            return False

        data: dict[str, Any] = {
            "notificationId": item.idempotency_key,
            "idempotencyKey": item.idempotency_key,
            "ownerId": item.owner_id,
            "watchId": item.watch_id,
            "title": item.title,
            "body": item.body,
            "status": NotificationDeliveryStatus.PENDING.value,
            "attempts": 0,
            "createdAt": item.created_at.isoformat(),
            "sentAt": None,
            "lastError": None,
            "leaseUntil": None,
            "data": item.data,
        }
        await doc_ref.set(data)
        return True

    async def get_by_key(self, idempotency_key: str) -> NotificationRecord | None:
        """Retrieve an outbox item by its idempotency key."""
        doc_ref = self._collection().document(idempotency_key)
        snapshot = await doc_ref.get()
        if not snapshot.exists:
            return None
        d = snapshot.to_dict()
        if not d:
            return None
        return self._record_from_dict(d)

    async def claim_pending_notifications(
        self,
        *,
        batch_size: int,
        lease_seconds: int,
        now: datetime,
    ) -> list[NotificationRecord]:
        """Claim a batch of pending notifications under lease."""
        docs = await self._collection().get()
        claimed: list[NotificationRecord] = []
        for doc in docs:
            if len(claimed) >= batch_size:
                break
            d = doc.to_dict()
            if not d:
                continue

            status = NotificationDeliveryStatus(str(d.get("status", "pending")))
            if status is not NotificationDeliveryStatus.PENDING:
                continue

            lease_str = d.get("leaseUntil")
            if lease_str is not None:
                lease_dt = datetime.fromisoformat(str(lease_str))
                if lease_dt > now:
                    continue

            # Claim document
            lease_until = now + timedelta(seconds=lease_seconds)
            attempts = int(str(d.get("attempts", 0))) + 1
            d["leaseUntil"] = lease_until.isoformat()
            d["attempts"] = attempts
            await self._collection().document(doc.id).set(d)

            claimed.append(self._record_from_dict(d))
        return claimed

    async def mark_delivered(self, *, idempotency_key: str, sent_at: datetime) -> None:
        """Mark notification as delivered."""
        doc_ref = self._collection().document(idempotency_key)
        snapshot = await doc_ref.get()
        if snapshot.exists:
            d = snapshot.to_dict() or {}
            d["status"] = NotificationDeliveryStatus.DELIVERED.value
            d["sentAt"] = sent_at.isoformat()
            d["leaseUntil"] = None
            await doc_ref.set(d)

    async def mark_failed(
        self,
        *,
        idempotency_key: str,
        error: str,
        retry_at: datetime | None,
        now: datetime,
    ) -> None:
        """Record delivery failure and schedule retry or mark permanently failed."""
        doc_ref = self._collection().document(idempotency_key)
        snapshot = await doc_ref.get()
        if snapshot.exists:
            d = snapshot.to_dict() or {}
            if retry_at is None:
                d["status"] = NotificationDeliveryStatus.FAILED.value
                d["leaseUntil"] = None
            else:
                d["leaseUntil"] = retry_at.isoformat()
            d["lastError"] = error
            await doc_ref.set(d)

    def _record_from_dict(self, d: dict[str, Any]) -> NotificationRecord:
        """Deserialize stored outbox fields into a notification record."""
        return NotificationRecord(
            notification_id=str(d.get("notificationId", d.get("idempotencyKey"))),
            idempotency_key=str(d.get("idempotencyKey")),
            owner_id=str(d.get("ownerId")),
            watch_id=str(d.get("watchId")),
            title=str(d.get("title")),
            body=str(d.get("body")),
            status=NotificationDeliveryStatus(str(d.get("status", "pending"))),
            attempts=int(d.get("attempts", 0)),
            created_at=datetime.fromisoformat(str(d["createdAt"])),
            sent_at=datetime.fromisoformat(str(d["sentAt"])) if d.get("sentAt") else None,
            last_error=str(d["lastError"]) if d.get("lastError") else None,
            lease_until=(
                datetime.fromisoformat(str(d["leaseUntil"])) if d.get("leaseUntil") else None
            ),
            data=dict(d.get("data", {})),
        )
