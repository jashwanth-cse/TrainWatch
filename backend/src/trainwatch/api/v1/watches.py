"""Owner-scoped watch/reminder CRUD routes."""

from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Annotated, Any, cast
from uuid import uuid4

from fastapi import APIRouter, Depends, Header, Request, status
from pydantic import BaseModel, Field

from trainwatch.api.errors import ApiError
from trainwatch.api.ownership import require_owner
from trainwatch.domain.alerts import AlertCondition, AlertKind
from trainwatch.domain.availability import AvailabilityStatus
from trainwatch.domain.jobs import JobRecord, JobStatus
from trainwatch.domain.watch import TrainQuery, Watch, WatchStatus
from trainwatch.ports.identity import AuthenticatedUser
from trainwatch.ports.jobs import JobRepository
from trainwatch.ports.watches import WatchRepository

router = APIRouter(prefix="/watches", tags=["watches"])


class AlertConditionPayload(BaseModel):
    """Client representation of an alert transition condition."""

    kind: AlertKind
    target_status: AvailabilityStatus | None = None
    maximum_position: int | None = Field(default=None, gt=0)


class CreateWatchPayload(BaseModel):
    """Validated input fields required to create one monitoring watch."""

    train_number: str
    source: str
    destination: str
    journey_date: date
    travel_class: str
    quota: str = "GN"
    condition: AlertConditionPayload


class UpdateWatchPayload(BaseModel):
    """Permitted state update for an existing watch."""

    status: WatchStatus


class QueryResponse(BaseModel):
    """Canonical train query response fields."""

    train_number: str
    source: str
    destination: str
    journey_date: date
    travel_class: str
    quota: str
    watch_key: str


class ConditionResponse(BaseModel):
    """Canonical condition response fields."""

    kind: str
    target_status: str | None
    maximum_position: int | None


class WatchResponse(BaseModel):
    """Public representation of an owned watch."""

    watch_id: str
    owner_id: str
    query: QueryResponse
    condition: ConditionResponse
    status: str
    created_at: datetime
    updated_at: datetime


def _serialize_watch(watch: Watch) -> WatchResponse:
    """Map one domain watch entity to a stable client response."""
    return WatchResponse(
        watch_id=watch.watch_id,
        owner_id=watch.owner_id,
        query=QueryResponse(
            train_number=watch.query.train_number,
            source=watch.query.source,
            destination=watch.query.destination,
            journey_date=watch.query.journey_date,
            travel_class=watch.query.travel_class,
            quota=watch.query.quota,
            watch_key=watch.query.watch_key,
        ),
        condition=ConditionResponse(
            kind=watch.condition.kind.value,
            target_status=(
                watch.condition.target_status.value if watch.condition.target_status else None
            ),
            maximum_position=watch.condition.maximum_position,
        ),
        status=watch.status.value,
        created_at=watch.created_at,
        updated_at=watch.updated_at,
    )


async def get_current_user(
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
) -> AuthenticatedUser:
    """Resolve caller identity using the application auth dependency."""
    dependency = request.app.state.current_user_dependency
    user: AuthenticatedUser = await dependency(authorization=authorization)
    return user


def get_repository(request: Request) -> WatchRepository:
    """Read the injected repository or signal an unconfigured service."""
    repo = getattr(request.app.state, "watch_repository", None)
    if repo is None:
        raise ApiError(
            status_code=503,
            code="service_unavailable",
            message="Watch repository is not configured",
        )
    return cast(WatchRepository, repo)


def get_job_repository(request: Request) -> JobRepository:
    """Require scheduling before accepting an active monitoring watch."""
    repo = request.app.state.job_repository
    if repo is None:
        raise ApiError(
            status_code=503,
            code="service_unavailable",
            message="Job repository is not configured",
        )
    return cast(JobRepository, repo)


