"""Owner-scoped device registration and token lifecycle routes."""

from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Annotated, cast

from fastapi import APIRouter, Depends, Header, Request, status
from pydantic import BaseModel, Field

from trainwatch.api.errors import ApiError
from trainwatch.domain.notifications import DevicePlatform, DeviceRecord
from trainwatch.ports.devices import DeviceRepository
from trainwatch.ports.identity import AuthenticatedUser

router = APIRouter(prefix="/devices", tags=["devices"])

_VALID_DEVICE_ID = re.compile(r"^[A-Za-z0-9_-]{1,128}$")


class RegisterDevicePayload(BaseModel):
    """Payload to register or update a client device FCM token."""

    fcm_token: str = Field(min_length=1, max_length=4096)
    platform: DevicePlatform = DevicePlatform.ANDROID


class DeviceResponse(BaseModel):
    """Confirmation of device operation."""

    status: str
    device_id: str


async def get_current_user(
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
) -> AuthenticatedUser:
    """Resolve caller identity using the application auth dependency."""
    dependency = request.app.state.current_user_dependency
    user: AuthenticatedUser = await dependency(authorization=authorization)
    return user


def get_device_repository(request: Request) -> DeviceRepository:
    """Read the injected device repository or signal an unconfigured service."""
    repo = getattr(request.app.state, "device_repository", None)
    if repo is None:
        raise ApiError(
            status_code=503,
            code="service_unavailable",
            message="Device repository is not configured",
        )
    return cast(DeviceRepository, repo)


@router.put(
    "/{device_id}",
    response_model=DeviceResponse,
    status_code=status.HTTP_200_OK,
)
async def register_device(
    device_id: str,
    payload: RegisterDevicePayload,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    repo: Annotated[DeviceRepository, Depends(get_device_repository)],
) -> DeviceResponse:
    """Register or update an FCM token for a user device."""
    clean_device_id = device_id.strip()
    if not _VALID_DEVICE_ID.fullmatch(clean_device_id):
        raise ApiError(
            status_code=400,
            code="invalid_device_id",
            message="device_id must be 1-128 alphanumeric, hyphen, or underscore characters",
        )

    now = datetime.now(UTC)
    device = DeviceRecord(
        device_id=clean_device_id,
        user_id=user.uid,
        fcm_token=payload.fcm_token.strip(),
        platform=payload.platform,
        active=True,
        created_at=now,
        updated_at=now,
    )
    await repo.register_device(device)
    return DeviceResponse(status="registered", device_id=clean_device_id)


@router.delete(
    "/{device_id}",
    response_model=DeviceResponse,
    status_code=status.HTTP_200_OK,
)
async def revoke_device(
    device_id: str,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    repo: Annotated[DeviceRepository, Depends(get_device_repository)],
) -> DeviceResponse:
    """Revoke or deactivate a registered user device."""
    clean_device_id = device_id.strip()
    if not _VALID_DEVICE_ID.fullmatch(clean_device_id):
        raise ApiError(
            status_code=400,
            code="invalid_device_id",
            message="device_id must be 1-128 alphanumeric, hyphen, or underscore characters",
        )

    revoked = await repo.revoke_device(user_id=user.uid, device_id=clean_device_id)
    if not revoked:
        raise ApiError(
            status_code=404,
            code="device_not_found",
            message="Device not found",
        )
    return DeviceResponse(status="revoked", device_id=clean_device_id)
