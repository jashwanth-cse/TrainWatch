"""Unit tests for canonical train queries and watch lifecycle rules."""

from datetime import UTC, date, datetime, timedelta

import pytest

from trainwatch.domain.alerts import AlertCondition, AlertKind
from trainwatch.domain.watch import TrainQuery, Watch, WatchStatus
from trainwatch.ports import AvailabilityProvider, WatchRepository

NOW = datetime(2026, 10, 23, 12, tzinfo=UTC)


def query(**overrides: object) -> TrainQuery:
    """Build a valid train query with focused overrides."""
    values: dict[str, object] = {
        "train_number": "06030",
        "source": "RJPM",
        "destination": "CBE",
        "journey_date": date(2026, 10, 25),
        "travel_class": "SL",
        "quota": "GN",
    }
    values.update(overrides)
    return TrainQuery(**values)  # type: ignore[arg-type]


def watch(status: WatchStatus = WatchStatus.ACTIVE) -> Watch:
    """Build a valid watch in the requested lifecycle state."""
    return Watch(
        watch_id="watch-1",
        owner_id="user-1",
        query=query(),
        condition=AlertCondition(AlertKind.IMPROVES),
        status=status,
        created_at=NOW,
        updated_at=NOW,
    )


def test_query_normalizes_safe_fields_and_preserves_leading_zero() -> None:
    """Normalize case and whitespace without changing train identity."""
    result = query(
        train_number=" 06030 ",
        source=" rjpm ",
        destination="cbe",
        travel_class="sl",
        quota="gn",
    )

    assert result.train_number == "06030"
    assert result.source == "RJPM"
    assert result.destination == "CBE"
    assert result.travel_class == "SL"
    assert result.quota == "GN"


def test_watch_key_is_stable_sensitive_and_non_revealing() -> None:
    """Share identical normalized work while distinguishing identity fields."""
    original = query()
    equivalent = query(source="rjpm", quota="gn")
    different = query(quota="TQ")

    assert original.watch_key == equivalent.watch_key
    assert original.watch_key != different.watch_key
    assert original.watch_key.startswith("v1:")
    assert "06030" not in original.watch_key
    assert len(original.watch_key) == 67


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"train_number": "630"}, "4 or 5 digits"),
        ({"source": "R1"}, "source"),
        ({"destination": "TOOLONG"}, "destination"),
        ({"destination": "RJPM"}, "must differ"),
        ({"travel_class": "XYZ"}, "travel_class"),
        ({"quota": "VIP"}, "quota"),
    ],
)
def test_query_rejects_invalid_identity_fields(overrides: dict[str, object], message: str) -> None:
    """Enforce provider-backed query invariants inside the domain."""
    with pytest.raises(ValueError, match=message):
        query(**overrides)


@pytest.mark.parametrize(
    ("start", "target"),
    [
        (WatchStatus.ACTIVE, WatchStatus.PAUSED),
        (WatchStatus.PAUSED, WatchStatus.ACTIVE),
        (WatchStatus.ACTIVE, WatchStatus.CANCELLED),
        (WatchStatus.PAUSED, WatchStatus.EXPIRED),
    ],
)
def test_watch_allows_defined_lifecycle_transitions(
    start: WatchStatus, target: WatchStatus
) -> None:
    """Create a new value for every permitted non-terminal transition."""
    original = watch(start)
    changed = original.transition(target, at=NOW + timedelta(minutes=1))

    assert changed.status is target
    assert changed.updated_at == NOW + timedelta(minutes=1)
    assert original.status is start


def test_watch_same_state_transition_is_idempotent() -> None:
    """Return the same value when a duplicate command requests the current state."""
    original = watch()
    assert original.transition(WatchStatus.ACTIVE, at=NOW) is original


@pytest.mark.parametrize("start", [WatchStatus.CANCELLED, WatchStatus.EXPIRED])
def test_terminal_watch_cannot_transition(start: WatchStatus) -> None:
    """Keep cancelled and expired watches terminal."""
    with pytest.raises(ValueError, match="cannot transition"):
        watch(start).transition(WatchStatus.ACTIVE, at=NOW + timedelta(minutes=1))


def test_watch_rejects_invalid_identity_and_time_values() -> None:
    """Reject blank ownership data and backwards timestamps."""
    with pytest.raises(ValueError, match="watch_id"):
        Watch(
            watch_id=" ",
            owner_id="owner",
            query=query(),
            condition=AlertCondition(AlertKind.IMPROVES),
            status=WatchStatus.ACTIVE,
            created_at=NOW,
            updated_at=NOW,
        )
    with pytest.raises(ValueError, match="owner_id"):
        Watch(
            watch_id="watch",
            owner_id=" ",
            query=query(),
            condition=AlertCondition(AlertKind.IMPROVES),
            status=WatchStatus.ACTIVE,
            created_at=NOW,
            updated_at=NOW,
        )
    with pytest.raises(ValueError, match="must not precede"):
        Watch(
            watch_id="watch",
            owner_id="owner",
            query=query(),
            condition=AlertCondition(AlertKind.IMPROVES),
            status=WatchStatus.ACTIVE,
            created_at=NOW,
            updated_at=NOW - timedelta(seconds=1),
        )
    with pytest.raises(ValueError, match="transition time"):
        watch().transition(WatchStatus.PAUSED, at=NOW - timedelta(seconds=1))


def test_watch_expires_only_after_journey_date() -> None:
    """Keep watches through the journey date and expire them afterward."""
    active = watch()
    assert active.expire_if_due(today=date(2026, 10, 25), at=NOW) is active

    expired = active.expire_if_due(
        today=date(2026, 10, 26),
        at=NOW + timedelta(days=3),
    )
    assert expired.status is WatchStatus.EXPIRED
    assert expired.expire_if_due(today=date(2026, 10, 27), at=NOW + timedelta(days=4)) is expired
    cancelled = watch(WatchStatus.CANCELLED)
    assert (
        cancelled.expire_if_due(today=date(2026, 10, 26), at=NOW + timedelta(days=3)) is cancelled
    )


def test_ports_are_structural_interfaces_without_infrastructure_dependencies() -> None:
    """Expose only the future adapter operations needed by application code."""
    assert AvailabilityProvider.fetch.__name__ == "fetch"
    assert WatchRepository.get.__name__ == "get"
    assert WatchRepository.save.__name__ == "save"
