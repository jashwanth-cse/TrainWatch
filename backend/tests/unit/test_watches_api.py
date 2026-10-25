"""Unit tests for the watches / reminder API endpoints."""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime
from typing import Any

import pytest
from fastapi import FastAPI

from tests.asgi import request
from tests.unit.test_api_boundary import FakeTokenVerifier
from tests.unit.test_worker_and_scheduler import (
    FakeAvailabilityProvider,
    FakeTaskEnqueuer,
    InMemoryJobRepository,
    InMemoryNotificationOutbox,
    InMemoryObservationRepository,
)
from trainwatch.config import AppSettings
from trainwatch.domain.jobs import JobStatus
from trainwatch.domain.watch import Watch
from trainwatch.main import create_app
from trainwatch.services.worker import DispatcherService, WorkerService


class InMemoryWatchRepository:
    """In-memory watch repository for hermetic unit testing."""

    def __init__(self) -> None:
        self.watches: dict[tuple[str, str], Watch] = {}

    async def get(self, *, watch_id: str, owner_id: str) -> Watch | None:
        return self.watches.get((watch_id, owner_id))

    async def save(self, watch: Watch) -> None:
        self.watches[(watch.watch_id, watch.owner_id)] = watch

    async def delete(self, *, watch_id: str, owner_id: str) -> None:
        self.watches.pop((watch_id, owner_id), None)


def _build_test_app(
    repo: InMemoryWatchRepository | None = None,
    tokens: dict[str, str] | None = None,
    jobs: InMemoryJobRepository | None = None,
) -> FastAPI:
    verifier = FakeTokenVerifier(tokens or {"ticket-a": "user-a", "ticket-b": "user-b"})
    app = create_app(
        AppSettings(app_env="test"),
        token_verifier=verifier,
        watch_repository=repo if repo is not None else InMemoryWatchRepository(),
        job_repository=jobs if jobs is not None else InMemoryJobRepository(),
    )
    return app


