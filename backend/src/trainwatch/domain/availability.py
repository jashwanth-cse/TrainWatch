"""Availability parsing, provider-failure representation, and comparison."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum


class AvailabilityStatus(StrEnum):
    """Provider statuses with verified normalization semantics."""

    AVAILABLE = "AVAILABLE"
    RAC = "RAC"
    WAITLIST = "WL"
    REGRET = "REGRET"
    UNKNOWN = "UNKNOWN"


class ProviderFailure(StrEnum):
    """Sanitized failure categories that can never represent availability."""

    TIMEOUT = "timeout"
    THROTTLED = "throttled"
    UPSTREAM = "upstream"
    MALFORMED_RESPONSE = "malformed_response"
    UNAUTHORIZED = "unauthorized"
    OTHER = "other"


@dataclass(frozen=True, slots=True)
class AvailabilitySnapshot:
    """One normalized provider observation."""

    status: AvailabilityStatus
    raw_availability: str
    observed_at: datetime
    position: int | None = None

    @property
    def is_comparable(self) -> bool:
        """Return whether this snapshot participates in improvement ordering."""
        if self.status is AvailabilityStatus.AVAILABLE:
            return self.position is None
        if self.status in {AvailabilityStatus.RAC, AvailabilityStatus.WAITLIST}:
            return self.position is not None and self.position > 0
        return False


@dataclass(frozen=True, slots=True)
class AvailabilityObservation:
    """Exactly one successful snapshot or sanitized provider failure."""

    snapshot: AvailabilitySnapshot | None = None
    failure: ProviderFailure | None = None

    def __post_init__(self) -> None:
        """Prevent ambiguous observations that could be interpreted positively."""
        if (self.snapshot is None) == (self.failure is None):
            raise ValueError("observation must contain exactly one snapshot or failure")

    @classmethod
    def success(cls, snapshot: AvailabilitySnapshot) -> AvailabilityObservation:
        """Build a successful provider observation."""
        return cls(snapshot=snapshot)

    @classmethod
    def failed(cls, failure: ProviderFailure) -> AvailabilityObservation:
        """Build a failure without provider payload details."""
        return cls(failure=failure)


_AVAILABLE_PATTERN = re.compile(r"^(?:AVAILABLE|AVL|CURR_AVBL)(?:\s+\d+)?$", re.IGNORECASE)
_RAC_PATTERN = re.compile(r"^RAC\s*(\d+)$", re.IGNORECASE)
_WAITLIST_PATTERN = re.compile(r"(?:WL|WAITLIST)\s*(\d+)", re.IGNORECASE)
_REGRET_PATTERN = re.compile(r"^REGRET(?:/WL)?$", re.IGNORECASE)


def parse_availability(
    *, booking_status: str, raw_availability: str, observed_at: datetime
) -> AvailabilitySnapshot:
    """Normalize a verified provider response and fail closed on inconsistencies."""
    raw = raw_availability.strip()
    try:
        status = AvailabilityStatus(booking_status.strip().upper())
    except ValueError:
        status = AvailabilityStatus.UNKNOWN

    position: int | None = None
    matches_status = False
    if status is AvailabilityStatus.AVAILABLE:
        matches_status = _AVAILABLE_PATTERN.fullmatch(raw) is not None
    elif status is AvailabilityStatus.RAC:
        match = _RAC_PATTERN.fullmatch(raw)
        matches_status = match is not None
        position = int(match.group(1)) if match else None
    elif status is AvailabilityStatus.WAITLIST:
        matches = _WAITLIST_PATTERN.findall(raw)
        matches_status = bool(matches)
        position = int(matches[-1]) if matches else None
    elif status is AvailabilityStatus.REGRET:
        matches_status = _REGRET_PATTERN.fullmatch(raw) is not None

    if not matches_status or position == 0:
        status = AvailabilityStatus.UNKNOWN
        position = None

    return AvailabilitySnapshot(
        status=status,
        raw_availability=raw,
        observed_at=observed_at,
        position=position,
    )


def compare_availability(
    current: AvailabilitySnapshot, previous: AvailabilitySnapshot
) -> int | None:
    """Compare usable snapshots, returning 1 for improvement and -1 for regression."""
    if not current.is_comparable or not previous.is_comparable:
        return None

    rank = {
        AvailabilityStatus.WAITLIST: 1,
        AvailabilityStatus.RAC: 2,
        AvailabilityStatus.AVAILABLE: 3,
    }
    current_rank = rank[current.status]
    previous_rank = rank[previous.status]
    if current_rank != previous_rank:
        return 1 if current_rank > previous_rank else -1
    if current.status is AvailabilityStatus.AVAILABLE:
        return 0

    assert current.position is not None
    assert previous.position is not None
    if current.position == previous.position:
        return 0
    return 1 if current.position < previous.position else -1