async def _schedule_watch(watch: Watch, jobs: JobRepository, *, now: datetime) -> None:
    """Use a stable per-watch job ID to avoid duplicate schedules on resume."""
    await jobs.ensure_pending(
        JobRecord(
            job_id=f"watch:{watch.owner_id}:{watch.watch_id}",
            watch_id=watch.watch_id,
            owner_id=watch.owner_id,
            due_at=now,
            status=JobStatus.PENDING,
            created_at=now,
            updated_at=now,
        )
    )


@router.post("", response_model=WatchResponse, status_code=status.HTTP_201_CREATED)
async def create_watch(
    request: Request,
    payload: CreateWatchPayload,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    repo: Annotated[WatchRepository, Depends(get_repository)],
) -> Any:
    """Create a new validated seat availability watch for the caller."""
    try:
        query = TrainQuery(
            train_number=payload.train_number,
            source=payload.source,
            destination=payload.destination,
            journey_date=payload.journey_date,
            travel_class=payload.travel_class,
            quota=payload.quota,
        )
    except ValueError as exc:
        raise ApiError(status_code=422, code="validation_error", message=str(exc)) from None

    try:
        condition = AlertCondition(
            kind=payload.condition.kind,
            target_status=payload.condition.target_status,
            maximum_position=payload.condition.maximum_position,
        )
    except ValueError as exc:
        raise ApiError(status_code=422, code="validation_error", message=str(exc)) from None

    now = datetime.now(UTC)
    watch_id = f"w_{uuid4().hex[:16]}"
    new_watch = Watch(
        watch_id=watch_id,
        owner_id=user.uid,
        query=query,
        condition=condition,
        status=WatchStatus.ACTIVE,
        created_at=now,
        updated_at=now,
    )

    jobs = get_job_repository(request)
    await repo.save(new_watch)
    await _schedule_watch(new_watch, jobs, now=now)
    return _serialize_watch(new_watch)


@router.get("/{watch_id}", response_model=WatchResponse)
async def get_watch(
    watch_id: str,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    repo: Annotated[WatchRepository, Depends(get_repository)],
) -> Any:
    """Retrieve one watch owned by the caller."""
    stored = await repo.get(watch_id=watch_id, owner_id=user.uid)
    if stored is None:
        raise ApiError(status_code=404, code="not_found", message="Watch not found")
    require_owner(user=user, resource_owner_id=stored.owner_id)
    return _serialize_watch(stored)


@router.patch("/{watch_id}", response_model=WatchResponse)
async def update_watch_status(
    request: Request,
    watch_id: str,
    payload: UpdateWatchPayload,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    repo: Annotated[WatchRepository, Depends(get_repository)],
) -> Any:
    """Transition an owned watch between permitted lifecycle states."""
    stored = await repo.get(watch_id=watch_id, owner_id=user.uid)
    if stored is None:
        raise ApiError(status_code=404, code="not_found", message="Watch not found")
    require_owner(user=user, resource_owner_id=stored.owner_id)

    now = datetime.now(UTC)
    try:
        transitioned = stored.transition(payload.status, at=now)
    except ValueError as exc:
        raise ApiError(status_code=409, code="invalid_transition", message=str(exc)) from None

    resuming = stored.status is WatchStatus.PAUSED and transitioned.status is WatchStatus.ACTIVE
    jobs = get_job_repository(request) if resuming else None
    await repo.save(transitioned)
    if jobs is not None:
        await _schedule_watch(transitioned, jobs, now=now)
    return _serialize_watch(transitioned)


@router.delete("/{watch_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_watch(
    watch_id: str,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    repo: Annotated[WatchRepository, Depends(get_repository)],
) -> None:
    """Delete one watch owned by the caller."""
    stored = await repo.get(watch_id=watch_id, owner_id=user.uid)
    if stored is None:
        raise ApiError(status_code=404, code="not_found", message="Watch not found")
    require_owner(user=user, resource_owner_id=stored.owner_id)

    await repo.delete(watch_id=watch_id, owner_id=user.uid)
