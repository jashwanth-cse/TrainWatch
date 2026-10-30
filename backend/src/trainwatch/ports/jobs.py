"""Port for reminder job persistence and lease management."""

from __future__ import annotations

from datetime import datetime
from typing import Protocol

from trainwatch.domain.jobs import JobRecord


class JobRepository(Protocol):
    """Manage background reminder jobs with concurrency-safe leases."""

    async def get_due_jobs(self, *, now: datetime, limit: int = 50) -> list[JobRecord]:
        """Query jobs that are pending and ready for evaluation."""
        ...

    async def claim_job(
        self,
        *,
        job_id: str,
        lease_duration_seconds: int,
        now: datetime,
    ) -> JobRecord | None:
        """Atomically claim a lease on a job; return None if already claimed."""
        ...

    async def complete_job(
        self,
        *,
        job_id: str,
        next_due_at: datetime | None,
        now: datetime,
    ) -> None:
        """Mark a job completed and optionally reschedule the next check."""
        ...

    async def fail_job(
        self,
        *,
        job_id: str,
        error: str,
        retry_at: datetime | None,
        now: datetime,
    ) -> None:
        """Record a failure and optionally schedule a backoff retry."""
        ...

    async def reconcile_expired_leases(self, *, now: datetime) -> int:
        """Reset expired leases back to pending state so they can be re-evaluated."""
        ...

    async def get(self, *, job_id: str) -> JobRecord | None:
        """Fetch a job by its unique identifier."""
        ...

    async def save(self, job: JobRecord) -> None:
        """Persist a job record."""
        ...
