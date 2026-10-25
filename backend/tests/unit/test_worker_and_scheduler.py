"""Unit tests for Phase 7 scheduler, queue, and worker execution."""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, date, datetime, timedelta
from typing import Any

import pytest
from fastapi import FastAPI

from tests.asgi import request
from trainwatch.config import AppSettings
from trainwatch.domain.alerts import AlertCondition, AlertKind
from trainwatch.domain.availability import (
    AvailabilityObservation,
    AvailabilitySnapshot,
    AvailabilityStatus,
    ProviderFailure,
)
from trainwatch.domain.jobs import JobRecord, JobStatus
from trainwatch.domain.watch import TrainQuery, Watch, WatchStatus
from trainwatch.main import create_app
from trainwatch.ports.notifications import NotificationOutboxItem
from trainwatch.services.worker import DispatcherService, WorkerService


class InMemoryJobRepository:
    """In-memory implementation of JobRepository for unit testing."""

    def __init__(self) -> None:
        self.jobs: dict[str, JobRecord] = {}

    async def get_due_jobs(self, *, now: datetime, limit: int = 50) -> list[JobRecord]:
        due = [j for j in self.jobs.values() if j.status is JobStatus.PENDING and j.due_at <= now]
        return sorted(due, key=lambda j: j.due_at)[:limit]

    async def claim_job(
        self,
        *,
        job_id: str,
        lease_duration_seconds: int,
        now: datetime,
    ) -> JobRecord | None:
        job = self.jobs.get(job_id)
        if job is None or job.status is not JobStatus.PENDING:
            return None
        updated = job.claim_lease(
            leased_until=now + timedelta(seconds=lease_duration_seconds),
            at=now,
        )
        self.jobs[job_id] = updated
        return updated

    async def complete_job(
        self,
        *,
        job_id: str,
        next_due_at: datetime | None,
        now: datetime,
    ) -> None:
        job = self.jobs.get(job_id)
        if job is not None:
            self.jobs[job_id] = job.mark_completed(next_due_at=next_due_at, at=now)

    async def fail_job(
        self,
        *,
        job_id: str,
        error: str,
        retry_at: datetime | None,
        now: datetime,
    ) -> None:
        job = self.jobs.get(job_id)
        if job is not None:
            self.jobs[job_id] = job.mark_failed(error=error, retry_at=retry_at, at=now)

    async def reconcile_expired_leases(self, *, now: datetime) -> int:
        reconciled = 0
        for job_id, job in list(self.jobs.items()):
            if job.is_lease_expired(now=now):
                self.jobs[job_id] = replace(
                    job, status=JobStatus.PENDING, leased_until=None, due_at=now, updated_at=now
                )
                reconciled += 1
        return reconciled

    async def get(self, *, job_id: str) -> JobRecord | None:
        return self.jobs.get(job_id)

    async def save(self, job: JobRecord) -> None:
        self.jobs[job.job_id] = job

    async def ensure_pending(self, job: JobRecord) -> None:
        existing = self.jobs.get(job.job_id)
        if existing is None or existing.status in {JobStatus.COMPLETED, JobStatus.FAILED}:
            self.jobs[job.job_id] = job


class InMemoryObservationRepository:
    """In-memory observation store for unit tests."""

    def __init__(self) -> None:
        self.observations: dict[str, list[AvailabilityObservation]] = {}

    async def save_observation(
        self,
        *,
        watch_id: str,
        observation: AvailabilityObservation,
    ) -> None:
        self.observations.setdefault(watch_id, []).append(observation)

    async def get_latest_observation(
        self,
        *,
        watch_id: str,
    ) -> AvailabilityObservation | None:
        obs_list = self.observations.get(watch_id, [])
        return obs_list[-1] if obs_list else None


class InMemoryNotificationOutbox:
    """In-memory notification outbox enforcing idempotency."""

    def __init__(self) -> None:
        self.items: dict[str, NotificationOutboxItem] = {}

    async def save_notification(self, item: NotificationOutboxItem) -> bool:
        if item.idempotency_key in self.items:
            return False
        self.items[item.idempotency_key] = item
        return True

    async def get_by_key(self, idempotency_key: str) -> Any:
        return self.items.get(idempotency_key)

    async def claim_pending_notifications(
        self,
        *,
        batch_size: int,
        lease_seconds: int,
        now: datetime,
    ) -> list[Any]:
        return []

    async def mark_delivered(self, *, idempotency_key: str, sent_at: datetime) -> None:
        pass

    async def mark_failed(
        self,
        *,
        idempotency_key: str,
        error: str,
        retry_at: datetime | None,
        now: datetime,
    ) -> None:
        pass


