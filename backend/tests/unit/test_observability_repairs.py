"""Regression checks for bounded observability and caller rate limits."""

from typing import Annotated

import pytest
from fastapi import Depends
from httpx import ASGITransport, AsyncClient

from tests.asgi import request
from trainwatch.api.errors import ApiError
from trainwatch.api.metrics import MetricsRegistry
from trainwatch.api.rate_limit import SlidingWindowRateLimiter
from trainwatch.config import AppSettings
from trainwatch.main import create_app
from trainwatch.ports.identity import AuthenticatedUser, TokenVerificationError


class CountingVerifier:
    """Verify synthetic identities and count calls without external services."""

    def __init__(self) -> None:
        """Start with an empty verification history."""
        self.seen: list[str] = []

    async def verify(self, bearer_value: str) -> AuthenticatedUser:
        """Accept two user tickets and a second ticket for the first user."""
        self.seen.append(bearer_value)
        identities = {"alice": "user-a", "alice-new": "user-a", "bob": "user-b"}
        if bearer_value not in identities:
            raise TokenVerificationError
        return AuthenticatedUser(identities[bearer_value])


@pytest.mark.anyio
async def test_exception_metrics_record_one_500_and_latency() -> None:
    """Count an unhandled failure exactly once while preserving its safe response."""
    registry = MetricsRegistry()
    app = create_app(AppSettings(app_env="test"), metrics_registry=registry)

    @app.get("/failure/{name}")
    async def failure(name: str) -> None:
        """Raise a synthetic error after a dynamic route matches."""
        raise RuntimeError(name)

    response = await request(app, "GET", "/failure/private", raise_app_exceptions=False)
    assert response.status_code == 500
    assert "private" not in response.text
    snapshot = registry.snapshot()
    assert snapshot["requests"] == [
        {"method": "GET", "path": "/failure/{name}", "status_code": 500, "count": 1}
    ]
    assert len(snapshot["latencies"]) == 1
    assert snapshot["latencies"][0]["count"] == 1
    assert snapshot["latencies"][0]["total_seconds"] >= 0
    assert 'path="/failure/{name}",status="500"} 1' in registry.to_prometheus_text()


@pytest.mark.anyio
async def test_route_templates_bound_metrics_for_dynamic_and_unmatched_paths() -> None:
    """Arbitrary alphabetic paths and identifiers share bounded metric labels."""
    registry = MetricsRegistry()
    app = create_app(
        AppSettings(app_env="test", enable_rate_limiter=False), metrics_registry=registry
    )

    @app.get("/items/{name}")
    async def item(name: str) -> dict[str, str]:
        """Return a synthetic item for any path identifier."""
        return {"name": name}

    for suffix in ("alpha", "bravo", "charlie", "delta", "echo"):
        assert (await request(app, "GET", f"/items/{suffix}")).status_code == 200
        assert (await request(app, "GET", f"/{suffix}")).status_code == 404
        assert (await request(app, "GET", f"/a/{suffix}/c/d")).status_code == 404

    snapshot = registry.snapshot()
    assert snapshot["requests"] == [
        {"method": "GET", "path": "/items/{name}", "status_code": 200, "count": 5},
        {"method": "GET", "path": "/unmatched", "status_code": 404, "count": 10},
    ]
    assert len(snapshot["latencies"]) == 2


def test_rate_limiter_sweeps_idle_keys_without_resetting_active_limits() -> None:
    """Reclaim expired clients at the window boundary and retain active buckets."""
    limiter = SlidingWindowRateLimiter(window_seconds=10)
    assert limiter.check("idle", max_requests=1, now=100)[0]
    assert limiter.check("active", max_requests=1, now=105)[0]
    for _ in range(1022):
        limiter.check("sweeper", max_requests=2000, now=110)
    assert "idle" not in limiter._hits
    assert "active" in limiter._hits
    assert limiter.check("active", max_requests=1, now=110) == (False, 0, 5)
    assert limiter.check("idle", max_requests=1, now=110)[0]


