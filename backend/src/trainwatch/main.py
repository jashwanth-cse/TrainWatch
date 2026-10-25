"""FastAPI application factory with credential-free dependency injection."""

from fastapi import FastAPI

from trainwatch.api.auth import RejectingTokenVerifier, build_current_user_dependency
from trainwatch.api.errors import install_error_handlers
from trainwatch.api.request_id import request_id_middleware
from trainwatch.api.v1 import router as api_v1_router
from trainwatch.config import AppSettings
from trainwatch.ports.identity import TokenVerifier
from trainwatch.ports.watches import WatchRepository


def create_app(
    settings: AppSettings | None = None,
    *,
    token_verifier: TokenVerifier | None = None,
    watch_repository: WatchRepository | None = None,
) -> FastAPI:
    """Create an isolated application without initializing external clients."""
    resolved_settings = settings or AppSettings.from_environment()
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
    application.middleware("http")(request_id_middleware)
    install_error_handlers(application)
    application.include_router(api_v1_router)
    return application


app = create_app()