@pytest.mark.anyio
async def test_create_watch_success() -> None:
    """A valid watch creation request succeeds with 201 and valid response structure."""
    repo = InMemoryWatchRepository()
    app = _build_test_app(repo)

    payload: dict[str, Any] = {
        "train_number": "12661",
        "source": "MS",
        "destination": "TEN",
        "journey_date": "2026-11-15",
        "travel_class": "3A",
        "quota": "GN",
        "condition": {
            "kind": "becomes_available",
        },
    }

    response = await request(
        app,
        "POST",
        "/api/v1/watches",
        json_body=payload,
        headers={"Authorization": "Bearer ticket-a"},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["watch_id"].startswith("w_")
    assert body["owner_id"] == "user-a"
    assert body["query"]["train_number"] == "12661"
    assert body["query"]["source"] == "MS"
    assert body["query"]["destination"] == "TEN"
    assert body["query"]["travel_class"] == "3A"
    assert body["condition"]["kind"] == "becomes_available"
    assert body["status"] == "active"

    # Verify stored in repository
    stored = await repo.get(watch_id=body["watch_id"], owner_id="user-a")
    assert stored is not None
    assert stored.query.train_number == "12661"


@pytest.mark.anyio
async def test_create_watch_with_threshold_condition() -> None:
    """Create watch with reaches_threshold and numeric target position."""
    repo = InMemoryWatchRepository()
    app = _build_test_app(repo)

    payload = {
        "train_number": "12662",
        "source": "TEN",
        "destination": "MS",
        "journey_date": "2026-11-20",
        "travel_class": "SL",
        "quota": "GN",
        "condition": {
            "kind": "reaches_threshold",
            "target_status": "RAC",
            "maximum_position": 10,
        },
    }

    response = await request(
        app,
        "POST",
        "/api/v1/watches",
        json_body=payload,
        headers={"Authorization": "Bearer ticket-a"},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["condition"]["kind"] == "reaches_threshold"
    assert body["condition"]["target_status"] == "RAC"
    assert body["condition"]["maximum_position"] == 10


@pytest.mark.anyio
@pytest.mark.parametrize(
    "invalid_patch,expected_message",
    [
        ({"train_number": "12"}, "train_number must contain 4 or 5 digits"),
        ({"source": "X"}, "source must contain 2 to 5 letters"),
        ({"destination": "MS", "source": "MS"}, "source and destination must differ"),
        ({"travel_class": "INVALID"}, "unsupported travel_class"),
        ({"quota": "INVALID"}, "unsupported quota"),
        (
            {"condition": {"kind": "reaches_threshold", "target_status": "UNKNOWN"}},
            "threshold status must be AVAILABLE, RAC, or WL",
        ),
        (
            {"condition": {"kind": "becomes_available", "maximum_position": 5}},
            "only threshold alerts accept target fields",
        ),
    ],
)
async def test_create_watch_input_validation_errors(
    invalid_patch: dict[str, Any],
    expected_message: str,
) -> None:
    """Invalid input raises 422 with sanitized error messages."""
    app = _build_test_app()
    base_payload: dict[str, Any] = {
        "train_number": "12661",
        "source": "MS",
        "destination": "TEN",
        "journey_date": "2026-11-15",
        "travel_class": "3A",
        "quota": "GN",
        "condition": {"kind": "becomes_available"},
    }
    base_payload.update(invalid_patch)

    response = await request(
        app,
        "POST",
        "/api/v1/watches",
        json_body=base_payload,
        headers={"Authorization": "Bearer ticket-a"},
    )

    assert response.status_code == 422
    assert expected_message in response.json()["error"]["message"]


@pytest.mark.anyio
async def test_get_watch_success_and_cross_user_isolation() -> None:
    """User can get own watch, but accessing another user's watch returns 404."""
    repo = InMemoryWatchRepository()
    app = _build_test_app(repo)

    create_resp = await request(
        app,
        "POST",
        "/api/v1/watches",
        json_body={
            "train_number": "12661",
            "source": "MS",
            "destination": "TEN",
            "journey_date": "2026-11-15",
            "travel_class": "3A",
            "quota": "GN",
            "condition": {"kind": "becomes_available"},
        },
        headers={"Authorization": "Bearer ticket-a"},
    )
    watch_id = create_resp.json()["watch_id"]

    # Owner GET succeeds
    owner_get = await request(
        app,
        "GET",
        f"/api/v1/watches/{watch_id}",
        headers={"Authorization": "Bearer ticket-a"},
    )
    assert owner_get.status_code == 200
    assert owner_get.json()["watch_id"] == watch_id

    # Non-owner GET returns 404 without leaking data
    non_owner_get = await request(
        app,
        "GET",
        f"/api/v1/watches/{watch_id}",
        headers={"Authorization": "Bearer ticket-b"},
    )
    assert non_owner_get.status_code == 404
    assert non_owner_get.json()["error"]["code"] == "not_found"

    # Non-existent watch returns 404
    missing_get = await request(
        app,
        "GET",
        "/api/v1/watches/non-existent-id",
        headers={"Authorization": "Bearer ticket-a"},
    )
    assert missing_get.status_code == 404


@pytest.mark.anyio
async def test_patch_watch_status_transitions() -> None:
    """Watch can transition through permitted lifecycle states."""
    repo = InMemoryWatchRepository()
    app = _build_test_app(repo)

    create_resp = await request(
        app,
        "POST",
        "/api/v1/watches",
        json_body={
            "train_number": "12661",
            "source": "MS",
            "destination": "TEN",
            "journey_date": "2026-11-15",
            "travel_class": "3A",
            "condition": {"kind": "becomes_available"},
        },
        headers={"Authorization": "Bearer ticket-a"},
    )
    watch_id = create_resp.json()["watch_id"]

    # ACTIVE -> PAUSED
    pause_resp = await request(
        app,
        "PATCH",
        f"/api/v1/watches/{watch_id}",
        json_body={"status": "paused"},
        headers={"Authorization": "Bearer ticket-a"},
    )
    assert pause_resp.status_code == 200
    assert pause_resp.json()["status"] == "paused"

    # PAUSED -> ACTIVE
    resume_resp = await request(
        app,
        "PATCH",
        f"/api/v1/watches/{watch_id}",
        json_body={"status": "active"},
        headers={"Authorization": "Bearer ticket-a"},
    )
    assert resume_resp.status_code == 200
    assert resume_resp.json()["status"] == "active"

    # ACTIVE -> CANCELLED
    cancel_resp = await request(
        app,
        "PATCH",
        f"/api/v1/watches/{watch_id}",
        json_body={"status": "cancelled"},
        headers={"Authorization": "Bearer ticket-a"},
    )
    assert cancel_resp.status_code == 200
    assert cancel_resp.json()["status"] == "cancelled"

    # CANCELLED -> ACTIVE (disallowed transition returns 409 Conflict)
    invalid_resp = await request(
        app,
        "PATCH",
        f"/api/v1/watches/{watch_id}",
        json_body={"status": "active"},
        headers={"Authorization": "Bearer ticket-a"},
    )
    assert invalid_resp.status_code == 409
    assert invalid_resp.json()["error"]["code"] == "invalid_transition"

    # Non-owner cannot patch
    forbidden_patch = await request(
        app,
        "PATCH",
        f"/api/v1/watches/{watch_id}",
        json_body={"status": "active"},
        headers={"Authorization": "Bearer ticket-b"},
    )
    assert forbidden_patch.status_code == 404


@pytest.mark.anyio
async def test_delete_watch_success_and_isolation() -> None:
    """Owner can delete a watch; non-owner returns 404."""
    repo = InMemoryWatchRepository()
    app = _build_test_app(repo)

    create_resp = await request(
        app,
        "POST",
        "/api/v1/watches",
        json_body={
            "train_number": "12661",
            "source": "MS",
            "destination": "TEN",
            "journey_date": "2026-11-15",
            "travel_class": "3A",
            "condition": {"kind": "becomes_available"},
        },
        headers={"Authorization": "Bearer ticket-a"},
    )
    watch_id = create_resp.json()["watch_id"]

    # Non-owner DELETE returns 404
    non_owner_delete = await request(
        app,
        "DELETE",
        f"/api/v1/watches/{watch_id}",
        headers={"Authorization": "Bearer ticket-b"},
    )
    assert non_owner_delete.status_code == 404

    # Owner DELETE returns 204
    delete_resp = await request(
        app,
        "DELETE",
        f"/api/v1/watches/{watch_id}",
        headers={"Authorization": "Bearer ticket-a"},
    )
    assert delete_resp.status_code == 204

    # Subsequent GET returns 404
    assert (
        await request(
            app,
            "GET",
            f"/api/v1/watches/{watch_id}",
            headers={"Authorization": "Bearer ticket-a"},
        )
    ).status_code == 404


@pytest.mark.anyio
async def test_service_unavailable_when_repository_unconfigured() -> None:
    """When watch_repository is None on app state, routes return 503."""
    app = create_app(
        AppSettings(app_env="test"),
        token_verifier=FakeTokenVerifier({"ticket-user": "user-a"}),
        watch_repository=None,
    )
    resp = await request(
        app,
        "POST",
        "/api/v1/watches",
        json_body={
            "train_number": "12661",
            "source": "MS",
            "destination": "TEN",
            "journey_date": "2026-11-15",
            "travel_class": "3A",
            "condition": {"kind": "becomes_available"},
        },
        headers={"Authorization": "Bearer ticket-user"},
    )
    assert resp.status_code == 503
    assert resp.json()["error"]["code"] == "service_unavailable"


@pytest.mark.anyio
@pytest.mark.parametrize("previous_job_status", [*JobStatus, None])
async def test_create_and_resume_schedule_one_dispatchable_job(
    previous_job_status: JobStatus | None,
) -> None:
    """Creation enters the dispatcher; resuming reuses the same job without duplicates."""
    repo = InMemoryWatchRepository()
    jobs = InMemoryJobRepository()
    app = _build_test_app(repo, jobs=jobs)
    created = await request(
        app,
        "POST",
        "/api/v1/watches",
        headers={
            "Authorization": "Bearer ticket-a",
        },
        json_body={
            "train_number": "12661",
            "source": "MS",
            "destination": "TEN",
            "journey_date": "2026-11-15",
            "travel_class": "3A",
            "condition": {"kind": "becomes_available"},
        },
    )
    assert created.status_code == 201
    watch_id = created.json()["watch_id"]
    assert len(jobs.jobs) == 1
    job = next(iter(jobs.jobs.values()))
    assert job.watch_id == watch_id
    assert job.owner_id == "user-a"
    assert job.status is JobStatus.PENDING
    queue = FakeTaskEnqueuer()
    now = datetime.now(UTC)
    dispatcher = DispatcherService(job_repository=jobs, task_enqueuer=queue)
    assert await dispatcher.dispatch_due_jobs(now=now) == 1
    assert queue.enqueued == [job.job_id]
    worker = WorkerService(
        job_repository=jobs,
        watch_repository=repo,
        availability_provider=FakeAvailabilityProvider(),
        observation_repository=InMemoryObservationRepository(),
        notification_outbox=InMemoryNotificationOutbox(),
    )
    assert (await worker.process_job(job_id=job.job_id, now=now)).status == "success"
    path = f"/api/v1/watches/{watch_id}"
    auth = {"Authorization": "Bearer ticket-a"}
    assert (
        await request(app, "PATCH", path, headers=auth, json_body={"status": "paused"})
    ).status_code == 200
    if previous_job_status is None:
        jobs.jobs.clear()
    else:
        jobs.jobs[job.job_id] = replace(jobs.jobs[job.job_id], status=previous_job_status)
    before = jobs.jobs.get(job.job_id)
    resumed = await request(app, "PATCH", path, headers=auth, json_body={"status": "active"})
    assert resumed.status_code == 200
    assert len(jobs.jobs) == 1
    after = jobs.jobs[job.job_id]
    if previous_job_status in {JobStatus.PENDING, JobStatus.LEASED}:
        assert after == before
    else:
        assert after.status is JobStatus.PENDING
        assert after.attempts == 0
        assert after.due_at <= datetime.now(UTC)
    # Idempotent active updates and pause/cancel do not replace the schedule.
    for target in ["active", "paused", "cancelled"]:
        assert (
            await request(app, "PATCH", path, headers=auth, json_body={"status": target})
        ).status_code == 200
        assert jobs.jobs[job.job_id] == after


@pytest.mark.anyio
async def test_create_and_resume_require_scheduler_before_mutating_watch() -> None:
    """An unavailable scheduler cannot produce a successful unscheduled active watch."""
    repo = InMemoryWatchRepository()
    app = _build_test_app(repo)
    auth = {"Authorization": "Bearer ticket-a"}
    payload = {
        "train_number": "12661",
        "source": "MS",
        "destination": "TEN",
        "journey_date": "2026-11-15",
        "travel_class": "3A",
        "condition": {"kind": "becomes_available"},
    }
    jobs = app.state.job_repository
    app.state.job_repository = None
    blocked = await request(app, "POST", "/api/v1/watches", headers=auth, json_body=payload)
    assert blocked.status_code == 503
    assert not repo.watches
    app.state.job_repository = jobs
    created = await request(app, "POST", "/api/v1/watches", headers=auth, json_body=payload)
    path = f"/api/v1/watches/{created.json()['watch_id']}"
    app.state.job_repository = None
    assert (
        await request(app, "PATCH", path, headers=auth, json_body={"status": "paused"})
    ).status_code == 200
    assert (
        await request(app, "PATCH", path, headers=auth, json_body={"status": "active"})
    ).status_code == 503
    assert next(iter(repo.watches.values())).status.value == "paused"
    assert (await request(app, "GET", path, headers=auth)).status_code == 200
    assert (await request(app, "DELETE", path, headers=auth)).status_code == 204
