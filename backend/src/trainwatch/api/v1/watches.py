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
from trainwatch.domain.watch import IST, TrainQuery, Watch, WatchStatus, compute_departure_at
from trainwatch.ports.identity import AuthenticatedUser
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
    departure_time: str | None = None
    departure_at: datetime | None = None
    initial_avl_count: int | None = Field(default=None, ge=0)
    condition: AlertConditionPayload


class UpdateWatchPayload(BaseModel):
    """Permitted state or condition update for an existing watch."""

    status: WatchStatus | None = None
    condition: AlertConditionPayload | None = None


class QueryResponse(BaseModel):
    """Canonical train query response fields."""

    train_number: str
    source: str
    destination: str
    journey_date: date
    travel_class: str
    quota: str
    departure_time: str | None = None
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
    is_active: bool
    departure_at: datetime | None = None
    last_avl_count: int | None = None
    expired_reason: str | None = None
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
            departure_time=watch.query.departure_time,
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
        is_active=watch.is_active,
        departure_at=watch.effective_departure_at(),
        last_avl_count=watch.last_avl_count,
        expired_reason=watch.expired_reason,
        created_at=watch.created_at,
        updated_at=watch.updated_at,
    )


def _validate_avl_condition(payload: AlertConditionPayload) -> AlertCondition:
    """Enforce AVL-only threshold alerts on watch creation and edits."""
    condition = AlertCondition(
        kind=payload.kind,
        target_status=payload.target_status,
        maximum_position=payload.maximum_position,
    )
    if not condition.is_avl_only:
        raise ValueError("Only confirmed AVL seat threshold alerts (seats_below) are supported")
    return condition


async def _dissolve_if_due_and_persist(
    watch: Watch,
    *,
    repo: WatchRepository,
    now: datetime,
) -> Watch:
    """Ensure departed or legacy watches are disabled cleanly in persistence."""
    updated = watch.dissolve_if_due(at=now, today=now.astimezone(IST).date())
    if updated is not watch:
        await repo.save(updated)
    return updated


async def get_current_user(
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
) -> AuthenticatedUser:
    """Resolve caller identity using the application auth dependency."""
    dependency = request.app.state.current_user_dependency
    user: AuthenticatedUser = await dependency(request=request, authorization=authorization)
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


@router.get("", response_model=list[WatchResponse])
async def list_watches(
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    repo: Annotated[WatchRepository, Depends(get_repository)],
) -> Any:
    """Retrieve all watches owned by the caller."""
    now = datetime.now(UTC)
    watches = await repo.list_for_user(owner_id=user.uid)
    synced = [await _dissolve_if_due_and_persist(w, repo=repo, now=now) for w in watches]
    return [_serialize_watch(w) for w in synced]


@router.post("", response_model=WatchResponse, status_code=status.HTTP_201_CREATED)
async def create_watch(
    payload: CreateWatchPayload,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    repo: Annotated[WatchRepository, Depends(get_repository)],
) -> Any:
    """Create a new validated AVL seat availability watch for the caller."""
    try:
        query = TrainQuery(
            train_number=payload.train_number,
            source=payload.source,
            destination=payload.destination,
            journey_date=payload.journey_date,
            travel_class=payload.travel_class,
            quota=payload.quota,
            departure_time=payload.departure_time,
        )
    except ValueError as exc:
        raise ApiError(status_code=422, code="validation_error", message=str(exc)) from None

    try:
        condition = _validate_avl_condition(payload.condition)
    except ValueError as exc:
        raise ApiError(status_code=422, code="validation_error", message=str(exc)) from None

    now = datetime.now(UTC)
    departure_at = payload.departure_at or compute_departure_at(
        journey_date=query.journey_date,
        departure_time=query.departure_time,
    )
    watch_id = f"w_{uuid4().hex[:16]}"
    new_watch = Watch(
        watch_id=watch_id,
        owner_id=user.uid,
        query=query,
        condition=condition,
        status=WatchStatus.ACTIVE,
        created_at=now,
        updated_at=now,
        departure_at=departure_at,
        last_avl_count=payload.initial_avl_count,
    )
    if new_watch.is_departed(at=now):
        raise ApiError(
            status_code=422,
            code="validation_error",
            message="Cannot create an alert for a train that has already departed",
        )

    await repo.save(new_watch)
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
    synced = await _dissolve_if_due_and_persist(stored, repo=repo, now=datetime.now(UTC))
    return _serialize_watch(synced)


@router.patch("/{watch_id}", response_model=WatchResponse)
async def update_watch_status(
    watch_id: str,
    payload: UpdateWatchPayload,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    repo: Annotated[WatchRepository, Depends(get_repository)],
) -> Any:
    """Transition an owned watch between permitted lifecycle states or conditions."""
    stored = await repo.get(watch_id=watch_id, owner_id=user.uid)
    if stored is None:
        raise ApiError(status_code=404, code="not_found", message="Watch not found")
    require_owner(user=user, resource_owner_id=stored.owner_id)

    now = datetime.now(UTC)
    current = stored
    if payload.condition is not None:
        try:
            cond = _validate_avl_condition(payload.condition)
            current = current.update_condition(cond, at=now)
        except ValueError as exc:
            raise ApiError(status_code=422, code="validation_error", message=str(exc)) from None

    if payload.status is not None:
        try:
            current = current.transition(payload.status, at=now)
        except ValueError as exc:
            raise ApiError(status_code=409, code="invalid_transition", message=str(exc)) from None

    await repo.save(current)
    return _serialize_watch(current)


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