class FakeTaskEnqueuer:
    """Fake task queue recording dispatched job IDs."""

    def __init__(self) -> None:
        self.enqueued: list[str] = []

    async def enqueue_check(self, *, job_id: str, countdown_seconds: int = 0) -> str:
        self.enqueued.append(job_id)
        return f"task-{job_id}"


class FakeAvailabilityProvider:
    """Fake availability provider returning configurable responses."""

    def __init__(self, observation: AvailabilityObservation | None = None) -> None:
        now = datetime(2026, 11, 1, 12, 0, tzinfo=UTC)
        self.observation = observation or AvailabilityObservation.success(
            AvailabilitySnapshot(
                status=AvailabilityStatus.AVAILABLE,
                raw_availability="AVAILABLE",
                observed_at=now,
            )
        )

    async def fetch(self, query: TrainQuery) -> AvailabilityObservation:
        return self.observation


class InMemoryWatchRepository:
    """In-memory watch repository."""

    def __init__(self) -> None:
        self.watches: dict[tuple[str, str], Watch] = {}

    async def get(self, *, watch_id: str, owner_id: str) -> Watch | None:
        return self.watches.get((watch_id, owner_id))

    async def save(self, watch: Watch) -> None:
        self.watches[(watch.watch_id, watch.owner_id)] = watch

    async def delete(self, *, watch_id: str, owner_id: str) -> None:
        self.watches.pop((watch_id, owner_id), None)


def _sample_watch(
    *,
    watch_id: str = "w1",
    owner_id: str = "u1",
    journey_date: date | None = None,
    status: WatchStatus = WatchStatus.ACTIVE,
    created_at: datetime | None = None,
) -> Watch:
    now = created_at or (datetime.now(UTC) - timedelta(days=1))
    return Watch(
        watch_id=watch_id,
        owner_id=owner_id,
        query=TrainQuery(
            train_number="12661",
            source="MS",
            destination="TEN",
            journey_date=journey_date or date(2026, 11, 15),
            travel_class="3A",
            quota="GN",
        ),
        condition=AlertCondition(kind=AlertKind.BECOMES_AVAILABLE),
        status=status,
        created_at=now,
        updated_at=now,
    )


# ---------------------------------------------------------------------------
# Domain Unit Tests: JobRecord & Invariants
# ---------------------------------------------------------------------------


def test_job_record_invariants_and_transitions() -> None:
    """Validate invariants, leases, completion, and expiration."""
    now = datetime(2026, 11, 1, 12, 0, tzinfo=UTC)

    # Invariants
    with pytest.raises(ValueError, match="job_id must not be blank"):
        JobRecord(
            job_id="",
            watch_id="w1",
            owner_id="u1",
            due_at=now,
            status=JobStatus.PENDING,
            created_at=now,
            updated_at=now,
        )

    with pytest.raises(ValueError, match="watch_id must not be blank"):
        JobRecord(
            job_id="j1",
            watch_id="",
            owner_id="u1",
            due_at=now,
            status=JobStatus.PENDING,
            created_at=now,
            updated_at=now,
        )

    with pytest.raises(ValueError, match="owner_id must not be blank"):
        JobRecord(
            job_id="j1",
            watch_id="w1",
            owner_id="",
            due_at=now,
            status=JobStatus.PENDING,
            created_at=now,
            updated_at=now,
        )

    with pytest.raises(ValueError, match="attempts must be non-negative"):
        JobRecord(
            job_id="j1",
            watch_id="w1",
            owner_id="u1",
            due_at=now,
            status=JobStatus.PENDING,
            created_at=now,
            updated_at=now,
            attempts=-1,
        )

    with pytest.raises(ValueError, match="updated_at must not precede created_at"):
        JobRecord(
            job_id="j1",
            watch_id="w1",
            owner_id="u1",
            due_at=now,
            status=JobStatus.PENDING,
            created_at=now,
            updated_at=now - timedelta(seconds=1),
        )

    # Valid job transitions
    job = JobRecord(
        job_id="j1",
        watch_id="w1",
        owner_id="u1",
        due_at=now,
        status=JobStatus.PENDING,
        created_at=now,
        updated_at=now,
    )

    leased = job.claim_lease(leased_until=now + timedelta(seconds=60), at=now)
    assert leased.status == JobStatus.LEASED
    assert leased.attempts == 1
    assert leased.leased_until == now + timedelta(seconds=60)
    assert not leased.is_lease_expired(now=now)
    assert leased.is_lease_expired(now=now + timedelta(seconds=61))

    # Rescheduled completion
    rescheduled = leased.mark_completed(next_due_at=now + timedelta(minutes=15), at=now)
    assert rescheduled.status == JobStatus.PENDING
    assert rescheduled.due_at == now + timedelta(minutes=15)
    assert rescheduled.leased_until is None

    # Terminal completion
    completed = leased.mark_completed(next_due_at=None, at=now)
    assert completed.status == JobStatus.COMPLETED

    # Failure with retry
    failed_retry = leased.mark_failed(
        error="upstream 503",
        retry_at=now + timedelta(seconds=30),
        at=now,
    )
    assert failed_retry.status == JobStatus.PENDING
    assert failed_retry.last_error == "upstream 503"

    # Terminal failure
    failed_terminal = leased.mark_failed(error="fatal error", retry_at=None, at=now)
    assert failed_terminal.status == JobStatus.FAILED
    assert failed_terminal.last_error == "fatal error"


