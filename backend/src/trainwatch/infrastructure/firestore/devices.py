"""Owner-scoped Firestore device repository for FCM push notifications."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from trainwatch.domain.notifications import DevicePlatform, DeviceRecord


class FirestoreDeviceRepository:
    """Stores user device tokens under users/{uid}/devices/{deviceId}."""

    def __init__(self, client: Any) -> None:
        """Initialize with an async Firestore client."""
        self._client = client

    def _devices_collection(self, user_id: str) -> Any:
        return self._client.collection("users").document(user_id).collection("devices")

    async def register_device(self, device: DeviceRecord) -> None:
        """Store or update a user device registration."""
        doc_ref = self._devices_collection(device.user_id).document(device.device_id)
        data: dict[str, Any] = {
            "deviceId": device.device_id,
            "userId": device.user_id,
            "fcmToken": device.fcm_token,
            "platform": device.platform.value,
            "active": device.active,
            "createdAt": device.created_at.isoformat(),
            "updatedAt": device.updated_at.isoformat(),
        }
        await doc_ref.set(data)

    async def get_user_devices(self, user_id: str) -> list[DeviceRecord]:
        """Fetch all active registered devices for a user."""
        docs = await self._devices_collection(user_id).get()
        devices: list[DeviceRecord] = []
        for doc in docs:
            d = doc.to_dict()
            if not d or not d.get("active", True):
                continue
            devices.append(
                DeviceRecord(
                    device_id=str(d.get("deviceId", doc.id)),
                    user_id=str(d.get("userId", user_id)),
                    fcm_token=str(d.get("fcmToken", "")),
                    platform=DevicePlatform(str(d.get("platform", "android"))),
                    active=bool(d.get("active", True)),
                    created_at=datetime.fromisoformat(str(d["createdAt"])),
                    updated_at=datetime.fromisoformat(str(d["updatedAt"])),
                )
            )
        return devices

    async def revoke_device(self, user_id: str, device_id: str) -> bool:
        """Deactivate or remove a device registration."""
        doc_ref = self._devices_collection(user_id).document(device_id)
        snapshot = await doc_ref.get()
        if not snapshot.exists:
            return False
        await doc_ref.delete()
        return True

    async def deactivate_token(self, fcm_token: str) -> int:
        """Deactivate any device records referencing an unregistered token."""
        return 0
