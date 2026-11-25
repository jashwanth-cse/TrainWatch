"""Unit tests for pure availability parsing and alert evaluation."""

from datetime import UTC, datetime

import pytest

from trainwatch.domain.alerts import (
    AlertCondition,
    AlertEventKind,
    AlertKind,
    AvlThresholdEvaluator,
    compose_avl_alert_message,
    should_alert,
)
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
        ("AVAILABLE", "AVAILABLE-0045", AvailabilityStatus.AVAILABLE, None),
        ("AVAILABLE", "AVBL 12", AvailabilityStatus.AVAILABLE, None),
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


def test_seats_below_condition_evaluation() -> None:
    cond = AlertCondition(AlertKind.SEATS_BELOW, maximum_position=25)

    def obs(status: AvailabilityStatus, raw: str) -> AvailabilityObservation:
        return AvailabilityObservation.success(AvailabilitySnapshot(status, raw, NOW, None))

    # Drops from 50 to 20 -> crosses below 25
    assert should_alert(
        condition=cond,
        previous=obs(AvailabilityStatus.AVAILABLE, "AVAILABLE 50"),
        current=obs(AvailabilityStatus.AVAILABLE, "AVAILABLE 20"),
    )
    # Exactly at threshold (50 to 25) is NOT strictly below 25
    assert not should_alert(
        condition=cond,
        previous=obs(AvailabilityStatus.AVAILABLE, "AVAILABLE 50"),
        current=obs(AvailabilityStatus.AVAILABLE, "AVAILABLE 25"),
    )
    # Stays above 25 (e.g. 50 to 30)
    assert not should_alert(
        condition=cond,
        previous=obs(AvailabilityStatus.AVAILABLE, "AVAILABLE 50"),
        current=obs(AvailabilityStatus.AVAILABLE, "AVAILABLE 30"),
    )
    # Already below 25 and drops further (20 to 15) -> rapid decrease alert ("book fast")
    assert should_alert(
        condition=cond,
        previous=obs(AvailabilityStatus.AVAILABLE, "AVAILABLE 20"),
        current=obs(AvailabilityStatus.AVAILABLE, "AVAILABLE 15"),
    )
    # Unchanged or increased while below 25 -> do not spam
    assert not should_alert(
        condition=cond,
        previous=obs(AvailabilityStatus.AVAILABLE, "AVAILABLE 15"),
        current=obs(AvailabilityStatus.AVAILABLE, "AVAILABLE 15"),
    )
    assert not should_alert(
        condition=cond,
        previous=obs(AvailabilityStatus.AVAILABLE, "AVAILABLE 15"),
        current=obs(AvailabilityStatus.AVAILABLE, "AVAILABLE 18"),
    )
    # Slips into RAC from AVAILABLE -> final sold-out alert
    assert should_alert(
        condition=cond,
        previous=obs(AvailabilityStatus.AVAILABLE, "AVAILABLE 5"),
        current=observation(AvailabilityStatus.RAC, 2),
    )
    # Stays in RAC (before was already not AVL) -> never alerts on RAC/WL
    assert not should_alert(
        condition=cond,
        previous=observation(AvailabilityStatus.RAC, 2),
        current=observation(AvailabilityStatus.RAC, 5),
    )
    # Unparseable seats
    assert not should_alert(
        condition=cond,
        previous=obs(AvailabilityStatus.AVAILABLE, "AVAILABLE"),
        current=obs(AvailabilityStatus.AVAILABLE, "AVAILABLE"),
    )


