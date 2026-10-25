"""Background reminder job domain entities and state transitions."""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime
from enum import StrEnum


class JobStatus(StrEnum):
    """Lifecycle states for scheduled reminder jobs."""

    PENDING = "pending"
    LEASED = "leased"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass(frozen=True, slots=True)
class JobRecord:
    """A scheduled background job for checking train seat availability."""

    job_id: str
    watch_id: str
    owner_id: str
    due_at: datetime
    status: JobStatus
    created_at: datetime
    updated_at: datetime
    attempts: int = 0
    leased_until: datetime | None = None
    last_error: str | None = None

    def __post_init__(self) -> None:
        """Validate job integrity invariants."""
        if not self.job_id.strip():
            raise ValueError("job_id must not be blank")
        if not self.watch_id.strip():
            raise ValueError("watch_id must not be blank")
        if not self.owner_id.strip():
            raise ValueError("owner_id must not be blank")
        if self.attempts < 0:
            raise ValueError("attempts must be non-negative")
        if self.updated_at < self.created_at:
            raise ValueError("updated_at must not precede created_at")

    def claim_lease(self, *, leased_until: datetime, at: datetime) -> JobRecord:
        """Claim a lease for this job if not already claimed."""
        return replace(
            self,
            status=JobStatus.LEASED,
            leased_until=leased_until,
            attempts=self.attempts + 1,
            updated_at=at,
        )

    def mark_completed(self, *, next_due_at: datetime | None, at: datetime) -> JobRecord:
        """Complete the current check and optionally reschedule next check."""
        if next_due_at is not None:
            return replace(
                self,
                status=JobStatus.PENDING,
                due_at=next_due_at,
                leased_until=None,
                last_error=None,
                updated_at=at,
            )
        return replace(
            self,
            status=JobStatus.COMPLETED,
            leased_until=None,
            updated_at=at,
        )

    def mark_failed(
        self,
        *,
        error: str,
        retry_at: datetime | None,
        at: datetime,
    ) -> JobRecord:
        """Record check failure with optional retry timestamp."""
        if retry_at is not None:
            return replace(
                self,
                status=JobStatus.PENDING,
                due_at=retry_at,
                leased_until=None,
                last_error=error,
                updated_at=at,
            )
        return replace(
            self,
            status=JobStatus.FAILED,
            leased_until=None,
            last_error=error,
            updated_at=at,
        )

    def is_lease_expired(self, *, now: datetime) -> bool:
        """Return True if the job is leased and the lease has lapsed."""
        return (
            self.status is JobStatus.LEASED
            and self.leased_until is not None
            and now >= self.leased_until
        )
