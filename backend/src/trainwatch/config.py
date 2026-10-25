"""Safe process configuration for the Phase 0 application."""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Literal, cast

AppEnvironment = Literal["local", "test", "staging", "production"]
LogLevel = Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]

_APP_ENVIRONMENTS = frozenset({"local", "test", "staging", "production"})
_LOG_LEVELS = frozenset({"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"})


@dataclass(frozen=True, slots=True)
class AppSettings:
    """Non-secret settings needed to identify the running process."""

    app_env: AppEnvironment = "local"
    log_level: LogLevel = "INFO"
    train_api_base_url: str = "https://example.invalid"
    internal_service_key: str = ""

    @classmethod
    def from_environment(cls) -> AppSettings:
        """Read and validate the explicitly supported process variables."""
        app_env = os.getenv("APP_ENV", "local").lower()
        log_level = os.getenv("LOG_LEVEL", "INFO").upper()
        train_api_base_url = os.getenv("TRAIN_API_BASE_URL", "https://example.invalid").strip()
        internal_service_key = os.getenv("INTERNAL_SERVICE_KEY", "").strip()

        if app_env not in _APP_ENVIRONMENTS:
            raise ValueError("APP_ENV must be one of: local, test, staging, production")
        if log_level not in _LOG_LEVELS:
            raise ValueError("LOG_LEVEL must be one of: DEBUG, INFO, WARNING, ERROR, CRITICAL")
        if not train_api_base_url.startswith(("https://", "http://")):
            raise ValueError("TRAIN_API_BASE_URL must be an HTTP(S) URL")

        return cls(
            app_env=cast(AppEnvironment, app_env),
            log_level=cast(LogLevel, log_level),
            train_api_base_url=train_api_base_url.rstrip("/"),
            internal_service_key=internal_service_key,
        )