# ---------------------------------------------------------------------------
# Outbox Tests
# ---------------------------------------------------------------------------


def test_notification_outbox_item_invariants() -> None:
    """Enforce non-empty idempotency key and identifiers."""
    now = datetime(2026, 11, 1, 12, 0, tzinfo=UTC)
    with pytest.raises(ValueError, match="idempotency_key must not be blank"):
        NotificationOutboxItem(
            idempotency_key="",
            owner_id="u1",
            watch_id="w1",
            title="Title",
            body="Body",
            created_at=now,
        )

    with pytest.raises(ValueError, match="owner_id must not be blank"):
        NotificationOutboxItem(
            idempotency_key="key",
            owner_id="",
            watch_id="w1",
            title="Title",
            body="Body",
            created_at=now,
        )

    with pytest.raises(ValueError, match="watch_id must not be blank"):
        NotificationOutboxItem(
            idempotency_key="key",
            owner_id="u1",
            watch_id="",
            title="Title",
            body="Body",
            created_at=now,
        )


# ---------------------------------------------------------------------------
# Dispatcher Tests
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_dispatcher_service_dispatches_due_jobs_and_reconciles_leases() -> None:
    """Dispatcher queries only due jobs, enqueues tasks, and reconciles expired leases."""
    now = datetime(2026, 11, 1, 12, 0, tzinfo=UTC)
    job_repo = InMemoryJobRepository()
    queue = FakeTaskEnqueuer()

    # Add a due job, a future job, and an expired lease job
    due_job = JobRecord(
        job_id="j1",
        watch_id="w1",
        owner_id="u1",
        due_at=now - timedelta(minutes=1),
        status=JobStatus.PENDING,
        created_at=now,
        updated_at=now,
    )
    future_job = JobRecord(
        job_id="j2",
        watch_id="w2",
        owner_id="u1",
        due_at=now + timedelta(minutes=10),
        status=JobStatus.PENDING,
        created_at=now,
        updated_at=now,
    )
    expired_lease_job = JobRecord(
        job_id="j3",
        watch_id="w3",
        owner_id="u1",
        due_at=now - timedelta(minutes=5),
        status=JobStatus.LEASED,
        leased_until=now - timedelta(seconds=10),
        created_at=now,
        updated_at=now,
    )

    await job_repo.save(due_job)
    await job_repo.save(future_job)
    await job_repo.save(expired_lease_job)

    dispatcher = DispatcherService(job_repository=job_repo, task_enqueuer=queue)
    dispatched_count = await dispatcher.dispatch_due_jobs(now=now)

    # Both j1 and reconciled j3 are now due and dispatched
    assert dispatched_count == 2
    assert "j1" in queue.enqueued
    assert "j3" in queue.enqueued
    assert "j2" not in queue.enqueued


