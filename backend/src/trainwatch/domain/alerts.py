"""Alert-condition validation and transition evaluation."""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import StrEnum

from trainwatch.domain.availability import (
    AvailabilityObservation,
    AvailabilitySnapshot,
    AvailabilityStatus,
    compare_availability,
)

_EXTRACT_DIGITS = re.compile(r"(\d+)")


def _extract_available_seats(raw: str) -> int | None:
    """Extract numeric seat count from raw availability text."""
    match = _EXTRACT_DIGITS.search(raw)
    return int(match.group(1)) if match else None


class AlertKind(StrEnum):
    """Supported notification conditions for the domain model."""

    BECOMES_AVAILABLE = "becomes_available"
    IMPROVES = "improves"
    REACHES_THRESHOLD = "reaches_threshold"
    SEATS_BELOW = "seats_below"
    RAPID_RAC_INCREASE = "rapid_rac_increase"


class AlertEventKind(StrEnum):
    """Semantic classification of a triggered AVL threshold notification."""

    NONE = "none"
    THRESHOLD_CROSSED = "threshold_crossed"
    SEATS_DECREASING = "seats_decreasing"
    SOLD_OUT = "sold_out"


@dataclass(frozen=True, slots=True)
class AvlEvaluationResult:
    """Structured outcome of evaluating one AVL threshold poll."""

    should_alert: bool
    event_kind: AlertEventKind
    current_avl: int | None
    previous_avl: int | None


@dataclass(frozen=True, slots=True)
class AlertCondition:
    """A validated transition condition, optionally with a numeric target."""

    kind: AlertKind
    target_status: AvailabilityStatus | None = None
    maximum_position: int | None = None

    @property
    def is_avl_only(self) -> bool:
        """Return True when this alert tracks confirmed AVL seat availability."""
        return self.kind is AlertKind.SEATS_BELOW

    def __post_init__(self) -> None:
        """Require threshold fields only for meaningful, verified comparisons."""
        if self.kind is AlertKind.SEATS_BELOW:
            if self.maximum_position is None or self.maximum_position <= 0:
                raise ValueError("seats_below condition requires a positive maximum_position")
            if (
                self.target_status is not None
                and self.target_status is not AvailabilityStatus.AVAILABLE
            ):
                raise ValueError("seats_below target_status must be AVAILABLE or None")
            return
        if self.kind is AlertKind.RAPID_RAC_INCREASE:
            if self.target_status is not None or self.maximum_position is not None:
                raise ValueError("rapid_rac_increase does not accept target fields")
            return
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


class AvlThresholdEvaluator:
    """Evaluates confirmed AVL threshold crossings and subsequent downward drops."""

    @staticmethod
    def evaluate(
        *,
        threshold: int,
        previous_snapshot: AvailabilitySnapshot | None,
        current_snapshot: AvailabilitySnapshot | None,
        fallback_previous_avl: int | None = None,
    ) -> AvlEvaluationResult:
        """Compare current AVL seats against threshold and prior count."""
        if current_snapshot is None or current_snapshot.status is AvailabilityStatus.UNKNOWN:
            return AvlEvaluationResult(
                should_alert=False,
                event_kind=AlertEventKind.NONE,
                current_avl=None,
                previous_avl=fallback_previous_avl,
            )

        if previous_snapshot is None:
            before_avl = fallback_previous_avl
        elif previous_snapshot.status is AvailabilityStatus.AVAILABLE:
            before_avl = _extract_available_seats(previous_snapshot.raw_availability)
        else:
            before_avl = None

        if current_snapshot.status in {
            AvailabilityStatus.RAC,
            AvailabilityStatus.WAITLIST,
            AvailabilityStatus.REGRET,
        }:
            if (
                previous_snapshot is not None
                and previous_snapshot.status is AvailabilityStatus.AVAILABLE
            ):
                return AvlEvaluationResult(
                    should_alert=True,
                    event_kind=AlertEventKind.SOLD_OUT,
                    current_avl=0,
                    previous_avl=before_avl,
                )
            return AvlEvaluationResult(
                should_alert=False,
                event_kind=AlertEventKind.NONE,
                current_avl=None,
                previous_avl=before_avl,
            )

        cur_avl = _extract_available_seats(current_snapshot.raw_availability)
        if cur_avl is None or cur_avl >= threshold:
            return AvlEvaluationResult(
                should_alert=False,
                event_kind=AlertEventKind.NONE,
                current_avl=cur_avl,
                previous_avl=before_avl,
            )

        if before_avl is None or before_avl >= threshold:
            return AvlEvaluationResult(
                should_alert=True,
                event_kind=AlertEventKind.THRESHOLD_CROSSED,
                current_avl=cur_avl,
                previous_avl=before_avl,
            )

        if cur_avl < before_avl:
            return AvlEvaluationResult(
                should_alert=True,
                event_kind=AlertEventKind.SEATS_DECREASING,
                current_avl=cur_avl,
                previous_avl=before_avl,
            )

        return AvlEvaluationResult(
            should_alert=False,
            event_kind=AlertEventKind.NONE,
            current_avl=cur_avl,
            previous_avl=before_avl,
        )


