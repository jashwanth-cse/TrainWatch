"""Unit tests for pure availability parsing and alert evaluation."""

from datetime import UTC, datetime

import pytest

from trainwatch.domain.alerts import AlertCondition, AlertKind, should_alert
from trainwatch.domain.availability import (
    AvailabilityObservation,
    AvailabilitySnapshot,
    AvailabilityStatus,
    ProviderFailure,
    compare_availability,
    parse_availability,
)

NOW = datetime(2026, 10, 23, tzinfo=UTC)


def snapshot(status: AvailabilityStatus, position: int | None = None) -> AvailabilitySnapshot:
    """Build a compact comparison snapshot."""
    raw = status.value if position is None else f"{status.value} {position}"
    return AvailabilitySnapshot(status, raw, NOW, position)


def observation(status: AvailabilityStatus, position: int | None = None) -> AvailabilityObservation:
    """Build a successful compact observation."""
    return AvailabilityObservation.success(snapshot(status, position))


@pytest.mark.parametrize(
    ("status", "raw", "expected_status", "position"),
    [
        ("AVAILABLE", "AVAILABLE 15", AvailabilityStatus.AVAILABLE, None),
        ("AVAILABLE", " AVL 282 ", AvailabilityStatus.AVAILABLE, None),
        ("AVAILABLE", "CURR_AVBL 4", AvailabilityStatus.AVAILABLE, None),
        ("RAC", "RAC 5", AvailabilityStatus.RAC, 5),
        ("WL", "GNWL 45/WL 12", AvailabilityStatus.WAITLIST, 12),
        ("WL", "WAITLIST 5", AvailabilityStatus.WAITLIST, 5),
        ("REGRET", "REGRET/WL", AvailabilityStatus.REGRET, None),
        ("UNKNOWN", "", AvailabilityStatus.UNKNOWN, None),
        ("NOT_REAL", "AVAILABLE 1", AvailabilityStatus.UNKNOWN, None),
        ("AVAILABLE", "WL 1", AvailabilityStatus.UNKNOWN, None),
        ("RAC", "RAC 0", AvailabilityStatus.UNKNOWN, None),
        ("WL", "WL 0", AvailabilityStatus.UNKNOWN, None),
    ],
)
def test_parse_availability_fails_closed(
    status: str,
    raw: str,
    expected_status: AvailabilityStatus,
    position: int | None,
) -> None:
    """Parse verified forms and downgrade inconsistent values to UNKNOWN."""
    result = parse_availability(booking_status=status, raw_availability=raw, observed_at=NOW)

    assert result.status is expected_status
    assert result.position == position
    assert result.raw_availability == raw.strip()


@pytest.mark.parametrize(
    ("status", "position", "expected"),
    [
        (AvailabilityStatus.AVAILABLE, None, True),
        (AvailabilityStatus.AVAILABLE, 1, False),
        (AvailabilityStatus.RAC, 1, True),
        (AvailabilityStatus.RAC, None, False),
        (AvailabilityStatus.WAITLIST, 0, False),
        (AvailabilityStatus.REGRET, None, False),
    ],
)
def test_snapshot_comparability_requires_structured_valid_values(
    status: AvailabilityStatus, position: int | None, expected: bool
) -> None:
    """Exclude unknown, regret, and malformed numeric states from ordering."""
    assert snapshot(status, position).is_comparable is expected


def test_observation_requires_exactly_one_result() -> None:
    """Disallow empty or ambiguous provider results."""
    with pytest.raises(ValueError, match="exactly one"):
        AvailabilityObservation()
    with pytest.raises(ValueError, match="exactly one"):
        AvailabilityObservation(
            snapshot=snapshot(AvailabilityStatus.AVAILABLE),
            failure=ProviderFailure.TIMEOUT,
        )

    assert AvailabilityObservation.failed(ProviderFailure.THROTTLED).snapshot is None


@pytest.mark.parametrize(
    ("current", "previous", "expected"),
    [
        (snapshot(AvailabilityStatus.AVAILABLE), snapshot(AvailabilityStatus.RAC, 1), 1),
        (snapshot(AvailabilityStatus.WAITLIST, 1), snapshot(AvailabilityStatus.RAC, 2), -1),
        (snapshot(AvailabilityStatus.RAC, 3), snapshot(AvailabilityStatus.RAC, 8), 1),
        (snapshot(AvailabilityStatus.RAC, 8), snapshot(AvailabilityStatus.RAC, 3), -1),
        (snapshot(AvailabilityStatus.WAITLIST, 4), snapshot(AvailabilityStatus.WAITLIST, 4), 0),
        (snapshot(AvailabilityStatus.AVAILABLE), snapshot(AvailabilityStatus.AVAILABLE), 0),
        (snapshot(AvailabilityStatus.UNKNOWN), snapshot(AvailabilityStatus.WAITLIST, 2), None),
    ],
)
def test_compare_availability_uses_status_rank_and_numeric_position(
    current: AvailabilitySnapshot,
    previous: AvailabilitySnapshot,
    expected: int | None,
) -> None:
    """Order structured states without lexicographical comparisons."""
    assert compare_availability(current, previous) == expected


