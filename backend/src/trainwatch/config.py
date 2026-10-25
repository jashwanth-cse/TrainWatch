"""Safe process configuration for the Phase 0 application."""

from __future__ import annotations

import os
from dataclasses import dataclass
from math import isfinite
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
    rate_limit_per_minute: int = 60
    request_timeout_seconds: float = 15.0
    enable_rate_limiter: bool = True

    @classmethod
    def from_environment(cls) -> AppSettings:
        """Read and validate the explicitly supported process variables."""
        app_env = os.getenv("APP_ENV", "local").lower()
        log_level = os.getenv("LOG_LEVEL", "INFO").upper()
        train_api_base_url = os.getenv("TRAIN_API_BASE_URL", "https://example.invalid").strip()
        internal_service_key = os.getenv("INTERNAL_SERVICE_KEY", "").strip()

        rate_limit_raw = os.getenv("RATE_LIMIT_PER_MINUTE", "60").strip()
        try:
            rate_limit_per_minute = int(rate_limit_raw)
            if rate_limit_per_minute <= 0:
                raise ValueError
        except ValueError as err:
            raise ValueError("RATE_LIMIT_PER_MINUTE must be a positive integer") from err

        timeout_raw = os.getenv("REQUEST_TIMEOUT_SECONDS", "15.0").strip()
        try:
            request_timeout_seconds = float(timeout_raw)
            if not isfinite(request_timeout_seconds) or request_timeout_seconds <= 0:
                raise ValueError
        except ValueError as err:
            raise ValueError("REQUEST_TIMEOUT_SECONDS must be a positive number") from err

        limiter_raw = os.getenv("ENABLE_RATE_LIMITER", "true").strip().lower()
        if limiter_raw in {"1", "true", "yes"}:
            enable_rate_limiter = True
        elif limiter_raw in {"0", "false", "no"}:
            enable_rate_limiter = False
        else:
            raise ValueError("ENABLE_RATE_LIMITER must be one of: 1, true, yes, 0, false, no")

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
            rate_limit_per_minute=rate_limit_per_minute,
            request_timeout_seconds=request_timeout_seconds,
            enable_rate_limiter=enable_rate_limiter,
        )
