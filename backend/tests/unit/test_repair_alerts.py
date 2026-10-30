"""Regression checks for notification transition identity and partial writes."""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest

from tests.unit.test_worker_and_scheduler import (
    FakeAvailabilityProvider,
    InMemoryJobRepository,
    InMemoryNotificationOutbox,
    InMemoryObservationRepository,
    InMemoryWatchRepository,
    _sample_watch,
)
from trainwatch.domain.availability import (
    AvailabilityObservation,
    AvailabilitySnapshot,
    AvailabilityStatus,
)
from trainwatch.domain.jobs import JobRecord, JobStatus
from trainwatch.main import FirestoreWatchDispatcher
from trainwatch.services.worker import WorkerService


def observation(status: AvailabilityStatus, at: datetime) -> AvailabilityObservation:
    return AvailabilityObservation.success(
        AvailabilitySnapshot(
            status=status,
            raw_availability="WL 20" if status is AvailabilityStatus.WAITLIST else "AVAILABLE",
            observed_at=at,
            position=20 if status is AvailabilityStatus.WAITLIST else None,
        )
    )


@pytest.mark.anyio
@pytest.mark.parametrize("failure_point", ["outbox", "observation"])
async def test_worker_retries_partial_write_and_alerts_on_later_transition(
    failure_point: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    now = datetime(2026, 11, 1, tzinfo=UTC)
    jobs, watches = InMemoryJobRepository(), InMemoryWatchRepository()
    observations, outbox = InMemoryObservationRepository(), InMemoryNotificationOutbox()
    await watches.save(_sample_watch(watch_id="w1"))
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
    baseline = observation(AvailabilityStatus.WAITLIST, now)
    await observations.save_observation(watch_id="w1", observation=baseline)
    provider = FakeAvailabilityProvider(observation=observation(AvailabilityStatus.AVAILABLE, now))
    worker = WorkerService(
        job_repository=jobs,
        watch_repository=watches,
        availability_provider=provider,
        observation_repository=observations,
        notification_outbox=outbox,
    )
    target = outbox if failure_point == "outbox" else observations
    method = "save_notification" if failure_point == "outbox" else "save_observation"
    original = getattr(target, method)
    calls = 0

    async def fail_once(*args: object, **kwargs: object) -> object:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise RuntimeError("transient write failure")
        return await original(*args, **kwargs)

    monkeypatch.setattr(target, method, fail_once)
    with pytest.raises(RuntimeError, match="transient write failure"):
        await worker.process_job(job_id="j1", now=now)
    assert await observations.get_latest_observation(watch_id="w1") == baseline
    assert len(outbox.items) == (0 if failure_point == "outbox" else 1)
    now += timedelta(seconds=61)
    assert await jobs.reconcile_expired_leases(now=now) == 1
    assert (await worker.process_job(job_id="j1", now=now)).alert_triggered
    assert len(outbox.items) == 1
    now = jobs.jobs["j1"].due_at
    assert not (await worker.process_job(job_id="j1", now=now)).alert_triggered
    provider.observation = observation(AvailabilityStatus.WAITLIST, now)
    now = jobs.jobs["j1"].due_at
    await worker.process_job(job_id="j1", now=now)
    provider.observation = observation(AvailabilityStatus.AVAILABLE, now)
    now = jobs.jobs["j1"].due_at
    assert (await worker.process_job(job_id="j1", now=now)).alert_triggered
    assert len(outbox.items) == 2


@pytest.mark.anyio
async def test_firestore_dispatcher_distinguishes_later_reentry() -> None:
    now = datetime(2026, 11, 1, tzinfo=UTC)
    data = {
        "schemaVersion": 1,
        "status": "active",
        "ownerId": "u1",
        "query": {
            "trainNumber": "12661",
            "source": "MS",
            "destination": "TEN",
            "journeyDate": "2026-11-05",
            "travelClass": "SL",
            "quota": "GN",
        },
        "condition": {"kind": "becomes_available", "targetStatus": None, "maximumPosition": None},
        "createdAt": now,
        "updatedAt": now,
        "lastObservation": {
            "status": "WL",
            "rawAvailability": "WL 20",
            "position": 20,
            "observedAt": now.isoformat(),
        },
    }
    doc = MagicMock(id="w1")
    doc.to_dict.side_effect = lambda: dict(data)

    update_calls = 0

    async def update(fields: dict[str, object]) -> None:
        nonlocal update_calls
        update_calls += 1
        if update_calls == 1:
            raise RuntimeError("transient update failure")
        data.update(fields)

    doc.reference.update = AsyncMock(side_effect=update)
    client = MagicMock()
    query = client.collection_group.return_value
    query.where.return_value = query
    query.order_by.return_value = query
    query.limit.return_value = query
    query.get = AsyncMock(return_value=[doc])
    cursor_ref = client.collection.return_value.document.return_value
    cursor_ref.get = AsyncMock(return_value=MagicMock(to_dict=lambda: {}))
    cursor_ref.set = AsyncMock()
    provider = FakeAvailabilityProvider(observation=observation(AvailabilityStatus.AVAILABLE, now))
    outbox = InMemoryNotificationOutbox()
    dispatcher = FirestoreWatchDispatcher(client, availability_provider=provider, outbox=outbox)
    await dispatcher.dispatch_due_jobs(now=now)
    assert len(outbox.items) == 1
    # Retrying after the document update fails reuses the first outbox key.
    now += timedelta(minutes=5)
    await dispatcher.dispatch_due_jobs(now=now)
    assert len(outbox.items) == 1
    now += timedelta(minutes=5)
    await dispatcher.dispatch_due_jobs(now=now)
    assert len(outbox.items) == 1
    now += timedelta(minutes=5)
    provider.observation = observation(AvailabilityStatus.WAITLIST, now)
    await dispatcher.dispatch_due_jobs(now=now)
    now += timedelta(minutes=5)
    provider.observation = observation(AvailabilityStatus.AVAILABLE, now)
    await dispatcher.dispatch_due_jobs(now=now)
    assert len(outbox.items) == 2
