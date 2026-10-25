"""Bearer-token extraction and injectable identity verification."""

from __future__ import annotations

from collections.abc import Callable, Coroutine
from typing import Annotated, Any

from fastapi import Header, Request

from trainwatch.api.errors import ApiError
from trainwatch.ports.identity import AuthenticatedUser, TokenVerificationError, TokenVerifier

_MAX_AUTHORIZATION_LENGTH = 8192
_BEARER_CHALLENGE = {"WWW-Authenticate": "Bearer"}


class RejectingTokenVerifier:
    """Safe default used until an approved Firebase adapter is configured."""

    async def verify(self, bearer_value: str) -> AuthenticatedUser:
        """Reject every token without inspecting credentials or contacting a service."""
        del bearer_value
        raise TokenVerificationError


def _bearer_token(authorization: str | None) -> str:
    """Extract a bounded bearer token without returning it in an error."""
    if authorization is None or len(authorization) > _MAX_AUTHORIZATION_LENGTH:
        raise ApiError(
            status_code=401,
            code="unauthorized",
            message="Authentication required",
            headers=_BEARER_CHALLENGE,
        )
    scheme, separator, bearer_value = authorization.partition(" ")
    if scheme.lower() != "bearer" or not separator or not bearer_value or " " in bearer_value:
        raise ApiError(
            status_code=401,
            code="unauthorized",
            message="Authentication required",
            headers=_BEARER_CHALLENGE,
        )
    return bearer_value


def build_current_user_dependency(
    verifier: TokenVerifier,
) -> Callable[..., Coroutine[Any, Any, AuthenticatedUser]]:
    """Bind one verifier to the FastAPI dependency used by protected routes."""

    async def current_user(
        request: Request,
        authorization: Annotated[str | None, Header()] = None,
    ) -> AuthenticatedUser:
        """Verify once per request and share the result with rate limiting and routes."""
        cached_user = getattr(request.state, "user", None)
        if isinstance(cached_user, AuthenticatedUser):
            return cached_user
        cached_error = getattr(request.state, "authentication_error", None)
        if isinstance(cached_error, ApiError):
            raise cached_error
        try:
            bearer_value = _bearer_token(authorization)
            user = await verifier.verify(bearer_value)
        except TokenVerificationError:
            error = ApiError(
                status_code=401,
                code="unauthorized",
                message="Authentication required",
                headers=_BEARER_CHALLENGE,
            )
            request.state.authentication_error = error
            raise error from None
        except ApiError as exc:
            request.state.authentication_error = exc
            raise
        request.state.user = user
        return user

    return current_user
