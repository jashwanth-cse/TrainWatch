"""Alert-condition validation and transition evaluation."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from trainwatch.domain.availability import (
    AvailabilityObservation,
    AvailabilitySnapshot,
    AvailabilityStatus,
    compare_availability,
)


class AlertKind(StrEnum):
    """Supported notification conditions for the first domain model."""

    BECOMES_AVAILABLE = "becomes_available"
    IMPROVES = "improves"
    REACHES_THRESHOLD = "reaches_threshold"


@dataclass(frozen=True, slots=True)
class AlertCondition:
    """A validated transition condition, optionally with a numeric target."""

    kind: AlertKind
    target_status: AvailabilityStatus | None = None
    maximum_position: int | None = None

    def __post_init__(self) -> None:
        """Require threshold fields only for meaningful, verified comparisons."""
        if self.kind is not AlertKind.REACHES_THRESHOLD:
            if self.target_status is not None or self.maximum_position is not None:
                raise ValueError("only threshold alerts accept target fields")
            return
        if self.target_status is AvailabilityStatus.AVAILABLE:
            if self.maximum_position is not None:
                raise ValueError("AVAILABLE threshold does not accept a position")
            return
        if self.target_status not in {AvailabilityStatus.RAC, AvailabilityStatus.WAITLIST}:
            raise ValueError("threshold status must be AVAILABLE, RAC, or WL")
        if self.maximum_position is None or self.maximum_position <= 0:
            raise ValueError("RAC and WL thresholds require a positive maximum_position")


def _meets_threshold(snapshot: AvailabilitySnapshot, condition: AlertCondition) -> bool:
    """Evaluate one comparable snapshot against a validated threshold."""
    if not snapshot.is_comparable:
        return False
    assert condition.target_status is not None
    rank = {
        AvailabilityStatus.WAITLIST: 1,
        AvailabilityStatus.RAC: 2,
        AvailabilityStatus.AVAILABLE: 3,
    }
    snapshot_rank = rank[snapshot.status]
    target_rank = rank[condition.target_status]
    if snapshot_rank != target_rank:
        return snapshot_rank > target_rank
    if snapshot.status is AvailabilityStatus.AVAILABLE:
        return True
    assert snapshot.position is not None
    assert condition.maximum_position is not None
    return snapshot.position <= condition.maximum_position


def should_alert(
    *,
    condition: AlertCondition,
    previous: AvailabilityObservation | None,
    current: AvailabilityObservation,
) -> bool:
    """Evaluate a valid transition; baselines and all failures fail closed."""
    if previous is None or previous.snapshot is None or current.snapshot is None:
        return False

    before = previous.snapshot
    after = current.snapshot
    if before.status is AvailabilityStatus.UNKNOWN:
        return False
    if condition.kind is AlertKind.BECOMES_AVAILABLE:
        return (
            after.is_comparable
            and after.status is AvailabilityStatus.AVAILABLE
            and before.status is not AvailabilityStatus.AVAILABLE
        )
    if condition.kind is AlertKind.IMPROVES:
        return compare_availability(after, before) == 1
    return _meets_threshold(after, condition) and not _meets_threshold(before, condition)