# ---------------------------------------------------------------------------
# Worker Tests: Concurrency, Evaluation & Outbox
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_worker_skips_when_job_already_claimed_by_concurrent_worker() -> None:
    """Concurrent worker claiming the same job is rejected safely without duplicate work."""
    now = datetime(2026, 11, 1, 12, 0, tzinfo=UTC)
    job_repo = InMemoryJobRepository()
    watch_repo = InMemoryWatchRepository()
    obs_repo = InMemoryObservationRepository()
    outbox = InMemoryNotificationOutbox()
    provider = FakeAvailabilityProvider()

    job = JobRecord(
        job_id="j1",
        watch_id="w1",
        owner_id="u1",
        due_at=now,
        status=JobStatus.LEASED,  # Already leased by worker 1
        leased_until=now + timedelta(seconds=60),
        created_at=now,
        updated_at=now,
    )
    await job_repo.save(job)

    worker = WorkerService(
        job_repository=job_repo,
        watch_repository=watch_repo,
        availability_provider=provider,
        observation_repository=obs_repo,
        notification_outbox=outbox,
    )

    result = await worker.process_job(job_id="j1", now=now)
    assert result.status == "skipped_already_leased"
    assert not result.alert_triggered


@pytest.mark.anyio
async def test_worker_handles_missing_or_inactive_watch() -> None:
    """When a watch is missing or paused/cancelled, the job is completed and terminated."""
    now = datetime(2026, 11, 1, 12, 0, tzinfo=UTC)
    job_repo = InMemoryJobRepository()
    watch_repo = InMemoryWatchRepository()
    obs_repo = InMemoryObservationRepository()
    outbox = InMemoryNotificationOutbox()
    provider = FakeAvailabilityProvider()

    # Case 1: Watch missing
    job1 = JobRecord(
        job_id="j1",
        watch_id="w1",
        owner_id="u1",
        due_at=now,
        status=JobStatus.PENDING,
        created_at=now,
        updated_at=now,
    )
    await job_repo.save(job1)

    worker = WorkerService(
        job_repository=job_repo,
        watch_repository=watch_repo,
        availability_provider=provider,
        observation_repository=obs_repo,
        notification_outbox=outbox,
    )

    res1 = await worker.process_job(job_id="j1", now=now)
    assert res1.status == "completed_watch_missing"
    final_j1 = await job_repo.get(job_id="j1")
    assert final_j1 is not None and final_j1.status == JobStatus.COMPLETED

    # Case 2: Watch paused
    paused_watch = _sample_watch(watch_id="w2", status=WatchStatus.PAUSED)
    await watch_repo.save(paused_watch)
    job2 = JobRecord(
        job_id="j2",
        watch_id="w2",
        owner_id="u1",
        due_at=now,
        status=JobStatus.PENDING,
        created_at=now,
        updated_at=now,
    )
    await job_repo.save(job2)

    res2 = await worker.process_job(job_id="j2", now=now)
    assert res2.status == "completed_watch_inactive"
    final_j2 = await job_repo.get(job_id="j2")
    assert final_j2 is not None and final_j2.status == JobStatus.COMPLETED


@pytest.mark.anyio
async def test_worker_expires_past_journey_watch() -> None:
    """When journey date has passed, watch is marked EXPIRED and job terminates."""
    now = datetime(2026, 11, 20, 12, 0, tzinfo=UTC)  # Past journey date of 2026-11-15
    job_repo = InMemoryJobRepository()
    watch_repo = InMemoryWatchRepository()
    obs_repo = InMemoryObservationRepository()
    outbox = InMemoryNotificationOutbox()
    provider = FakeAvailabilityProvider()

    watch = _sample_watch(watch_id="w1", journey_date=date(2026, 11, 15))
    await watch_repo.save(watch)

    job = JobRecord(
        job_id="j1",
        watch_id="w1",
        owner_id="u1",
        due_at=now,
        status=JobStatus.PENDING,
        created_at=now,
        updated_at=now,
    )
    await job_repo.save(job)

    worker = WorkerService(
        job_repository=job_repo,
        watch_repository=watch_repo,
        availability_provider=provider,
        observation_repository=obs_repo,
        notification_outbox=outbox,
    )

    result = await worker.process_job(job_id="j1", now=now)
    assert result.status == "completed_watch_expired"

    updated_watch = await watch_repo.get(watch_id="w1", owner_id="u1")
    assert updated_watch is not None and updated_watch.status == WatchStatus.EXPIRED