@pytest.mark.anyio
async def test_rate_limits_use_verified_users_and_cache_identity_per_request() -> None:
    """Users behind one IP receive separate buckets and cannot reset them with new tokens."""
    verifier = CountingVerifier()
    app = create_app(AppSettings(app_env="test", rate_limit_per_minute=1), token_verifier=verifier)
    dependency = app.state.current_user_dependency

    @app.get("/protected")
    async def protected(user: Annotated[AuthenticatedUser, Depends(dependency)]) -> dict[str, str]:
        """Return only the verified identity from the production dependency."""
        return {"uid": user.uid}

    alice = await request(app, "GET", "/protected", headers={"Authorization": "Bearer alice"})
    bob = await request(app, "GET", "/protected", headers={"Authorization": "Bearer bob"})
    alice_again = await request(
        app, "GET", "/protected", headers={"Authorization": "Bearer alice-new"}
    )
    assert alice.status_code == bob.status_code == 200
    assert alice.json() == {"uid": "user-a"}
    assert bob.json() == {"uid": "user-b"}
    assert alice_again.status_code == 429
    assert verifier.seen == ["alice", "bob", "alice-new"]

    invalid = await request(app, "GET", "/protected", headers={"Authorization": "Bearer bad"})
    assert invalid.status_code == 401
    assert invalid.headers["www-authenticate"] == "Bearer"
    assert verifier.seen == ["alice", "bob", "alice-new", "bad"]
    anonymous = await request(app, "GET", "/protected")
    assert anonymous.status_code == 429


@pytest.mark.anyio
async def test_early_authentication_preserves_unexpected_errors() -> None:
    """Propagate dependency failures other than an unauthenticated response."""
    app = create_app(AppSettings(app_env="test"))

    async def unavailable(**kwargs: object) -> AuthenticatedUser:
        """Simulate an authentication service failure instead of an invalid token."""
        raise ApiError(status_code=503, code="unavailable", message="Unavailable")

    app.state.current_user_dependency = unavailable
    with pytest.raises(ApiError) as error:
        await request(app, "GET", "/protected", headers={"Authorization": "Bearer alice"})
    assert error.value.status_code == 503


@pytest.mark.anyio
async def test_early_authentication_is_bounded_by_request_timeout() -> None:
    """Apply the request deadline to identity verification before rate limiting."""
    import asyncio

    class SlowVerifier:
        """Delay synthetic verification past the request timeout."""

        async def verify(self, bearer_value: str) -> AuthenticatedUser:
            """Return a trusted identity only after the deadline has elapsed."""
            await asyncio.sleep(0.2)
            return AuthenticatedUser("user-a")

    app = create_app(
        AppSettings(app_env="test", request_timeout_seconds=0.01), token_verifier=SlowVerifier()
    )
    response = await request(app, "GET", "/protected", headers={"Authorization": "Bearer alice"})
    assert response.status_code == 504
    assert response.json()["error"]["code"] == "request_timeout"
    assert response.headers["x-request-id"]


@pytest.mark.anyio
@pytest.mark.parametrize(("bearer", "first_status"), [("alice", 503), ("bad", 401)])
async def test_auth_attempt_budget_blocks_verification_and_recovers_after_expiry(
    monkeypatch: pytest.MonkeyPatch, bearer: str, first_status: int
) -> None:
    """Bound verifier work for valid/invalid tickets even after the caller quota is full."""
    monkeypatch.setattr("trainwatch.api.rate_limit.time.time", lambda: 100.0)
    verifier = CountingVerifier()
    app = create_app(
        AppSettings(app_env="test", rate_limit_per_minute=1, auth_attempts_per_minute=2),
        token_verifier=verifier,
    )
    responses = [
        await request(
            app, "GET", "/api/v1/watches/example", headers={"Authorization": f"Bearer {bearer}"}
        )
        for _ in range(4)
    ]
    assert [response.status_code for response in responses] == [first_status, 429, 429, 429]
    assert verifier.seen == [bearer, bearer]
    # The first denial uses the caller bucket; later denials use the auth IP budget.
    assert responses[1].headers["x-ratelimit-limit"] == "1"
    assert responses[-1].headers["x-ratelimit-limit"] == "2"
    assert responses[-1].headers["x-ratelimit-remaining"] == "0"
    assert responses[-1].headers["retry-after"] == "60"
    assert responses[-1].headers["x-request-id"]
    assert responses[-1].json()["error"]["code"] == "rate_limit_exceeded"

    # Requests without credentials still use the existing anonymous IP quota.
    anonymous = await request(app, "GET", "/api/v1/watches/example")
    assert anonymous.status_code == (401 if bearer == "alice" else 429)
    assert verifier.seen == [bearer, bearer]

    monkeypatch.setattr("trainwatch.api.rate_limit.time.time", lambda: 160.0)
    recovered = await request(
        app, "GET", "/api/v1/watches/example", headers={"Authorization": f"Bearer {bearer}"}
    )
    assert recovered.status_code == first_status
    assert verifier.seen == [bearer, bearer, bearer]


