"""Tests for credential-free process configuration."""

import pytest

from trainwatch.config import AppSettings


def test_settings_use_safe_local_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("APP_ENV", raising=False)
    monkeypatch.delenv("LOG_LEVEL", raising=False)

    assert AppSettings.from_environment() == AppSettings(app_env="local", log_level="INFO")


def test_settings_normalize_supported_values(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_ENV", "TEST")
    monkeypatch.setenv("LOG_LEVEL", "warning")

    assert AppSettings.from_environment() == AppSettings(app_env="test", log_level="WARNING")


@pytest.mark.parametrize(
    ("name", "value", "message"),
    [
        ("APP_ENV", "unknown", "APP_ENV must be one of"),
        ("LOG_LEVEL", "verbose", "LOG_LEVEL must be one of"),
    ],
)
def test_settings_reject_unknown_values(
    monkeypatch: pytest.MonkeyPatch,
    name: str,
    value: str,
    message: str,
) -> None:
    monkeypatch.setenv(name, value)

    with pytest.raises(ValueError, match=message):
        AppSettings.from_environment()