@pytest.mark.anyio
async def test_worker_retries_transient_failures_and_caps_at_max_attempts() -> None:
    """Transient failures schedule backoff retries; exceeded max attempts terminate permanently."""
    now = datetime(2026, 11, 1, 12, 0, tzinfo=UTC)
    job_repo = InMemoryJobRepository()
    watch_repo = InMemoryWatchRepository()
    obs_repo = InMemoryObservationRepository()
    outbox = InMemoryNotificationOutbox()

    # Provider returning failed observation
    error_obs = AvailabilityObservation.failed(ProviderFailure.TIMEOUT)
    provider = FakeAvailabilityProvider(observation=error_obs)
    watch = _sample_watch(watch_id="w1")
    await watch_repo.save(watch)

    # Attempt 1: schedules retry
    job = JobRecord(
        job_id="j1",
        watch_id="w1",
        owner_id="u1",
        due_at=now,
        status=JobStatus.PENDING,
        created_at=now,
        updated_at=now,
        attempts=0,
    )
    await job_repo.save(job)

    worker = WorkerService(
        job_repository=job_repo,
        watch_repository=watch_repo,
        availability_provider=provider,
        observation_repository=obs_repo,
        notification_outbox=outbox,
        max_attempts=3,
    )

    res1 = await worker.process_job(job_id="j1", now=now)
    assert res1.status == "retry_scheduled"
    assert res1.error == "timeout"

    saved_job = await job_repo.get(job_id="j1")
    assert saved_job is not None and saved_job.status == JobStatus.PENDING
    assert saved_job.attempts == 1

    # Simulate reaching max attempts (attempts=3)
    maxed_job = JobRecord(
        job_id="j2",
        watch_id="w1",
        owner_id="u1",
        due_at=now,
        status=JobStatus.PENDING,
        created_at=now,
        updated_at=now,
        attempts=2,  # claiming makes it 3 == max_attempts
    )
    await job_repo.save(maxed_job)

    res2 = await worker.process_job(job_id="j2", now=now)
    assert res2.status == "completed_max_attempts_exceeded"
    saved_j2 = await job_repo.get(job_id="j2")
    assert saved_j2 is not None and saved_j2.status == JobStatus.FAILED


@pytest.mark.anyio
async def test_worker_evaluates_condition_and_saves_outbox_idempotently() -> None:
    """Outbox item is created on trigger; duplicate triggers deduplicate."""
    now = datetime(2026, 11, 1, 12, 0, tzinfo=UTC)
    job_repo = InMemoryJobRepository()
    watch_repo = InMemoryWatchRepository()
    obs_repo = InMemoryObservationRepository()
    outbox = InMemoryNotificationOutbox()

    watch = _sample_watch(watch_id="w1")
    await watch_repo.save(watch)

    # Initial baseline observation: WL 20
    baseline_obs = AvailabilityObservation.success(
        AvailabilitySnapshot(
            status=AvailabilityStatus.WAITLIST,
            position=20,
            raw_availability="GNWL 20",
            observed_at=now,
        )
    )
    await obs_repo.save_observation(watch_id="w1", observation=baseline_obs)

    # Current observation: Available
    current_obs = AvailabilityObservation.success(
        AvailabilitySnapshot(
            status=AvailabilityStatus.AVAILABLE,
            position=None,
            raw_availability="AVL",
            observed_at=now,
        )
    )
    provider = FakeAvailabilityProvider(observation=current_obs)

    job = JobRecord(
        job_id="j1",
        watch_id="w1",
        owner_id="u1",
        due_at=now,
        status=JobStatus.PENDING,
        created_at=now,
        updated_at=now,
    )
    await job_repo.save(job)

    worker = WorkerService(
        job_repository=job_repo,
        watch_repository=watch_repo,
        availability_provider=provider,
        observation_repository=obs_repo,
        notification_outbox=outbox,
    )

    result = await worker.process_job(job_id="j1", now=now)
    assert result.status == "success"
    assert result.alert_triggered

    # Verify outbox item was created
    expected_key = f"alert:w1:{now.isoformat()}:AVAILABLE:0"
    item = await outbox.get_by_key(expected_key)
    assert item is not None
    assert "Seat Alert: Train 12661" in item.title
    assert "AVAILABLE" in item.body

    # Calling save_notification with the same idempotency key again returns False (idempotent)
    second_save = await outbox.save_notification(item)
    assert not second_save