def test_avl_threshold_evaluator_full_lifecycle_and_messages() -> None:
    """Verify baseline seed, rapid drops, recovery re-crossing, and notification copy."""

    def snap(status: AvailabilityStatus, raw: str) -> AvailabilitySnapshot:
        return AvailabilitySnapshot(status, raw, NOW, None)

    # First check with initial fallback 150 -> 9 (< 10)
    cross = AvlThresholdEvaluator.evaluate(
        threshold=10,
        previous_snapshot=None,
        current_snapshot=snap(AvailabilityStatus.AVAILABLE, "AVL 9"),
        fallback_previous_avl=150,
    )
    assert cross.should_alert
    assert cross.event_kind is AlertEventKind.THRESHOLD_CROSSED
    assert cross.current_avl == 9
    assert cross.previous_avl == 150
    t1, b1 = compose_avl_alert_message(
        train_number="12661",
        travel_class="3A",
        journey_date="2026-12-10",
        threshold=10,
        evaluation=cross,
        snapshot=snap(AvailabilityStatus.AVAILABLE, "AVL 9"),
    )
    assert "Low Seat Alert" in t1 and "9 AVL" in b1 and "down from AVL 150" in b1

    # Subsequent rapid decrease 9 -> 6
    drop = AvlThresholdEvaluator.evaluate(
        threshold=10,
        previous_snapshot=snap(AvailabilityStatus.AVAILABLE, "AVL 9"),
        current_snapshot=snap(AvailabilityStatus.AVAILABLE, "AVL 6"),
    )
    assert drop.should_alert
    assert drop.event_kind is AlertEventKind.SEATS_DECREASING
    t2, b2 = compose_avl_alert_message(
        train_number="12661",
        travel_class="3A",
        journey_date="2026-12-10",
        threshold=10,
        evaluation=drop,
        snapshot=snap(AvailabilityStatus.AVAILABLE, "AVL 6"),
    )
    assert "Book Fast" in t2 and "6 AVL left (was AVL 9)" in b2

    # Sold out 6 -> RAC 3
    sold = AvlThresholdEvaluator.evaluate(
        threshold=10,
        previous_snapshot=snap(AvailabilityStatus.AVAILABLE, "AVL 6"),
        current_snapshot=AvailabilitySnapshot(AvailabilityStatus.RAC, "RAC 3", NOW, 3),
    )
    assert sold.should_alert and sold.event_kind is AlertEventKind.SOLD_OUT
    t3, b3 = compose_avl_alert_message(
        train_number="12661",
        travel_class="3A",
        journey_date="2026-12-10",
        threshold=10,
        evaluation=sold,
        snapshot=AvailabilitySnapshot(AvailabilityStatus.RAC, "RAC 3", NOW, 3),
    )
    assert "Confirmed Seats Gone" in t3 and "RAC 3" in b3

    # Recovery from RAC back to AVL 3 (< 10)
    reopen = AvlThresholdEvaluator.evaluate(
        threshold=10,
        previous_snapshot=AvailabilitySnapshot(AvailabilityStatus.RAC, "RAC 3", NOW, 3),
        current_snapshot=snap(AvailabilityStatus.AVAILABLE, "AVL 3"),
    )
    assert reopen.should_alert and reopen.event_kind is AlertEventKind.THRESHOLD_CROSSED

    # Fails closed on None / UNKNOWN
    unknown = AvlThresholdEvaluator.evaluate(
        threshold=10,
        previous_snapshot=None,
        current_snapshot=None,
    )
    assert not unknown.should_alert and unknown.event_kind is AlertEventKind.NONE


def test_rapid_rac_increase_evaluation() -> None:
    cond = AlertCondition(AlertKind.RAPID_RAC_INCREASE)

    # RAC increases by >= 5 (e.g. RAC 5 to RAC 12)
    assert should_alert(
        condition=cond,
        previous=observation(AvailabilityStatus.RAC, 5),
        current=observation(AvailabilityStatus.RAC, 12),
    )
    # RAC increases by < 5 (e.g. RAC 5 to RAC 7)
    assert not should_alert(
        condition=cond,
        previous=observation(AvailabilityStatus.RAC, 5),
        current=observation(AvailabilityStatus.RAC, 7),
    )
    # RAC slips into WL
    assert should_alert(
        condition=cond,
        previous=observation(AvailabilityStatus.RAC, 20),
        current=observation(AvailabilityStatus.WAITLIST, 2),
    )
    # Stays in WL (before was not RAC)
    assert not should_alert(
        condition=cond,
        previous=observation(AvailabilityStatus.WAITLIST, 2),
        current=observation(AvailabilityStatus.WAITLIST, 10),
    )


def test_seats_below_validation() -> None:
    with pytest.raises(ValueError, match="positive maximum_position"):
        AlertCondition(AlertKind.SEATS_BELOW, maximum_position=0)
    with pytest.raises(ValueError, match="AVAILABLE or None"):
        AlertCondition(
            AlertKind.SEATS_BELOW, target_status=AvailabilityStatus.RAC, maximum_position=10
        )


def test_rapid_rac_increase_validation() -> None:
    with pytest.raises(ValueError, match="does not accept target fields"):
        AlertCondition(AlertKind.RAPID_RAC_INCREASE, target_status=AvailabilityStatus.RAC)
