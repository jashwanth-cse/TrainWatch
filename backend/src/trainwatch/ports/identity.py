"""Identity types and token-verification boundary."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True, slots=True)
class AuthenticatedUser:
    """Minimal trusted identity derived from a verified token."""

    uid: str

    def __post_init__(self) -> None:
        """Reject an identity that cannot own resources."""
        if not self.uid.strip():
            raise ValueError("verified uid must not be blank")


class TokenVerificationError(Exception):
    """Sanitized signal for an invalid, expired, or unverifiable token."""


class TokenVerifier(Protocol):
    """Verify an opaque token and return only the trusted application identity."""

    async def verify(self, bearer_value: str) -> AuthenticatedUser:
        """Verify one bearer value without exposing it to callers or logs."""
        ...