# ---------------------------------------------------------------------------
# Internal API Endpoints Tests
# ---------------------------------------------------------------------------


def _build_internal_test_app(
    *,
    dispatcher: DispatcherService | None = None,
    worker: WorkerService | None = None,
    internal_key: str = "",
) -> FastAPI:
    return create_app(
        AppSettings(app_env="test", internal_service_key=internal_key),
        dispatcher_service=dispatcher,
        worker_service=worker,
    )


@pytest.mark.anyio
async def test_internal_dispatcher_endpoint_success_and_service_unavailable() -> None:
    """Internal dispatcher endpoint enqueues jobs and fails cleanly when unconfigured."""
    now = datetime.now(UTC) - timedelta(minutes=5)
    job_repo = InMemoryJobRepository()
    queue = FakeTaskEnqueuer()
    dispatcher = DispatcherService(job_repository=job_repo, task_enqueuer=queue)

    await job_repo.save(
        JobRecord(
            job_id="j1",
            watch_id="w1",
            owner_id="u1",
            due_at=now,
            status=JobStatus.PENDING,
            created_at=now,
            updated_at=now,
        )
    )

    app = _build_internal_test_app(dispatcher=dispatcher)
    resp = await request(app, "POST", "/api/v1/internal/dispatcher")
    assert resp.status_code == 200
    assert resp.json()["dispatched"] == 1

    # Unconfigured dispatcher
    unconfigured_app = _build_internal_test_app(dispatcher=None)
    err_resp = await request(unconfigured_app, "POST", "/api/v1/internal/dispatcher")
    assert err_resp.status_code == 503
    assert err_resp.json()["error"]["code"] == "service_unavailable"


@pytest.mark.anyio
async def test_internal_worker_endpoint_success_and_validation() -> None:
    """Internal worker endpoint processes single job and validates input."""
    now = datetime.now(UTC) - timedelta(minutes=5)
    job_repo = InMemoryJobRepository()
    watch_repo = InMemoryWatchRepository()
    obs_repo = InMemoryObservationRepository()
    outbox = InMemoryNotificationOutbox()
    provider = FakeAvailabilityProvider()

    watch = _sample_watch(watch_id="w1", created_at=now)
    await watch_repo.save(watch)
    await job_repo.save(
        JobRecord(
            job_id="j1",
            watch_id="w1",
            owner_id="u1",
            due_at=now,
            status=JobStatus.PENDING,
            created_at=now,
            updated_at=now,
        )
    )

    worker = WorkerService(
        job_repository=job_repo,
        watch_repository=watch_repo,
        availability_provider=provider,
        observation_repository=obs_repo,
        notification_outbox=outbox,
    )

    app = _build_internal_test_app(worker=worker)

    # Valid process request
    resp = await request(
        app,
        "POST",
        "/api/v1/internal/worker/process",
        json_body={"job_id": "j1"},
    )
    assert resp.status_code == 200
    assert resp.json()["job_id"] == "j1"
    assert resp.json()["status"] == "success"

    # Validation failure: missing/empty job_id
    invalid_resp = await request(
        app,
        "POST",
        "/api/v1/internal/worker/process",
        json_body={"job_id": ""},
    )
    assert invalid_resp.status_code == 422

    # Unconfigured worker
    unconfigured_app = _build_internal_test_app(worker=None)
    err_resp = await request(
        unconfigured_app,
        "POST",
        "/api/v1/internal/worker/process",
        json_body={"job_id": "j1"},
    )
    assert err_resp.status_code == 503