def compose_avl_alert_message(
    *,
    train_number: str,
    travel_class: str,
    journey_date: object,
    threshold: int,
    evaluation: AvlEvaluationResult,
    snapshot: AvailabilitySnapshot,
) -> tuple[str, str]:
    """Build user-facing push notification title and body for an AVL alert."""
    if evaluation.event_kind is AlertEventKind.SEATS_DECREASING:
        prev_part = (
            f" (was AVL {evaluation.previous_avl})" if evaluation.previous_avl is not None else ""
        )
        return (
            f"Book Fast! Train {train_number}",
            f"Seats filling fast on Train {train_number} ({travel_class}): "
            f"only {evaluation.current_avl} AVL left{prev_part} for {journey_date}. "
            "Book now before they run out!",
        )
    if evaluation.event_kind is AlertEventKind.SOLD_OUT:
        raw = snapshot.raw_availability or snapshot.status.value
        return (
            f"Confirmed Seats Gone: Train {train_number}",
            f"Train {train_number} ({travel_class}) on {journey_date} moved from AVL to {raw}.",
        )
    prev_part = (
        f" (down from AVL {evaluation.previous_avl})" if evaluation.previous_avl is not None else ""
    )
    return (
        f"Low Seat Alert: Train {train_number}",
        f"Train {train_number} ({travel_class}) dropped to {evaluation.current_avl} AVL "
        f"(below {threshold}){prev_part} for {journey_date}. Book before they sell out!",
    )


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
    if before.status is AvailabilityStatus.UNKNOWN or after.status is AvailabilityStatus.UNKNOWN:
        return False

    if condition.kind is AlertKind.BECOMES_AVAILABLE:
        return (
            after.is_comparable
            and after.status is AvailabilityStatus.AVAILABLE
            and before.status is not AvailabilityStatus.AVAILABLE
        )
    if condition.kind is AlertKind.IMPROVES:
        return compare_availability(after, before) == 1
    if condition.kind is AlertKind.SEATS_BELOW:
        assert condition.maximum_position is not None
        return AvlThresholdEvaluator.evaluate(
            threshold=condition.maximum_position,
            previous_snapshot=before,
            current_snapshot=after,
        ).should_alert
    if condition.kind is AlertKind.RAPID_RAC_INCREASE:
        if before.status is AvailabilityStatus.RAC and after.status is AvailabilityStatus.WAITLIST:
            return True
        if (
            before.status is AvailabilityStatus.RAC
            and after.status is AvailabilityStatus.RAC
            and after.position is not None
            and before.position is not None
        ):
            return after.position >= before.position + 5
        return False

    return _meets_threshold(after, condition) and not _meets_threshold(before, condition)
