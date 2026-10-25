"""Port for enqueuing background tasks to Cloud Tasks or test runners."""

from __future__ import annotations

from typing import Protocol


class TaskEnqueuer(Protocol):
    """Enqueue discrete background execution tasks."""

    async def enqueue_check(self, *, job_id: str, countdown_seconds: int = 0) -> str:
        """Enqueue one check task for the specified job."""
        ...
