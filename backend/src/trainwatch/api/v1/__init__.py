"""Version 1 public API router."""

from fastapi import APIRouter

from trainwatch.api.v1.health import router as health_router

router = APIRouter(prefix="/api/v1")
router.include_router(health_router)
