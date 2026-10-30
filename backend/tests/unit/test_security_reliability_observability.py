"""Unit and integration tests for Phase 9 security, reliability, and observability."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from unittest.mock import MagicMock

import pytest
from httpx import ASGITransport, AsyncClient

from tests.asgi import request
from trainwatch.api.logging import format_log_entry, sanitize_headers
from trainwatch.api.metrics import MetricsRegistry
from trainwatch.api.rate_limit import SlidingWindowRateLimiter, resolve_client_key
from trainwatch.config import AppSettings
from trainwatch.domain.alerts import AlertCondition, AlertKind
from trainwatch.domain.watch import TrainQuery, Watch, WatchStatus
from trainwatch.main import create_app
from trainwatch.ports.identity import AuthenticatedUser


class MockTokenVerifier:
    def __init__(self, users: dict[str, AuthenticatedUser]) -> None:
        self.users = users

    async def verify(self, bearer_value: str) -> AuthenticatedUser:
        if bearer_value in self.users:
            return self.users[bearer_value]
        from trainwatch.ports.identity import TokenVerificationError

        raise TokenVerificationError


class MockWatchRepository:
    def __init__(self) -> None:
        self.watches: dict[tuple[str, str], Watch] = {}

    async def get(self, *, watch_id: str, owner_id: str) -> Watch | None:
        return self.watches.get((owner_id, watch_id))

    async def save(self, watch: Watch) -> None:
        self.watches[(watch.owner_id, watch.watch_id)] = watch

    async def delete(self, *, watch_id: str, owner_id: str) -> None:
        self.watches.pop((owner_id, watch_id), None)


# --- 1. Root Health & Readiness Probes ---


@pytest.mark.anyio
async def test_root_liveness_and_readiness() -> None:
    app = create_app(AppSettings(app_env="test"))

    live_res = await request(app, "GET", "/healthz")
    assert live_res.status_code == 200
    assert live_res.json()["status"] == "ok"
    assert live_res.json()["service"] == "trainwatch-api"
    assert (
        live_res.headers.get("x-request-id") or live_res.headers.get("X-Request-ID")
    ) is not None

    ready_res = await request(app, "GET", "/readyz")
    assert ready_res.status_code == 200
    assert ready_res.json()["status"] == "ready"
    assert ready_res.json()["environment"] == "test"
    assert (
        ready_res.headers.get("x-request-id") or ready_res.headers.get("X-Request-ID")
    ) is not None


# --- 2. Metrics Tracker Unit & Endpoint Tests ---


def test_metrics_registry_recording_and_formatting() -> None:
    registry = MetricsRegistry()

    # Record normal requests
    registry.record_request(
        method="get",
        path="/api/v1/watches/watch-1234567890abcdef",
        status_code=200,
        duration_seconds=0.045,
    )
    registry.record_request(
        method="get",
        path="/api/v1/watches/watch-1234567890abcdef",
        status_code=200,
        duration_seconds=0.055,
    )
    registry.record_request(
        method="post",
        path="/api/v1/watches",
        status_code=201,
        duration_seconds=0.020,
    )
    registry.record_request(
        method="get",
        path="/",
        status_code=404,
        duration_seconds=0.001,
    )

    registry.increment("notifications_sent_total", 5)

    snap = registry.snapshot()
    assert len(snap["requests"]) == 3
    assert snap["counters"]["notifications_sent_total"] == 5

    prom_text = registry.to_prometheus_text()
    assert "http_requests_total" in prom_text
    assert 'method="GET",path="/api/v1/watches/{id}",status="200"' in prom_text
    assert 'domain_counters_total{name="notifications_sent_total"} 5' in prom_text

    # Reset
    registry.reset()
    assert len(registry.snapshot()["requests"]) == 0
    assert len(registry.snapshot()["counters"]) == 0


@pytest.mark.anyio
async def test_metrics_endpoint_exposition() -> None:
    registry = MetricsRegistry()
    registry.record_request(method="GET", path="/healthz", status_code=200, duration_seconds=0.01)
    app = create_app(AppSettings(app_env="test"), metrics_registry=registry)

    # Prometheus format by default
    prom_res = await request(app, "GET", "/api/v1/metrics")
    assert prom_res.status_code == 200
    assert "http_requests_total" in prom_res.text
    assert "text/plain" in prom_res.headers["content-type"]

    # JSON format when requested
    json_res = await request(
        app,
        "GET",
        "/api/v1/metrics",
        headers={"Accept": "application/json"},
    )
    assert json_res.status_code == 200
    data = json_res.json()
    assert "requests" in data
    assert "latencies" in data

    # When no metrics attached to state
    app_no_metrics = create_app(AppSettings(app_env="test"))
    app_no_metrics.state.metrics = None
    empty_res = await request(app_no_metrics, "GET", "/api/v1/metrics")
    assert empty_res.status_code == 200
    assert empty_res.text == ""


# --- 3. Structured Logging & Redaction Filter Tests ---


def test_sanitize_headers_redaction() -> None:
    headers = {
        "Authorization": "Bearer sensitive-auth-value",
        "X-Internal-Token": "placeholder",
        "Cookie": "session=sensitive-cookie",
        "Set-Cookie": "auth=secret-auth",
        "X-Api-Key": "placeholder",
        "FCM-Token": "placeholder",
        "Accept": "application/json",
        "User-Agent": "TrainWatch-Client/1.0",
        "X-Custom-Secret": "placeholder",
    }
    sanitized = sanitize_headers(headers)

    assert sanitized["Authorization"] == "[REDACTED]"
    assert sanitized["X-Internal-Token"] == "[REDACTED]"
    assert sanitized["Cookie"] == "[REDACTED]"
    assert sanitized["Set-Cookie"] == "[REDACTED]"
    assert sanitized["X-Api-Key"] == "[REDACTED]"
    assert sanitized["FCM-Token"] == "[REDACTED]"
    assert sanitized["X-Custom-Secret"] == "[REDACTED]"
    assert sanitized["Accept"] == "application/json"
    assert sanitized["User-Agent"] == "TrainWatch-Client/1.0"


def test_format_log_entry_structure() -> None:
    now = datetime.now(UTC)
    entry = format_log_entry(
        timestamp=now,
        severity="INFO",
        request_id="req-123",
        method="GET",
        path="/healthz",
        status_code=200,
        duration_ms=12.34,
        client_ip="127.0.0.1",
        extra={"user_id": "u-123"},
    )
    assert '"severity":"INFO"' in entry
    assert '"request_id":"req-123"' in entry
    assert '"duration_ms":12.34' in entry
    assert '"extra":{"user_id":"u-123"}' in entry


@pytest.mark.anyio
async def test_structured_logging_middleware_execution(caplog: pytest.LogCaptureFixture) -> None:
    import logging

    caplog.set_level(logging.INFO, logger="trainwatch.access")
    app = create_app(AppSettings(app_env="test"))

    # Successful call
    res = await request(app, "GET", "/healthz")
    assert res.status_code == 200
    assert any('"status_code":200' in r.message for r in caplog.records)

    # Error status code
    res_404 = await request(app, "GET", "/non-existent-route")
    assert res_404.status_code == 404
    assert any('"status_code":404' in r.message for r in caplog.records)


# --- 4. Rate Limiter Unit & Middleware Tests ---


def test_sliding_window_rate_limiter_logic() -> None:
    limiter = SlidingWindowRateLimiter(window_seconds=10)

    # 3 requests allowed with limit of 3
    ok1, rem1, _ = limiter.check("client_a", max_requests=3, now=100.0)
    assert ok1 is True
    assert rem1 == 2

    ok2, rem2, _ = limiter.check("client_a", max_requests=3, now=102.0)
    assert ok2 is True
    assert rem2 == 1

    ok3, rem3, _ = limiter.check("client_a", max_requests=3, now=104.0)
    assert ok3 is True
    assert rem3 == 0

    # 4th request exceeds limit
    ok4, rem4, reset4 = limiter.check("client_a", max_requests=3, now=105.0)
    assert ok4 is False
    assert rem4 == 0
    assert reset4 == 5  # 100 + 10 - 105 = 5

    # Request after oldest expires (at t=111.0)
    ok5, rem5, _ = limiter.check("client_a", max_requests=3, now=111.0)
    assert ok5 is True
    assert rem5 == 0

    # Reset
    limiter.reset()
    ok_reset, _, _ = limiter.check("client_a", max_requests=3, now=111.0)
    assert ok_reset is True


def test_resolve_client_key() -> None:
    # Authenticated user
    req_auth = MagicMock()
    req_auth.state.user = AuthenticatedUser(uid="user_abc")
    assert resolve_client_key(req_auth) == "user:user_abc"

    # Anonymous user with client IP
    req_anon = MagicMock()
    req_anon.state.user = None
    req_anon.client.host = "192.168.1.10"
    assert resolve_client_key(req_anon) == "ip:192.168.1.10"

    # Anonymous without client host
    req_no_client = MagicMock()
    req_no_client.state.user = None
    req_no_client.client = None
    assert resolve_client_key(req_no_client) == "ip:unknown"


@pytest.mark.anyio
async def test_rate_limit_middleware_enforcement() -> None:
    limiter = SlidingWindowRateLimiter(window_seconds=60)
    settings = AppSettings(
        app_env="test",
        rate_limit_per_minute=2,
        enable_rate_limiter=True,
    )
    app = create_app(settings)
    app.state.rate_limiter = limiter

    # Request 1 -> OK
    res1 = await request(app, "GET", "/api/v1/health/live")
    # Health routes are exempt from rate limit
    assert res1.status_code == 200

    # Rate limited endpoint (/api/v1/watches/{id})
    # Request 1
    r1 = await request(app, "GET", "/api/v1/watches/test-watch-1")
    assert r1.status_code in {401, 200, 404}
    assert r1.headers.get("x-ratelimit-limit") == "2"
    assert r1.headers.get("x-ratelimit-remaining") == "1"

    # Request 2
    r2 = await request(app, "GET", "/api/v1/watches/test-watch-1")
    assert r2.headers.get("x-ratelimit-remaining") == "0"

    # Request 3 -> 429
    r3 = await request(app, "GET", "/api/v1/watches/test-watch-1")
    assert r3.status_code == 429
    assert r3.json()["error"]["code"] == "rate_limit_exceeded"
    assert r3.headers.get("retry-after") is not None
    assert r3.headers.get("x-ratelimit-remaining") == "0"
    assert r3.headers.get("x-request-id") is not None

    # When rate limiter is disabled
    app_disabled = create_app(
        AppSettings(
            app_env="test",
            rate_limit_per_minute=1,
            enable_rate_limiter=False,
        )
    )
    app_disabled.state.rate_limiter = limiter
    for _ in range(5):
        resp = await request(app_disabled, "GET", "/api/v1/watches/test-watch-1")
        assert resp.status_code != 429


# --- 5. Request Timeout Middleware Tests ---


@pytest.mark.anyio
async def test_request_timeout_middleware() -> None:
    # Fast request passes
    app = create_app(AppSettings(app_env="test", request_timeout_seconds=5.0))
    res = await request(app, "GET", "/healthz")
    assert res.status_code == 200

    # Slow route that exceeds timeout
    app_slow = create_app(AppSettings(app_env="test", request_timeout_seconds=0.05))

    @app_slow.get("/slow-route")
    async def slow_route() -> dict[str, str]:
        await asyncio.sleep(0.2)
        return {"status": "too late"}

    slow_res = await request(app_slow, "GET", "/slow-route")
    assert slow_res.status_code == 504
    assert slow_res.json()["error"]["code"] == "request_timeout"
    assert slow_res.headers.get("x-request-id") is not None


# --- 6. Configuration Validation Tests ---


def test_app_settings_from_environment_extended() -> None:
    import os
    from unittest.mock import patch

    # Valid settings
    env = {
        "APP_ENV": "production",
        "LOG_LEVEL": "WARNING",
        "TRAIN_API_BASE_URL": "https://trains.example.com",
        "INTERNAL_SERVICE_KEY": "secret-key",
        "RATE_LIMIT_PER_MINUTE": "120",
        "REQUEST_TIMEOUT_SECONDS": "30.0",
        "ENABLE_RATE_LIMITER": "true",
    }
    with patch.dict(os.environ, env, clear=True):
        cfg = AppSettings.from_environment()
        assert cfg.app_env == "production"
        assert cfg.log_level == "WARNING"
        assert cfg.rate_limit_per_minute == 120
        assert cfg.request_timeout_seconds == 30.0
        assert cfg.enable_rate_limiter is True

    # Invalid rate limit
    with (
        patch.dict(os.environ, {"RATE_LIMIT_PER_MINUTE": "-5"}, clear=True),
        pytest.raises(ValueError, match="RATE_LIMIT_PER_MINUTE must be a positive integer"),
    ):
        AppSettings.from_environment()

    with (
        patch.dict(os.environ, {"RATE_LIMIT_PER_MINUTE": "abc"}, clear=True),
        pytest.raises(ValueError, match="RATE_LIMIT_PER_MINUTE must be a positive integer"),
    ):
        AppSettings.from_environment()

    # Invalid timeout
    with (
        patch.dict(os.environ, {"REQUEST_TIMEOUT_SECONDS": "0"}, clear=True),
        pytest.raises(ValueError, match="REQUEST_TIMEOUT_SECONDS must be a positive number"),
    ):
        AppSettings.from_environment()

    with (
        patch.dict(os.environ, {"REQUEST_TIMEOUT_SECONDS": "invalid"}, clear=True),
        pytest.raises(ValueError, match="REQUEST_TIMEOUT_SECONDS must be a positive number"),
    ):
        AppSettings.from_environment()


# --- 7. Authorization Coverage & Tenant Isolation Matrix ---


@pytest.mark.anyio
async def test_authorization_coverage_and_cross_user_isolation() -> None:
    user_a = AuthenticatedUser(uid="user_alice")
    user_b = AuthenticatedUser(uid="user_bob")
    verifier = MockTokenVerifier(
        {
            "ticket_alice": user_a,
            "ticket_bob": user_b,
        }
    )
    repo = MockWatchRepository()
    app = create_app(
        AppSettings(app_env="test"),
        token_verifier=verifier,
        watch_repository=repo,
    )

    # 1. Missing Authorization on watches endpoint -> 401
    res_no_auth = await request(app, "GET", "/api/v1/watches/watch_1")
    assert res_no_auth.status_code == 401
    assert res_no_auth.json()["error"]["code"] == "unauthorized"

    # 2. Invalid Token -> 401
    res_invalid_bearer = await request(
        app,
        "GET",
        "/api/v1/watches/watch_1",
        headers={"Authorization": "Bearer invalid_ticket"},
    )
    assert res_invalid_bearer.status_code == 401
    assert res_invalid_bearer.json()["error"]["code"] == "unauthorized"

    # 3. User A creates a watch
    now = datetime.now(UTC)
    watch_a = Watch(
        watch_id="watch_a_1",
        owner_id="user_alice",
        query=TrainQuery(
            train_number="12451",
            source="CNB",
            destination="NDLS",
            journey_date=now.date(),
            travel_class="3A",
            quota="GN",
        ),
        condition=AlertCondition(AlertKind.IMPROVES),
        status=WatchStatus.ACTIVE,
        created_at=now,
        updated_at=now,
    )
    await repo.save(watch_a)

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        # User A reads own watch -> 200
        res_a_read = await client.get(
            "/api/v1/watches/watch_a_1",
            headers={"Authorization": "Bearer ticket_alice"},
        )
        assert res_a_read.status_code == 200
        assert res_a_read.json()["watch_id"] == "watch_a_1"

        # User B attempts to read User A's watch -> 404 (safe isolation)
        res_b_read = await client.get(
            "/api/v1/watches/watch_a_1",
            headers={"Authorization": "Bearer ticket_bob"},
        )
        assert res_b_read.status_code == 404
        assert res_b_read.json()["error"]["code"] == "not_found"

        # User B attempts to delete User A's watch -> 404
        res_b_del = await client.delete(
            "/api/v1/watches/watch_a_1",
            headers={"Authorization": "Bearer ticket_bob"},
        )
        assert res_b_del.status_code == 404
        assert res_b_del.json()["error"]["code"] == "not_found"
