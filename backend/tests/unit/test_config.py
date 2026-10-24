"""Tests for credential-free process configuration."""

import pytest

from trainwatch.config import AppSettings


def test_settings_use_safe_local_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    """Use credential-free defaults when supported variables are absent."""
    monkeypatch.delenv("APP_ENV", raising=False)
    monkeypatch.delenv("LOG_LEVEL", raising=False)
    monkeypatch.delenv("TRAIN_API_BASE_URL", raising=False)

    assert AppSettings.from_environment() == AppSettings(
        app_env="local", log_level="INFO", train_api_base_url="https://example.invalid"
    )


def test_settings_normalize_supported_values(monkeypatch: pytest.MonkeyPatch) -> None:
    """Normalize accepted environment and logging values consistently."""
    monkeypatch.setenv("APP_ENV", "TEST")
    monkeypatch.setenv("LOG_LEVEL", "warning")
    monkeypatch.setenv("TRAIN_API_BASE_URL", "https://trains.example.test/")

    assert AppSettings.from_environment() == AppSettings(
        app_env="test", log_level="WARNING", train_api_base_url="https://trains.example.test"
    )


@pytest.mark.parametrize(
    ("name", "value", "message"),
    [
        ("APP_ENV", "unknown", "APP_ENV must be one of"),
        ("LOG_LEVEL", "verbose", "LOG_LEVEL must be one of"),
        ("TRAIN_API_BASE_URL", "not-a-url", "TRAIN_API_BASE_URL must be an HTTP"),
    ],
)
def test_settings_reject_unknown_values(
    monkeypatch: pytest.MonkeyPatch,
    name: str,
    value: str,
    message: str,
) -> None:
    """Reject unsupported configuration rather than silently accepting it."""
    monkeypatch.setenv(name, value)

    with pytest.raises(ValueError, match=message):
        AppSettings.from_environment()
