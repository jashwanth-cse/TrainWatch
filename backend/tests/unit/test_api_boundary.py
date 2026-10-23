"""Offline tests for request IDs, sanitized errors, auth, and ownership."""

from typing import Annotated

import pytest
from fastapi import Depends, FastAPI, HTTPException, Query
from pydantic import BaseModel
from starlette.requests import Request

from tests.asgi import request
from trainwatch.api.auth import RejectingTokenVerifier
from trainwatch.api.errors import ApiError, _request_id
from trainwatch.api.ownership import require_owner
from trainwatch.api.request_id import REQUEST_ID_HEADER, resolve_request_id
from trainwatch.config import AppSettings
from trainwatch.main import create_app
from trainwatch.ports.identity import AuthenticatedUser, TokenVerificationError


class FakeTokenVerifier:
    """Deterministic verifier used only by in-process tests."""

    def __init__(self, tokens: dict[str, str]) -> None:
        self.tokens = tokens
        self.seen: list[str] = []

    async def verify(self, bearer_value: str) -> AuthenticatedUser:
        """Map synthetic tokens to synthetic users."""
        self.seen.append(bearer_value)
        try:
            uid = self.tokens[bearer_value]
        except KeyError:
            raise TokenVerificationError from None
        return AuthenticatedUser(uid)


class ClaimedIdentity(BaseModel):
    """Untrusted body used to prove identity cannot be overridden."""

    uid: str


def protected_app(
    verifier: FakeTokenVerifier | None = None,
) -> tuple[FastAPI, FakeTokenVerifier]:
    """Create test-only protected routes around the production dependency."""
    resolved = verifier or FakeTokenVerifier({"valid-ticket": "user-a"})
    app = create_app(AppSettings(app_env="test"), token_verifier=resolved)
    current_user = app.state.current_user_dependency

    @app.post("/test/protected")
    async def protected(
        body: ClaimedIdentity,
        user: Annotated[AuthenticatedUser, Depends(current_user)],
    ) -> dict[str, str]:
        del body
        return {"uid": user.uid}

    @app.get("/test/owned/{owner_id}")
    async def owned(
        owner_id: str,
        user: Annotated[AuthenticatedUser, Depends(current_user)],
    ) -> dict[str, str]:
        require_owner(user=user, resource_owner_id=owner_id)
        return {"owner_id": owner_id}

    return app, resolved


@pytest.mark.anyio
async def test_request_ids_preserve_safe_values_and_replace_unsafe_values() -> None:
    """Propagate only bounded opaque request identifiers."""
    app = create_app(AppSettings(app_env="test"))
    safe = await request(
        app, "GET", "/api/v1/health/live", headers={REQUEST_ID_HEADER: "req-123.test"}
    )
    unsafe = await request(
        app, "GET", "/api/v1/health/live", headers={REQUEST_ID_HEADER: "user@example.com"}
    )
    missing = await request(app, "GET", "/api/v1/health/live")

    assert safe.headers[REQUEST_ID_HEADER.lower()] == "req-123.test"
    assert unsafe.headers[REQUEST_ID_HEADER.lower()] != "user@example.com"
    assert len(unsafe.headers[REQUEST_ID_HEADER.lower()]) == 32
    assert len(missing.headers[REQUEST_ID_HEADER.lower()]) == 32
    assert resolve_request_id("a" * 65) != "a" * 65


def test_request_id_fallback_does_not_require_middleware_state() -> None:
    """Keep direct handler construction defensive."""
    raw_request = Request({"type": "http", "method": "GET", "path": "/", "headers": []})
    assert _request_id(raw_request) == "unavailable"


@pytest.mark.anyio
@pytest.mark.parametrize(
    "authorization",
    [None, "Basic abc", "Bearer", "Bearer ", "Bearer two parts", f"Bearer {'x' * 8193}"],
)
async def test_missing_or_malformed_authorization_is_sanitized(
    authorization: str | None,
) -> None:
    """Reject malformed credentials without echoing their content."""
    app, verifier = protected_app()
    headers = {} if authorization is None else {"Authorization": authorization}
    response = await request(
        app, "POST", "/test/protected", headers=headers, json_body={"uid": "attacker"}
    )

    assert response.status_code == 401
    assert response.json()["error"] == {
        "code": "unauthorized",
        "message": "Authentication required",
    }
    assert "attacker" not in response.text
    assert verifier.seen == []


