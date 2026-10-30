"""Internal endpoints for Cloud Scheduler dispatcher and Cloud Tasks worker."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Any, cast

from fastapi import APIRouter, Depends, Header, Request, status
from pydantic import BaseModel, Field

from trainwatch.api.errors import ApiError
from trainwatch.config import AppSettings
from trainwatch.services.notification_dispatcher import NotificationDispatcherService
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


class ProcessNotificationsPayload(BaseModel):
    """Payload to trigger processing of outbox notification queue."""

    batch_size: int = Field(default=20, ge=1, le=100)
    lease_seconds: int = Field(default=60, ge=10, le=600)


class ProcessNotificationsResponse(BaseModel):
    """Outcome of notification dispatch execution."""

    claimed: int
    delivered: int
    failed: int
    retry_scheduled: int


def verify_internal_auth(
    request: Request,
    x_internal_token: Annotated[str | None, Header(alias="X-Internal-Token")] = None,
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    """Protect internal endpoints against unauthenticated external callers."""
    settings: AppSettings = getattr(request.app.state, "settings", AppSettings(app_env="test"))
    expected_val = settings.internal_service_key

    # In local/test environments without configured secret, allow testing
    if not expected_val and settings.app_env in {"local", "test"}:
        return

    if x_internal_token and expected_val and x_internal_token == expected_val:
        return

    bearer_val = ""
    if authorization and authorization.startswith("Bearer "):
        bearer_val = authorization.removeprefix("Bearer ").strip()

    if bearer_val and expected_val and bearer_val == expected_val:
        return

    if bearer_val and bearer_val.count(".") == 2:
        try:
            import google.oauth2.id_token
            from google.auth.transport import requests as google_requests

            claims = google.oauth2.id_token.verify_oauth2_token(  # type: ignore[no-untyped-call]
                bearer_val,
                google_requests.Request(),
            )
            iss = claims.get("iss", "")
            email = str(claims.get("email", "")).lower()
            email_verified = bool(claims.get("email_verified", False))
            project_id = (settings.project_id or "trainwatch").lower()

            if (
                iss in {"https://accounts.google.com", "accounts.google.com"}
                and email_verified
                and (
                    email.endswith(f"@{project_id}.iam.gserviceaccount.com")
                    or "trainwatch" in email
                    or email.startswith("sa-trainwatch-")
                )
            ):
                return
        except Exception:
            pass

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


def get_notification_dispatcher_service(request: Request) -> NotificationDispatcherService:
    """Retrieve injected notification dispatcher service from app state."""
    dispatcher = getattr(request.app.state, "notification_dispatcher_service", None)
    if dispatcher is None:
        raise ApiError(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            code="service_unavailable",
            message="Notification dispatcher service is not configured",
        )
    return cast(NotificationDispatcherService, dispatcher)


@router.post(
    "/dispatcher",
    response_model=DispatcherResponse,
    dependencies=[Depends(verify_internal_auth)],
)
@router.post(
    "/dispatch",
    response_model=DispatcherResponse,
    dependencies=[Depends(verify_internal_auth)],
    include_in_schema=False,
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


@router.post(
    "/notifications/process",
    response_model=ProcessNotificationsResponse,
    dependencies=[Depends(verify_internal_auth)],
)
@router.post(
    "/notifications/dispatch",
    response_model=ProcessNotificationsResponse,
    dependencies=[Depends(verify_internal_auth)],
    include_in_schema=False,
)
async def process_notifications(
    payload: ProcessNotificationsPayload,
    dispatcher: Annotated[
        NotificationDispatcherService,
        Depends(get_notification_dispatcher_service),
    ],
) -> Any:
    """Triggered by queue/scheduler to process and deliver pending outbox notifications."""
    res = await dispatcher.dispatch_pending(
        batch_size=payload.batch_size,
        lease_seconds=payload.lease_seconds,
        now=datetime.now(UTC),
    )
    return ProcessNotificationsResponse(
        claimed=res.claimed_count,
        delivered=res.delivered_count,
        failed=res.failed_count,
        retry_scheduled=res.retry_scheduled_count,
    )
