"""Port interface for user device registrations."""

from __future__ import annotations

from typing import Protocol

from trainwatch.domain.notifications import DeviceRecord


class DeviceRepository(Protocol):
    """Durable device storage for push notification dispatch."""

    async def register_device(self, device: DeviceRecord) -> None:
        """Register or update an active user device token."""
        ...

    async def get_user_devices(self, user_id: str) -> list[DeviceRecord]:
        """Fetch all active devices registered for a user."""
        ...

    async def revoke_device(self, user_id: str, device_id: str) -> bool:
        """Mark a device inactive or delete registration."""
        ...

    async def deactivate_token(self, fcm_token: str) -> int:
        """Deactivate any device records referencing an invalid/unregistered token."""
        ...
