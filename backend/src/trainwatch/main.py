"""FastAPI application factory with credential-free dependency injection."""

import asyncio
from datetime import datetime
from typing import Any

from fastapi import FastAPI

from trainwatch.api.auth import (
    ProductionTokenVerifier,
    RejectingTokenVerifier,
    build_current_user_dependency,
)
from trainwatch.api.errors import install_error_handlers
from trainwatch.api.logging import structured_logging_middleware
from trainwatch.api.metrics import MetricsRegistry
from trainwatch.api.rate_limit import (
    SlidingWindowRateLimiter,
    rate_limit_middleware,
)
from trainwatch.api.request_id import request_id_middleware
from trainwatch.api.timeout import timeout_middleware
from trainwatch.api.v1 import router as api_v1_router
from trainwatch.config import AppSettings
from trainwatch.ports.devices import DeviceRepository
from trainwatch.ports.identity import TokenVerifier
from trainwatch.ports.watches import WatchRepository
from trainwatch.services.notification_dispatcher import NotificationDispatcherService
from trainwatch.services.worker import DispatcherService, WorkerService


class FirestoreWatchDispatcher:
    """Dispatches active watch checks in production and staging."""

    def __init__(
        self,
        client: Any,
        *,
        availability_provider: Any = None,
        outbox: Any = None,
        notification_dispatcher: Any = None,
    ) -> None:
        self._client = client
        self._availability_provider = availability_provider
        self._outbox = outbox
        self._notification_dispatcher = notification_dispatcher

    async def dispatch_due_jobs(self, *, now: datetime, limit: int = 50) -> int:
        if limit <= 0:
            return 0

        from google.cloud.firestore_v1.base_query import FieldFilter

        # createdAt exists on every schema-v1 watch; lastCheckedAt does not.
        # Persist the cursor so cold starts also progress beyond the first page.
        cursor_ref = self._client.collection("dispatcherState").document("reminders")
        try:
            cursor = (await cursor_ref.get()).to_dict() or {}
            query = (
                self._client.collection_group("reminders")
                .where(filter=FieldFilter("status", "==", "active"))  # type: ignore[no-untyped-call]
                .order_by("createdAt", direction="DESCENDING")
                .order_by("__name__", direction="DESCENDING")
                .limit(limit)
            )
            if cursor:
                query = query.start_after(
                    {
                        "createdAt": cursor["createdAt"],
                        "__name__": self._client.document(cursor["path"]),
                    }
                )
            docs = await query.get()
        except Exception:
            return 0

        from trainwatch.domain.alerts import (
            AvlThresholdEvaluator,
            _extract_available_seats,
            compose_avl_alert_message,
        )
        from trainwatch.domain.availability import AvailabilitySnapshot, AvailabilityStatus
        from trainwatch.domain.watch import IST
        from trainwatch.infrastructure.firestore.watches import _decode
        from trainwatch.ports.notifications import NotificationOutboxItem

        async def process_doc(doc: Any) -> int:
            data = doc.to_dict() or {}
            if data.get("status") != "active":
                return 0

            if self._availability_provider is None or self._outbox is None:
                return 1

            doc_ref = getattr(doc, "reference", None)
            try:
                owner_id = str(data.get("ownerId") or "")
                if not owner_id:
                    parent_col = getattr(doc_ref, "parent", None)
                    parent_doc = getattr(parent_col, "parent", None)
                    owner_id = str(getattr(parent_doc, "id", "") or "unknown")

                watch_id = str(getattr(doc, "id", "") or data.get("watchId", "unknown"))
                watch = _decode(data, watch_id=watch_id, owner_id=owner_id)
                dissolved = watch.dissolve_if_due(at=now, today=now.astimezone(IST).date())
                if dissolved is not watch:
                    if hasattr(doc_ref, "update"):
                        await doc_ref.update(  # type: ignore[union-attr]
                            {
                                "status": dissolved.status.value,
                                "isActive": False,
                                "expiredReason": dissolved.expired_reason,
                                "expiredAt": now.isoformat(),
                                "updatedAt": now,
                            }
                        )
                    return 1

                obs = await self._availability_provider.fetch(watch.query)
                if obs.snapshot is None:
                    return 1

                snap = obs.snapshot
                seats = _extract_available_seats(snap.raw_availability)
                prev_data = data.get("lastObservation")
                prev_snap = None
                if isinstance(prev_data, dict):
                    prev_snap = AvailabilitySnapshot(
                        status=AvailabilityStatus(str(prev_data.get("status", "UNKNOWN"))),
                        raw_availability=str(prev_data.get("rawAvailability", "")),
                        observed_at=now,
                        position=prev_data.get("position"),
                    )

                assert watch.condition.maximum_position is not None
                eval_result = AvlThresholdEvaluator.evaluate(
                    threshold=watch.condition.maximum_position,
                    previous_snapshot=prev_snap,
                    current_snapshot=snap,
                    fallback_previous_avl=watch.last_avl_count,
                )
                triggered = eval_result.should_alert

                status_val = snap.status.value
                seat_key = (
                    eval_result.current_avl if eval_result.current_avl is not None else (seats or 0)
                )
                previous_marker = (
                    prev_data.get("observedAt") or data.get("lastCheckedAt") or "baseline"
                    if isinstance(prev_data, dict)
                    else "baseline"
                )
                idempotency_key = (
                    f"alert:{watch.watch_id}:{previous_marker}:{status_val}:{seat_key}"
                )
                if data.get("lastAlertedKey") == idempotency_key:
                    triggered = False

                if triggered:
                    alert_title, alert_body = compose_avl_alert_message(
                        train_number=watch.query.train_number,
                        travel_class=watch.query.travel_class,
                        journey_date=watch.query.journey_date,
                        threshold=watch.condition.maximum_position,
                        evaluation=eval_result,
                        snapshot=snap,
                    )
                    outbox_data: dict[str, str] = {
                        "type": "alert_triggered",
                        "watch_id": watch.watch_id,
                        "train_number": watch.query.train_number,
                        "journey_date": str(watch.query.journey_date),
                        "travel_class": watch.query.travel_class,
                        "status": status_val,
                        "event_kind": eval_result.event_kind.value,
                    }
                    outbox_item = NotificationOutboxItem(
                        idempotency_key=idempotency_key,
                        owner_id=watch.owner_id,
                        watch_id=watch.watch_id,
                        title=alert_title,
                        body=alert_body,
                        created_at=now,
                        data=outbox_data,
                    )
                    await self._outbox.save_notification(outbox_item)

                updated_watch = watch.record_avl_observation(
                    current_avl=seats if snap.status is AvailabilityStatus.AVAILABLE else None,
                    alerted=triggered,
                    at=now,
                )
                update_fields: dict[str, Any] = {
                    "isActive": updated_watch.is_active,
                    "departureAt": updated_watch.effective_departure_at(),
                    "lastAvlCount": updated_watch.last_avl_count,
                    "lastAlertedAvl": updated_watch.last_alerted_avl,
                    "lastCheckedAt": now.isoformat(),
                    "lastObservation": {
                        "status": status_val,
                        "rawAvailability": snap.raw_availability,
                        "position": snap.position,
                        "observedAt": snap.observed_at.isoformat(),
                    },
                }
                if triggered:
                    update_fields["lastAlertedKey"] = idempotency_key

                if hasattr(doc_ref, "update"):
                    await doc_ref.update(update_fields)  # type: ignore[union-attr]
            except Exception:
                return 1
            return 1

        active_count = 0
        for offset in range(0, len(docs), 5):
            batch = docs[offset : offset + 5]
            active_count += sum(await asyncio.gather(*(process_doc(doc) for doc in batch)))
            # Advance only completed batches. Failures retain their alert baseline
            # and get another attempt on the next sweep without blocking others.
            last_doc = batch[-1]
            await cursor_ref.set(
                {"createdAt": last_doc.to_dict()["createdAt"], "path": last_doc.reference.path}
            )
        if not docs:
            await cursor_ref.set({})

        if self._notification_dispatcher is not None:
            await self._notification_dispatcher.dispatch_pending(
                batch_size=50, lease_seconds=60, now=now
            )

        return active_count