@pytest.mark.anyio
async def test_invalid_verified_token_is_sanitized() -> None:
    """Map verifier failures to the same public authentication response."""
    app, verifier = protected_app()
    response = await request(
        app,
        "POST",
        "/test/protected",
        headers={"Authorization": "Bearer invalid-secret-token"},
        json_body={"uid": "user-a"},
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthorized"
    assert "invalid-secret-token" not in response.text
    assert verifier.seen == ["invalid-secret-token"]


@pytest.mark.anyio
async def test_authenticated_uid_comes_only_from_verified_token() -> None:
    """Ignore an untrusted body claim when establishing user identity."""
    app, verifier = protected_app()
    response = await request(
        app,
        "POST",
        "/test/protected",
        headers={"Authorization": "Bearer valid-ticket"},
        json_body={"uid": "user-b"},
    )

    assert response.status_code == 200
    assert response.json() == {"uid": "user-a"}
    assert verifier.seen == ["valid-ticket"]


@pytest.mark.anyio
async def test_cross_user_access_is_hidden_as_not_found() -> None:
    """Return a non-enumerating result for another user's resource."""
    app, _ = protected_app()
    headers = {"Authorization": "Bearer valid-ticket"}
    own = await request(app, "GET", "/test/owned/user-a", headers=headers)
    other = await request(app, "GET", "/test/owned/user-b", headers=headers)

    assert own.status_code == 200
    assert other.status_code == 404
    assert other.json()["error"] == {"code": "not_found", "message": "Resource not found"}
    assert "user-b" not in other.text


@pytest.mark.anyio
async def test_default_verifier_rejects_without_external_access() -> None:
    """Keep protected access closed when no Firebase adapter is configured."""
    app = create_app(AppSettings(app_env="test"))
    dependency = app.state.current_user_dependency

    @app.get("/test/default-auth")
    async def protected(
        user: Annotated[AuthenticatedUser, Depends(dependency)],
    ) -> dict[str, str]:
        return {"uid": user.uid}

    response = await request(
        app, "GET", "/test/default-auth", headers={"Authorization": "Bearer any-token"}
    )
    assert response.status_code == 401


@pytest.mark.anyio
async def test_rejecting_verifier_never_accepts_a_token() -> None:
    """Exercise the safe default independently of FastAPI."""
    with pytest.raises(TokenVerificationError):
        await RejectingTokenVerifier().verify("synthetic-token")


def test_authenticated_user_rejects_blank_verified_uid() -> None:
    """Refuse an invalid identity even after a verifier returns it."""
    with pytest.raises(ValueError, match="uid must not be blank"):
        AuthenticatedUser(" ")


@pytest.mark.anyio
async def test_validation_and_http_errors_use_consistent_envelopes() -> None:
    """Sanitize framework validation, routing, and HTTP errors."""
    app = create_app(AppSettings(app_env="test"))

    @app.get("/test/validated")
    async def validated(count: Annotated[int, Query(gt=0)]) -> dict[str, int]:
        return {"count": count}

    @app.get("/test/teapot")
    async def teapot() -> None:
        raise HTTPException(status_code=418, detail="internal teapot detail")

    invalid = await request(app, "GET", "/test/validated?count=nope")
    missing = await request(app, "GET", "/not-present")
    method = await request(app, "POST", "/api/v1/health/live")
    teapot_response = await request(app, "GET", "/test/teapot")

    assert invalid.status_code == 422
    assert invalid.json()["error"]["code"] == "invalid_request"
    assert "count" not in invalid.text
    assert missing.json()["error"]["code"] == "not_found"
    assert method.json()["error"]["code"] == "method_not_allowed"
    assert teapot_response.json()["error"] == {
        "code": "http_error",
        "message": "Request could not be completed",
    }
    assert "teapot detail" not in teapot_response.text


@pytest.mark.anyio
async def test_unexpected_errors_hide_internal_details() -> None:
    """Return a stable 500 response without exception or secret content."""
    app = create_app(AppSettings(app_env="test"))

    @app.get("/test/failure")
    async def failure() -> None:
        raise RuntimeError("internal-sensitive-detail")

    response = await request(
        app,
        "GET",
        "/test/failure",
        headers={REQUEST_ID_HEADER: "failure-1"},
        raise_app_exceptions=False,
    )

    assert response.status_code == 500
    assert response.headers[REQUEST_ID_HEADER.lower()] == "failure-1"
    assert response.json() == {
        "error": {"code": "internal_error", "message": "An unexpected error occurred"},
        "request_id": "failure-1",
    }
    assert "internal-sensitive-detail" not in response.text


def test_api_error_retains_only_explicit_safe_fields() -> None:
    """Store only public fields on expected failures."""
    error = ApiError(status_code=409, code="safe_code", message="Safe message")
    assert (error.status_code, error.code, error.message) == (409, "safe_code", "Safe message")
