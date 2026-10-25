"""Notification outbox dispatcher service."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from trainwatch.domain.notifications import NotificationDeliveryStatus, NotificationRecord
from trainwatch.ports.devices import DeviceRepository
from trainwatch.ports.fcm import FcmSender
from trainwatch.ports.notifications import NotificationOutbox


@dataclass(frozen=True, slots=True)
class DispatchBatchResult:
    """Outcome of processing an outbox batch."""

    claimed_count: int
    delivered_count: int
    failed_count: int
    retry_scheduled_count: int


class NotificationDispatcherService:
    """Processes pending outbox items and dispatches via FCM."""

    def __init__(
        self,
        *,
        outbox: NotificationOutbox,
        device_repository: DeviceRepository,
        fcm_sender: FcmSender,
        max_attempts: int = 5,
    ) -> None:
        """Initialize with dependencies."""
        self.outbox = outbox
        self.device_repository = device_repository
        self.fcm_sender = fcm_sender
        self.max_attempts = max_attempts

    async def dispatch_pending(
        self,
        *,
        batch_size: int = 20,
        lease_seconds: int = 60,
        now: datetime | None = None,
    ) -> DispatchBatchResult:
        """Claim and deliver pending notifications."""
        current_time = now or datetime.now(UTC)
        claimed = await self.outbox.claim_pending_notifications(
            batch_size=batch_size,
            lease_seconds=lease_seconds,
            now=current_time,
        )

        delivered = 0
        failed = 0
        retry_scheduled = 0

        for item in claimed:
            result = await self.process_single(record=item, now=current_time)
            if result == "delivered":
                delivered += 1
            elif result == "failed":
                failed += 1
            else:
                retry_scheduled += 1

        return DispatchBatchResult(
            claimed_count=len(claimed),
            delivered_count=delivered,
            failed_count=failed,
            retry_scheduled_count=retry_scheduled,
        )

    async def process_single(
        self,
        *,
        record: NotificationRecord,
        now: datetime,
    ) -> str:
        """Process one notification record; return 'delivered', 'failed', or 'retry'."""
        if record.status is NotificationDeliveryStatus.DELIVERED:
            return "delivered"

        devices = await self.device_repository.get_user_devices(record.owner_id)
        active_tokens = [d.fcm_token for d in devices if d.active and d.fcm_token]

        if not active_tokens:
            # If user has no registered active devices, mark delivered (no-op recipient)
            await self.outbox.mark_delivered(
                idempotency_key=record.idempotency_key,
                sent_at=now,
            )
            return "delivered"

        try:
            res = await self.fcm_sender.send_multicast(
                tokens=active_tokens,
                title=record.title,
                body=record.body,
                data=record.data,
            )
        except Exception as err:
            if record.attempts >= self.max_attempts:
                await self.outbox.mark_failed(
                    idempotency_key=record.idempotency_key,
                    error=str(err),
                    retry_at=None,
                    now=now,
                )
                return "failed"

            backoff_secs = min(300, 30 * (2 ** (record.attempts - 1)))
            retry_at = now + timedelta(seconds=backoff_secs)
            await self.outbox.mark_failed(
                idempotency_key=record.idempotency_key,
                error=str(err),
                retry_at=retry_at,
                now=now,
            )
            return "retry"

        # Cleanup invalid tokens if any
        for invalid_token in res.unregistered_tokens:
            await self.device_repository.deactivate_token(invalid_token)

        if res.is_partial_or_total_success or res.failure_count == 0:
            await self.outbox.mark_delivered(
                idempotency_key=record.idempotency_key,
                sent_at=now,
            )
            return "delivered"

        # If all failed without exception (e.g. all unregistered)
        if record.attempts >= self.max_attempts:
            await self.outbox.mark_failed(
                idempotency_key=record.idempotency_key,
                error="all_tokens_rejected",
                retry_at=None,
                now=now,
            )
            return "failed"

        retry_at = now + timedelta(seconds=60)
        await self.outbox.mark_failed(
            idempotency_key=record.idempotency_key,
            error="all_tokens_rejected",
            retry_at=retry_at,
            now=now,
        )
        return "retry"