@pytest.mark.anyio
async def test_internal_auth_enforcement_when_secret_key_configured() -> None:
    """When internal_service_key is configured, requests without valid credentials return 401."""
    job_repo = InMemoryJobRepository()
    queue = FakeTaskEnqueuer()
    dispatcher = DispatcherService(job_repository=job_repo, task_enqueuer=queue)

    app = _build_internal_test_app(
        dispatcher=dispatcher,
        internal_key="placeholder",
    )

    # Missing credentials -> 401
    resp_no_auth = await request(app, "POST", "/api/v1/internal/dispatcher")
    assert resp_no_auth.status_code == 401
    assert resp_no_auth.json()["error"]["code"] == "unauthorized"

    # Invalid header -> 401
    resp_bad_auth = await request(
        app,
        "POST",
        "/api/v1/internal/dispatcher",
        headers={"X-Internal-Token": "replace_me"},
    )
    assert resp_bad_auth.status_code == 401

    # Valid header -> 200
    resp_good_header = await request(
        app,
        "POST",
        "/api/v1/internal/dispatcher",
        headers={"X-Internal-Token": "placeholder"},
    )
    assert resp_good_header.status_code == 200

    # Valid Bearer Authorization -> 200
    resp_good_bearer = await request(
        app,
        "POST",
        "/api/v1/internal/dispatcher",
        headers={"Authorization": "Bearer placeholder"},
    )
    assert resp_good_bearer.status_code == 200


def test_worker_computes_interval_based_on_journey_proximity() -> None:
    """Proximity to journey date scales the polling frequency."""
    worker = WorkerService(
        job_repository=InMemoryJobRepository(),
        watch_repository=InMemoryWatchRepository(),
        availability_provider=FakeAvailabilityProvider(),
        observation_repository=InMemoryObservationRepository(),
        notification_outbox=InMemoryNotificationOutbox(),
    )
    assert worker.compute_next_interval_minutes(days_until_journey=0) == 5
    assert worker.compute_next_interval_minutes(days_until_journey=1) == 5
    assert worker.compute_next_interval_minutes(days_until_journey=3) == 15
    assert worker.compute_next_interval_minutes(days_until_journey=7) == 15
    assert worker.compute_next_interval_minutes(days_until_journey=8) == 30
    assert worker.compute_next_interval_minutes(days_until_journey=30) == 30


def _reliability_worker() -> tuple[
    WorkerService,
    InMemoryJobRepository,
    InMemoryWatchRepository,
    InMemoryObservationRepository,
    InMemoryNotificationOutbox,
    FakeAvailabilityProvider,
]:
    jobs = InMemoryJobRepository()
    watches = InMemoryWatchRepository()
    observations = InMemoryObservationRepository()
    outbox = InMemoryNotificationOutbox()
    provider = FakeAvailabilityProvider()
    return (
        WorkerService(
            job_repository=jobs,
            watch_repository=watches,
            availability_provider=provider,
            observation_repository=observations,
            notification_outbox=outbox,
            max_attempts=3,
        ),
        jobs,
        watches,
        observations,
        outbox,
        provider,
    )


async def _seed_check(
    jobs: InMemoryJobRepository, watches: InMemoryWatchRepository, now: datetime
) -> None:
    await watches.save(_sample_watch(created_at=now))
    await jobs.save(
        JobRecord(
            job_id="j1",
            watch_id="w1",
            owner_id="u1",
            due_at=now,
            status=JobStatus.PENDING,
            created_at=now,
            updated_at=now,
        )
    )


@pytest.mark.anyio
async def test_successful_checks_reset_retry_budget() -> None:
    """A long-running successful watch still gets retries for a subsequent failure."""
    worker, jobs, watches, _, _, provider = _reliability_worker()
    now = datetime(2026, 11, 1, tzinfo=UTC)
    await _seed_check(jobs, watches, now)
    for _ in range(6):
        result = await worker.process_job(job_id="j1", now=now)
        assert result.status == "success"
        saved = jobs.jobs["j1"]
        assert saved.status is JobStatus.PENDING
        assert saved.attempts == 0
        now = saved.due_at
    provider.observation = AvailabilityObservation.failed(ProviderFailure.TIMEOUT)
    result = await worker.process_job(job_id="j1", now=now)
    assert result.status == "retry_scheduled"
    assert jobs.jobs["j1"].status is JobStatus.PENDING
    assert jobs.jobs["j1"].attempts == 1


