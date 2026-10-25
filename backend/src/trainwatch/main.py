"""FastAPI application factory with credential-free dependency injection."""

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
) -> FastAPI:
    """Create an isolated application without initializing external clients."""
    resolved_settings = settings or AppSettings.from_environment()

    if resolved_settings.app_env in {"staging", "production"}:
        resolved_verifier = token_verifier or ProductionTokenVerifier()
        project_id = resolved_settings.project_id or (
            "trainwatch" if resolved_settings.app_env == "staging" else ""
        )
        if (watch_repository is None or device_repository is None) and project_id:
            from trainwatch.infrastructure.firestore.client import create_firestore_client
            from trainwatch.infrastructure.firestore.devices import FirestoreDeviceRepository
            from trainwatch.infrastructure.firestore.watches import FirestoreWatchRepository

            firestore_client = create_firestore_client(
                project_id=project_id,
                database_id=resolved_settings.firestore_database_id,
                allow_live_access=True,
            )
            if watch_repository is None:
                watch_repository = FirestoreWatchRepository(firestore_client)
            if device_repository is None:
                device_repository = FirestoreDeviceRepository(firestore_client)
    else:
        resolved_verifier = token_verifier or RejectingTokenVerifier()

    application = FastAPI(
        title="TrainWatch API",
        version="0.3.0",
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