def create_app(
    settings: AppSettings | None = None,
    *,
    token_verifier: TokenVerifier | None = None,
    watch_repository: WatchRepository | None = None,
    device_repository: DeviceRepository | None = None,
    dispatcher_service: DispatcherService | None = None,
    worker_service: WorkerService | None = None,
    notification_dispatcher_service: NotificationDispatcherService | None = None,
    metrics_registry: MetricsRegistry | None = None,
    rate_limiter: SlidingWindowRateLimiter | None = None,
    smart_routing_engine: Any = None,
) -> FastAPI:
    """Create an isolated application without initializing external clients."""
    resolved_settings = settings or AppSettings.from_environment()

    if resolved_settings.app_env in {"staging", "production"}:
        resolved_verifier = token_verifier or ProductionTokenVerifier()
        project_id = resolved_settings.project_id or (
            "trainwatch" if resolved_settings.app_env == "staging" else ""
        )
        if (watch_repository is None or device_repository is None) and project_id:
            from trainwatch.infrastructure.fcm.sender import FirebaseFcmSender
            from trainwatch.infrastructure.firestore.client import create_firestore_client
            from trainwatch.infrastructure.firestore.devices import FirestoreDeviceRepository
            from trainwatch.infrastructure.firestore.outbox import FirestoreNotificationOutbox
            from trainwatch.infrastructure.firestore.watches import FirestoreWatchRepository
            from trainwatch.services.notification_dispatcher import NotificationDispatcherService

            firestore_client = create_firestore_client(
                project_id=project_id,
                database_id=resolved_settings.firestore_database_id,
                allow_live_access=True,
            )
            if watch_repository is None:
                watch_repository = FirestoreWatchRepository(firestore_client)
            if device_repository is None:
                device_repository = FirestoreDeviceRepository(firestore_client)
            if notification_dispatcher_service is None:
                outbox = FirestoreNotificationOutbox(firestore_client)
                fcm_sender = FirebaseFcmSender()
                notification_dispatcher_service = NotificationDispatcherService(
                    outbox=outbox,
                    device_repository=device_repository,
                    fcm_sender=fcm_sender,
                )
            if dispatcher_service is None:
                from trainwatch.infrastructure.train_api.client import (
                    DreamDestinyClient,
                    create_train_api_http_client,
                )

                http_client = create_train_api_http_client(
                    base_url=resolved_settings.train_api_base_url
                )
                availability_provider = DreamDestinyClient(http_client)
                dispatcher_service = FirestoreWatchDispatcher(
                    firestore_client,
                    availability_provider=availability_provider,
                    outbox=outbox,
                    notification_dispatcher=notification_dispatcher_service,
                )  # type: ignore[assignment]
    else:
        resolved_verifier = token_verifier or RejectingTokenVerifier()

    application = FastAPI(
        title="TrainWatch API",
        version="2.3.0",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    application.state.settings = resolved_settings
    application.state.current_user_dependency = build_current_user_dependency(resolved_verifier)
    application.state.watch_repository = watch_repository
    application.state.device_repository = device_repository
    application.state.dispatcher_service = dispatcher_service
    application.state.worker_service = worker_service
    application.state.notification_dispatcher_service = notification_dispatcher_service
    application.state.metrics = metrics_registry or MetricsRegistry()
    application.state.rate_limiter = rate_limiter or SlidingWindowRateLimiter(window_seconds=60)
    application.state.smart_routing_engine = smart_routing_engine

    @application.get("/healthz", tags=["health"])
    def root_liveness() -> dict[str, str]:
        return {
            "status": "ok",
            "service": "trainwatch-api",
            "environment": resolved_settings.app_env,
        }

    @application.get("/readyz", tags=["health"])
    def root_readiness() -> dict[str, str]:
        return {
            "status": "ready",
            "service": "trainwatch-api",
            "environment": resolved_settings.app_env,
        }

    # Middlewares execute from bottom to top (innermost to outermost)
    application.middleware("http")(timeout_middleware)
    application.middleware("http")(rate_limit_middleware)
    application.middleware("http")(structured_logging_middleware)
    application.middleware("http")(request_id_middleware)

    install_error_handlers(application)
    application.include_router(api_v1_router)
    return application


app = create_app()