@pytest.mark.anyio
async def test_auth_attempt_budgets_are_isolated_by_client_ip() -> None:
    """One IP exhausting verification capacity does not consume another IP's budget."""
    verifier = CountingVerifier()
    app = create_app(
        AppSettings(app_env="test", auth_attempts_per_minute=1), token_verifier=verifier
    )
    for client_ip in ("192.0.2.1", "192.0.2.2"):
        async with AsyncClient(
            transport=ASGITransport(app=app, client=(client_ip, 12345)), base_url="http://test"
        ) as client:
            first = await client.get(
                "/api/v1/watches/example", headers={"Authorization": "Bearer bad"}
            )
            blocked = await client.get(
                "/api/v1/watches/example", headers={"Authorization": "Bearer bad"}
            )
        assert first.status_code == 401
        assert blocked.status_code == 429
    assert verifier.seen == ["bad", "bad"]


@pytest.mark.anyio
async def test_auth_attempt_budget_preserves_exemptions_and_disabled_limiting() -> None:
    """Health requests bypass auth work and disabling the limiter bypasses both quotas."""
    verifier = CountingVerifier()
    settings = AppSettings(app_env="test", auth_attempts_per_minute=1)
    app = create_app(settings, token_verifier=verifier)
    for _ in range(2):
        health = await request(app, "GET", "/healthz", headers={"Authorization": "Bearer bad"})
        assert health.status_code == 200
    assert verifier.seen == []
    assert not app.state.rate_limiter._hits

    disabled = create_app(
        AppSettings(app_env="test", auth_attempts_per_minute=1, enable_rate_limiter=False),
        token_verifier=verifier,
    )
    for _ in range(2):
        response = await request(
            disabled, "GET", "/api/v1/watches/example", headers={"Authorization": "Bearer bad"}
        )
        assert response.status_code == 401
        assert "x-ratelimit-limit" not in response.headers
    assert verifier.seen == ["bad", "bad"]
    assert not disabled.state.rate_limiter._hits


@pytest.mark.parametrize("value", ["0", "-1", "abc", ""])
def test_settings_reject_invalid_auth_attempt_budgets(
    monkeypatch: pytest.MonkeyPatch, value: str
) -> None:
    """Reject authentication-attempt settings that do not define a positive budget."""
    monkeypatch.setenv("AUTH_ATTEMPTS_PER_MINUTE", value)
    with pytest.raises(ValueError, match="AUTH_ATTEMPTS_PER_MINUTE must be a positive integer"):
        AppSettings.from_environment()


def test_settings_read_auth_attempt_budget(monkeypatch: pytest.MonkeyPatch) -> None:
    """Read the independent budget from the environment with whitespace normalization."""
    monkeypatch.setenv("AUTH_ATTEMPTS_PER_MINUTE", " 120 ")
    assert AppSettings.from_environment().auth_attempts_per_minute == 120


@pytest.mark.parametrize("value", ["nan", "NaN", "inf", "+Infinity", "-inf"])
def test_settings_reject_nonfinite_timeouts(monkeypatch: pytest.MonkeyPatch, value: str) -> None:
    """Timeout settings must enforce a finite positive request deadline."""
    monkeypatch.setenv("REQUEST_TIMEOUT_SECONDS", value)
    with pytest.raises(ValueError, match="REQUEST_TIMEOUT_SECONDS"):
        AppSettings.from_environment()


@pytest.mark.parametrize(
    ("value", "expected"),
    [("1", True), (" true ", True), ("YES", True), ("0", False), ("False ", False), ("no", False)],
)
def test_settings_normalize_explicit_limiter_values(
    monkeypatch: pytest.MonkeyPatch, value: str, expected: bool
) -> None:
    """Recognize the documented true and false spellings after trimming whitespace."""
    monkeypatch.setenv("ENABLE_RATE_LIMITER", value)
    assert AppSettings.from_environment().enable_rate_limiter is expected


@pytest.mark.parametrize("value", ["ture", "on", "enabled", "", " "])
def test_settings_reject_unknown_limiter_values(
    monkeypatch: pytest.MonkeyPatch, value: str
) -> None:
    """Configuration typos must fail startup rather than disable rate limiting."""
    monkeypatch.setenv("ENABLE_RATE_LIMITER", value)
    with pytest.raises(ValueError, match="ENABLE_RATE_LIMITER"):
        AppSettings.from_environment()
