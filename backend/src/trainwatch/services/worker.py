"""Background reminder dispatcher and worker execution service."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

from trainwatch.domain.alerts import should_alert
from trainwatch.domain.watch import WatchStatus
from trainwatch.ports.availability import AvailabilityProvider, ObservationRepository
from trainwatch.ports.jobs import JobRepository
from trainwatch.ports.notifications import NotificationOutbox, NotificationOutboxItem
from trainwatch.ports.queue import TaskEnqueuer
from trainwatch.ports.watches import WatchRepository


@dataclass(frozen=True, slots=True)
class JobExecutionResult:
    """Outcome of processing one scheduled background reminder check."""

    job_id: str
    status: str
    alert_triggered: bool = False
    error: str | None = None


class DispatcherService:
    """Dispatches due reminder jobs to the background task queue."""

    def __init__(
        self,
        job_repository: JobRepository,
        task_enqueuer: TaskEnqueuer,
    ) -> None:
        self.job_repository = job_repository
        self.task_enqueuer = task_enqueuer

    async def dispatch_due_jobs(self, *, now: datetime, limit: int = 50) -> int:
        """Reconcile expired leases, query due jobs, and enqueue tasks."""
        await self.job_repository.reconcile_expired_leases(now=now)
        due_jobs = await self.job_repository.get_due_jobs(now=now, limit=limit)
        for job in due_jobs:
            await self.task_enqueuer.enqueue_check(job_id=job.job_id)
        return len(due_jobs)


class WorkerService:
    """Executes single reminder checks with concurrency leasing and idempotency."""

    def __init__(
        self,
        *,
        job_repository: JobRepository,
        watch_repository: WatchRepository,
        availability_provider: AvailabilityProvider,
        observation_repository: ObservationRepository,
        notification_outbox: NotificationOutbox,
        max_attempts: int = 5,
        lease_duration_seconds: int = 60,
    ) -> None:
        self.job_repository = job_repository
        self.watch_repository = watch_repository
        self.availability_provider = availability_provider
        self.observation_repository = observation_repository
        self.notification_outbox = notification_outbox
        self.max_attempts = max_attempts
        self.lease_duration_seconds = lease_duration_seconds

    def compute_next_interval_minutes(self, *, days_until_journey: int) -> int:
        """Adjust check frequency based on journey proximity."""
        if days_until_journey <= 1:
            return 5
        if days_until_journey <= 7:
            return 15
        return 30

    async def process_job(self, *, job_id: str, now: datetime) -> JobExecutionResult:
        """Atomically claim, evaluate, and reschedule a single reminder job."""
        job = await self.job_repository.claim_job(
            job_id=job_id,
            lease_duration_seconds=self.lease_duration_seconds,
            now=now,
        )
        if job is None:
            return JobExecutionResult(
                job_id=job_id,
                status="skipped_already_leased",
            )

        watch = await self.watch_repository.get(
            watch_id=job.watch_id,
            owner_id=job.owner_id,
        )
        if watch is None:
            await self.job_repository.complete_job(job_id=job_id, next_due_at=None, now=now)
            return JobExecutionResult(
                job_id=job_id,
                status="completed_watch_missing",
            )

        if watch.status is not WatchStatus.ACTIVE:
            await self.job_repository.complete_job(job_id=job_id, next_due_at=None, now=now)
            return JobExecutionResult(
                job_id=job_id,
                status="completed_watch_inactive",
            )

        today = now.date()
        if today > watch.query.journey_date:
            expired_watch = watch.expire_if_due(today=today, at=now)
            await self.watch_repository.save(expired_watch)
            await self.job_repository.complete_job(job_id=job_id, next_due_at=None, now=now)
            return JobExecutionResult(
                job_id=job_id,
                status="completed_watch_expired",
            )

        observation = await self.availability_provider.fetch(watch.query)
        if observation.snapshot is None:
            err_msg = (
                observation.failure.value
                if observation.failure is not None
                else "transient_provider_failure"
            )
            if job.attempts >= self.max_attempts:
                await self.job_repository.fail_job(
                    job_id=job_id,
                    error=err_msg,
                    retry_at=None,
                    now=now,
                )
                return JobExecutionResult(
                    job_id=job_id,
                    status="completed_max_attempts_exceeded",
                    error=err_msg,
                )

            backoff_seconds = min(300, 30 * (2 ** (job.attempts - 1)))
            retry_at = now + timedelta(seconds=backoff_seconds)
            await self.job_repository.fail_job(
                job_id=job_id,
                error=err_msg,
                retry_at=retry_at,
                now=now,
            )
            return JobExecutionResult(
                job_id=job_id,
                status="retry_scheduled",
                error=err_msg,
            )

        previous = await self.observation_repository.get_latest_observation(watch_id=watch.watch_id)
        await self.observation_repository.save_observation(
            watch_id=watch.watch_id,
            observation=observation,
        )

        alert_triggered = should_alert(
            condition=watch.condition,
            previous=previous,
            current=observation,
        )

        if alert_triggered:
            status_value = observation.snapshot.status.value
            pos = observation.snapshot.position
            pos_label = f" #{pos}" if pos is not None else ""
            idempotency_key = f"alert:{watch.watch_id}:{status_value}:{pos or 0}"
            outbox_item = NotificationOutboxItem(
                idempotency_key=idempotency_key,
                owner_id=watch.owner_id,
                watch_id=watch.watch_id,
                title=f"Seat Alert: Train {watch.query.train_number}",
                body=(
                    f"Seat status updated to {status_value}{pos_label} "
                    f"on {watch.query.journey_date}"
                ),
                created_at=now,
                data={
                    "train_number": watch.query.train_number,
                    "journey_date": str(watch.query.journey_date),
                    "travel_class": watch.query.travel_class,
                    "status": status_value,
                },
            )
            await self.notification_outbox.save_notification(outbox_item)

        days_left = (watch.query.journey_date - today).days
        interval_minutes = self.compute_next_interval_minutes(days_until_journey=days_left)
        next_due = now + timedelta(minutes=interval_minutes)
        await self.job_repository.complete_job(job_id=job_id, next_due_at=next_due, now=now)

        return JobExecutionResult(
            job_id=job_id,
            status="success",
            alert_triggered=alert_triggered,
        )
