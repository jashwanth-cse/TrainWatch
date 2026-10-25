"""Internal endpoints for Cloud Scheduler dispatcher and Cloud Tasks worker."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Any, cast

from fastapi import APIRouter, Depends, Header, Request, status
from pydantic import BaseModel, Field

from trainwatch.api.errors import ApiError
from trainwatch.config import AppSettings
from trainwatch.services.worker import DispatcherService, WorkerService

router = APIRouter(prefix="/internal", tags=["internal"])


class ProcessJobPayload(BaseModel):
    """Payload sent by Cloud Tasks queue to process a single reminder job."""

    job_id: str = Field(min_length=1)


class DispatcherResponse(BaseModel):
    """Response returned after running due-job query and enqueuing tasks."""

    dispatched: int


class ProcessJobResponse(BaseModel):
    """Result of processing a single reminder job."""

    job_id: str
    status: str
    alert_triggered: bool
    error: str | None = None


def verify_internal_auth(
    request: Request,
    internal_credential: Annotated[str | None, Header(alias="X-Internal-Token")] = None,
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    """Protect internal endpoints against unauthenticated external callers."""
    settings: AppSettings = getattr(request.app.state, "settings", AppSettings(app_env="test"))
    expected_credential = settings.internal_service_key

    # In local/test environments without configured secret, allow testing
    if not expected_credential and settings.app_env in {"local", "test"}:
        return

    supplied_credential = internal_credential
    if not supplied_credential and authorization and authorization.startswith("Bearer "):
        supplied_credential = authorization.removeprefix("Bearer ").strip()

    if not supplied_credential or supplied_credential != expected_credential:
        raise ApiError(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="unauthorized",
            message="Valid internal service credentials required",
        )


def get_dispatcher_service(request: Request) -> DispatcherService:
    """Retrieve injected dispatcher service from app state."""
    dispatcher = getattr(request.app.state, "dispatcher_service", None)
    if dispatcher is None:
        raise ApiError(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            code="service_unavailable",
            message="Dispatcher service is not configured",
        )
    return cast(DispatcherService, dispatcher)


def get_worker_service(request: Request) -> WorkerService:
    """Retrieve injected worker service from app state."""
    worker = getattr(request.app.state, "worker_service", None)
    if worker is None:
        raise ApiError(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            code="service_unavailable",
            message="Worker service is not configured",
        )
    return cast(WorkerService, worker)


@router.post(
    "/dispatcher",
    response_model=DispatcherResponse,
    dependencies=[Depends(verify_internal_auth)],
)
async def trigger_dispatcher(
    dispatcher: Annotated[DispatcherService, Depends(get_dispatcher_service)],
) -> Any:
    """Triggered by Cloud Scheduler to query due jobs and push tasks to queue."""
    dispatched = await dispatcher.dispatch_due_jobs(now=datetime.now(UTC))
    return DispatcherResponse(dispatched=dispatched)


@router.post(
    "/worker/process",
    response_model=ProcessJobResponse,
    dependencies=[Depends(verify_internal_auth)],
)
async def process_job(
    payload: ProcessJobPayload,
    worker: Annotated[WorkerService, Depends(get_worker_service)],
) -> Any:
    """Triggered by Cloud Tasks queue to process a single reminder job."""
    result = await worker.process_job(job_id=payload.job_id, now=datetime.now(UTC))
    return ProcessJobResponse(
        job_id=result.job_id,
        status=result.status,
        alert_triggered=result.alert_triggered,
        error=result.error,
    )