@pytest.mark.parametrize(
    "condition",
    [
        AlertCondition(AlertKind.BECOMES_AVAILABLE),
        AlertCondition(AlertKind.IMPROVES),
    ],
)
def test_baselines_and_provider_failures_never_alert(condition: AlertCondition) -> None:
    """Fail closed without two successful observations."""
    available = observation(AvailabilityStatus.AVAILABLE)
    failure = AvailabilityObservation.failed(ProviderFailure.UPSTREAM)

    assert not should_alert(condition=condition, previous=None, current=available)
    assert not should_alert(condition=condition, previous=failure, current=available)
    assert not should_alert(condition=condition, previous=available, current=failure)


def test_becomes_available_requires_a_real_transition() -> None:
    """Notify once on transition to available, including from provider REGRET."""
    condition = AlertCondition(AlertKind.BECOMES_AVAILABLE)

    assert should_alert(
        condition=condition,
        previous=observation(AvailabilityStatus.WAITLIST, 1),
        current=observation(AvailabilityStatus.AVAILABLE),
    )
    assert should_alert(
        condition=condition,
        previous=observation(AvailabilityStatus.REGRET),
        current=observation(AvailabilityStatus.AVAILABLE),
    )
    assert not should_alert(
        condition=condition,
        previous=observation(AvailabilityStatus.AVAILABLE),
        current=observation(AvailabilityStatus.AVAILABLE),
    )
    assert not should_alert(
        condition=condition,
        previous=observation(AvailabilityStatus.UNKNOWN),
        current=observation(AvailabilityStatus.AVAILABLE),
    )


def test_improvement_alert_requires_strict_improvement() -> None:
    """Notify for a lower position or better category, but not duplicates."""
    condition = AlertCondition(AlertKind.IMPROVES)

    assert should_alert(
        condition=condition,
        previous=observation(AvailabilityStatus.WAITLIST, 10),
        current=observation(AvailabilityStatus.WAITLIST, 5),
    )
    assert not should_alert(
        condition=condition,
        previous=observation(AvailabilityStatus.WAITLIST, 5),
        current=observation(AvailabilityStatus.WAITLIST, 5),
    )


def test_non_threshold_conditions_reject_target_fields() -> None:
    """Reject irrelevant configuration fields."""
    with pytest.raises(ValueError, match="only threshold alerts accept target fields"):
        AlertCondition(AlertKind.IMPROVES, AvailabilityStatus.RAC, 2)


@pytest.mark.parametrize(
    ("status", "position", "message"),
    [
        (AvailabilityStatus.AVAILABLE, 1, "does not accept"),
        (AvailabilityStatus.UNKNOWN, None, "must be AVAILABLE"),
        (AvailabilityStatus.RAC, None, "positive"),
        (AvailabilityStatus.WAITLIST, 0, "positive"),
    ],
)
def test_threshold_condition_validation(
    status: AvailabilityStatus, position: int | None, message: str
) -> None:
    """Require a meaningful threshold status and numeric position."""
    with pytest.raises(ValueError, match=message):
        AlertCondition(AlertKind.REACHES_THRESHOLD, status, position)


@pytest.mark.parametrize(
    ("condition", "before", "after", "expected"),
    [
        (
            AlertCondition(AlertKind.REACHES_THRESHOLD, AvailabilityStatus.AVAILABLE),
            observation(AvailabilityStatus.RAC, 1),
            observation(AvailabilityStatus.AVAILABLE),
            True,
        ),
        (
            AlertCondition(AlertKind.REACHES_THRESHOLD, AvailabilityStatus.RAC, 5),
            observation(AvailabilityStatus.WAITLIST, 1),
            observation(AvailabilityStatus.RAC, 5),
            True,
        ),
        (
            AlertCondition(AlertKind.REACHES_THRESHOLD, AvailabilityStatus.RAC, 5),
            observation(AvailabilityStatus.RAC, 8),
            observation(AvailabilityStatus.RAC, 4),
            True,
        ),
        (
            AlertCondition(AlertKind.REACHES_THRESHOLD, AvailabilityStatus.WAITLIST, 10),
            observation(AvailabilityStatus.WAITLIST, 12),
            observation(AvailabilityStatus.RAC, 20),
            True,
        ),
        (
            AlertCondition(AlertKind.REACHES_THRESHOLD, AvailabilityStatus.WAITLIST, 10),
            observation(AvailabilityStatus.WAITLIST, 8),
            observation(AvailabilityStatus.WAITLIST, 5),
            False,
        ),
        (
            AlertCondition(AlertKind.REACHES_THRESHOLD, AvailabilityStatus.WAITLIST, 10),
            observation(AvailabilityStatus.UNKNOWN),
            observation(AvailabilityStatus.WAITLIST, 5),
            False,
        ),
        (
            AlertCondition(AlertKind.REACHES_THRESHOLD, AvailabilityStatus.WAITLIST, 10),
            observation(AvailabilityStatus.WAITLIST, 12),
            observation(AvailabilityStatus.REGRET),
            False,
        ),
    ],
)
def test_threshold_alerts_only_fire_when_crossing_target(
    condition: AlertCondition,
    before: AvailabilityObservation,
    after: AvailabilityObservation,
    expected: bool,
) -> None:
    """Evaluate status rank and same-category numeric thresholds."""
    assert should_alert(condition=condition, previous=before, current=after) is expected
