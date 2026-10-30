"""FastAPI dependency for extracting and verifying bearer tokens."""

from __future__ import annotations

import re
from collections.abc import Callable, Coroutine
from typing import Annotated, Any

from fastapi import Header, Request

from trainwatch.api.errors import ApiError
from trainwatch.ports.identity import AuthenticatedUser, TokenVerificationError, TokenVerifier

_MAX_AUTHORIZATION_LENGTH = 8192
_BEARER_CHALLENGE = {"WWW-Authenticate": "Bearer"}
_DEVICE_TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9_-]{6,128}$")


class RejectingTokenVerifier:
    """Default verifier rejecting all tokens with a verification error."""

    async def verify(self, bearer_value: str) -> AuthenticatedUser:
        """Reject every token presentation."""
        raise TokenVerificationError


class ProductionTokenVerifier:
    """Authenticates device session tokens and Firebase ID tokens."""

    async def verify(self, bearer_value: str) -> AuthenticatedUser:
        """Verify either a device installation token or a Firebase ID token."""
        if _DEVICE_TOKEN_PATTERN.fullmatch(bearer_value) and "." not in bearer_value:
            return AuthenticatedUser(uid=bearer_value)

        parts = bearer_value.split(".")
        if len(parts) == 3:
            try:
                import firebase_admin  # type: ignore[import-untyped]
                from firebase_admin import auth as fb_auth

                if not firebase_admin._apps:
                    firebase_admin.initialize_app()

                decoded = fb_auth.verify_id_token(bearer_value)
                uid = decoded.get("uid")
                if uid and isinstance(uid, str) and uid.strip():
                    return AuthenticatedUser(uid=uid.strip())
            except Exception:
                raise TokenVerificationError from None

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

    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1]:
        raise ApiError(
            status_code=401,
            code="unauthorized",
            message="Authentication required",
            headers=_BEARER_CHALLENGE,
        )

    return parts[1]


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
