"""Version 1 public API router."""

from fastapi import APIRouter

from trainwatch.api.v1.devices import router as devices_router
from trainwatch.api.v1.health import router as health_router
from trainwatch.api.v1.internal import router as internal_router
from trainwatch.api.v1.watches import router as watches_router

router = APIRouter(prefix="/api/v1")
router.include_router(health_router)
router.include_router(watches_router)
router.include_router(devices_router)
router.include_router(internal_router)
