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

    @classmethod
    def from_environment(cls) -> AppSettings:
        """Read and validate the explicitly supported process variables."""
        app_env = os.getenv("APP_ENV", "local").lower()
        log_level = os.getenv("LOG_LEVEL", "INFO").upper()

        if app_env not in _APP_ENVIRONMENTS:
            raise ValueError("APP_ENV must be one of: local, test, staging, production")
        if log_level not in _LOG_LEVELS:
            raise ValueError("LOG_LEVEL must be one of: DEBUG, INFO, WARNING, ERROR, CRITICAL")

        return cls(
            app_env=cast(AppEnvironment, app_env),
            log_level=cast(LogLevel, log_level),
        )