@pytest.mark.anyio
@pytest.mark.parametrize("failure_point", ["watch", "provider", "read", "write", "complete"])
async def test_unexpected_exceptions_use_bounded_sanitized_retries(
    failure_point: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Execution failures must release the lease and exhaust the same retry budget."""
    worker, jobs, watches, observations, _, provider = _reliability_worker()
    now = datetime(2026, 11, 1, tzinfo=UTC)
    await _seed_check(jobs, watches, now)

    async def explode(*args: object, **kwargs: object) -> None:
        raise RuntimeError("sensitive upstream payload")

    targets = {
        "watch": (watches, "get"),
        "provider": (provider, "fetch"),
        "read": (observations, "get_latest_observation"),
        "write": (observations, "save_observation"),
        "complete": (jobs, "complete_job"),
    }
    target, method = targets[failure_point]
    monkeypatch.setattr(target, method, explode)
    for attempt in range(1, 4):
        result = await worker.process_job(job_id="j1", now=now)
        assert result.error == "unexpected_worker_error"
        assert jobs.jobs["j1"].attempts == attempt
        assert jobs.jobs["j1"].leased_until is None
        assert jobs.jobs["j1"].last_error == "unexpected_worker_error"
        if attempt < 3:
            assert result.status == "retry_scheduled"
            assert jobs.jobs["j1"].status is JobStatus.PENDING
            now = jobs.jobs["j1"].due_at
        else:
            assert result.status == "completed_max_attempts_exceeded"
            assert jobs.jobs["j1"].status is JobStatus.FAILED


@pytest.mark.anyio
@pytest.mark.parametrize("failure_point", ["outbox", "observation"])
async def test_notification_survives_partial_persistence_and_repeated_transitions(
    failure_point: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Each transition alerts once across partial-write retries and later re-entry."""
    worker, jobs, watches, observations, outbox, provider = _reliability_worker()
    now = datetime(2026, 11, 1, tzinfo=UTC)
    await _seed_check(jobs, watches, now)
    baseline = AvailabilityObservation.success(
        AvailabilitySnapshot(
            status=AvailabilityStatus.WAITLIST,
            position=20,
            raw_availability="WL 20",
            observed_at=now,
        )
    )
    await observations.save_observation(watch_id="w1", observation=baseline)
    calls = 0
    original_outbox = outbox.save_notification
    original_save = observations.save_observation

    async def save_notification(item: NotificationOutboxItem) -> bool:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise RuntimeError("outbox temporarily unavailable")
        return await original_outbox(item)

    async def save_observation(*, watch_id: str, observation: AvailabilityObservation) -> None:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise RuntimeError("observation temporarily unavailable")
        await original_save(watch_id=watch_id, observation=observation)

    if failure_point == "outbox":
        monkeypatch.setattr(outbox, "save_notification", save_notification)
    else:
        monkeypatch.setattr(observations, "save_observation", save_observation)
    first = await worker.process_job(job_id="j1", now=now)
    assert first.status == "retry_scheduled"
    assert await observations.get_latest_observation(watch_id="w1") == baseline
    assert len(outbox.items) == (0 if failure_point == "outbox" else 1)

    now = jobs.jobs["j1"].due_at
    retried = await worker.process_job(job_id="j1", now=now)
    assert retried.status == "success"
    assert retried.alert_triggered
    assert len(outbox.items) == 1

    now = jobs.jobs["j1"].due_at
    repeated = await worker.process_job(job_id="j1", now=now)
    assert not repeated.alert_triggered
    assert len(outbox.items) == 1

    now = jobs.jobs["j1"].due_at
    provider.observation = (
        AvailabilityObservation.success(
            replace(
                baseline.snapshot,
                observed_at=now,
            )
        )
        if baseline.snapshot is not None
        else baseline
    )
    assert (await worker.process_job(job_id="j1", now=now)).status == "success"
    now = jobs.jobs["j1"].due_at
    provider.observation = AvailabilityObservation.success(
        AvailabilitySnapshot(
            status=AvailabilityStatus.AVAILABLE,
            raw_availability="AVAILABLE",
            observed_at=now,
        )
    )
    returned = await worker.process_job(job_id="j1", now=now)
    assert returned.alert_triggered
    assert len(outbox.items) == 2


@pytest.mark.anyio
async def test_lease_recovery_preserves_attempt_budget() -> None:
    """Lease expiry is not a successful check and cannot reset failed attempts."""
    _, jobs, watches, _, _, _ = _reliability_worker()
    now = datetime(2026, 11, 1, tzinfo=UTC)
    await _seed_check(jobs, watches, now)
    jobs.jobs["j1"] = replace(
        jobs.jobs["j1"], status=JobStatus.LEASED, attempts=2, leased_until=now
    )
    assert await jobs.reconcile_expired_leases(now=now) == 1
    assert jobs.jobs["j1"].attempts == 2
