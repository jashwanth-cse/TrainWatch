"""Port interface for push notification delivery."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol


@dataclass(frozen=True, slots=True)
class FcmDeliveryResult:
    """Outcome of a multicast push notification dispatch."""

    success_count: int
    failure_count: int
    unregistered_tokens: list[str] = field(default_factory=list)

    @property
    def is_partial_or_total_success(self) -> bool:
        """Return True if at least one device received the notification."""
        return self.success_count > 0


class FcmSender(Protocol):
    """Abstraction over Firebase Cloud Messaging sender."""

    async def send_multicast(
        self,
        *,
        tokens: list[str],
        title: str,
        body: str,
        data: dict[str, str],
    ) -> FcmDeliveryResult:
        """Deliver push message to multiple device tokens."""
        ...
