"""Train query identity and watch lifecycle rules."""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, replace
from datetime import UTC, date, datetime, time, timedelta, timezone
from enum import StrEnum

from trainwatch.domain.alerts import AlertCondition

IST = timezone(timedelta(hours=5, minutes=30))
TRAVEL_CLASSES = frozenset({"1A", "2A", "3A", "3E", "SL", "CC", "2S", "EC", "EA", "FC", "GN"})
QUOTAS = frozenset({"GN", "TQ", "PT", "LD", "SS", "DF", "FT", "HP", "DP", "OS", "RAC"})
_TRAIN_NUMBER = re.compile(r"[0-9]{4,5}")
_STATION_CODE = re.compile(r"[A-Z]{2,5}")
_DEPARTURE_TIME = re.compile(r"^([01]?\d|2[0-3]):([0-5]\d)$")


def normalize_departure_time(value: str | None) -> str | None:
    """Normalize an optional 24-hour HH:MM departure time string."""
    if value is None:
        return None
    stripped = value.strip()
    if not stripped:
        return None
    match = _DEPARTURE_TIME.fullmatch(stripped)
    if match is None:
        raise ValueError("departure_time must be in HH:MM 24-hour format")
    return f"{int(match.group(1)):02d}:{match.group(2)}"


def compute_departure_at(*, journey_date: date, departure_time: str | None) -> datetime:
    """Compute the UTC instant for a train's scheduled IST departure."""
    normalized = normalize_departure_time(departure_time)
    if normalized is not None:
        hour_str, minute_str = normalized.split(":", 1)
        dep_clock = time(int(hour_str), int(minute_str), 0)
    else:
        dep_clock = time(23, 59, 59)
    return datetime.combine(journey_date, dep_clock, tzinfo=IST).astimezone(UTC)


@dataclass(frozen=True, slots=True)
class TrainQuery:
    """Canonical fields that identify one provider availability query."""

    train_number: str
    source: str
    destination: str
    journey_date: date
    travel_class: str
    quota: str = "GN"
    departure_time: str | None = None

    def __post_init__(self) -> None:
        """Normalize safe textual differences and enforce query invariants."""
        train_number = self.train_number.strip()
        source = self.source.strip().upper()
        destination = self.destination.strip().upper()
        travel_class = self.travel_class.strip().upper()
        quota = self.quota.strip().upper()
        departure_time = normalize_departure_time(self.departure_time)

        if _TRAIN_NUMBER.fullmatch(train_number) is None:
            raise ValueError("train_number must contain 4 or 5 digits")
        if _STATION_CODE.fullmatch(source) is None:
            raise ValueError("source must contain 2 to 5 letters")
        if _STATION_CODE.fullmatch(destination) is None:
            raise ValueError("destination must contain 2 to 5 letters")
        if source == destination:
            raise ValueError("source and destination must differ")
        if travel_class not in TRAVEL_CLASSES:
            raise ValueError("unsupported travel_class")
        if quota not in QUOTAS:
            raise ValueError("unsupported quota")

        object.__setattr__(self, "train_number", train_number)
        object.__setattr__(self, "source", source)
        object.__setattr__(self, "destination", destination)
        object.__setattr__(self, "travel_class", travel_class)
        object.__setattr__(self, "quota", quota)
        object.__setattr__(self, "departure_time", departure_time)

    @property
    def watch_key(self) -> str:
        """Return a stable versioned digest without exposing query values."""
        canonical_fields = [
            self.train_number,
            self.source,
            self.destination,
            self.journey_date.isoformat(),
            self.travel_class,
            self.quota,
        ]
        payload = json.dumps(canonical_fields, separators=(",", ":"), ensure_ascii=True)
        digest = hashlib.sha256(payload.encode("ascii")).hexdigest()
        return f"v1:{digest}"


class WatchStatus(StrEnum):
    """Supported user-watch lifecycle states."""

    ACTIVE = "active"
    PAUSED = "paused"
    CANCELLED = "cancelled"
    EXPIRED = "expired"


_TRANSITIONS: dict[WatchStatus, frozenset[WatchStatus]] = {
    WatchStatus.ACTIVE: frozenset({WatchStatus.PAUSED, WatchStatus.CANCELLED, WatchStatus.EXPIRED}),
    WatchStatus.PAUSED: frozenset({WatchStatus.ACTIVE, WatchStatus.CANCELLED, WatchStatus.EXPIRED}),
    WatchStatus.CANCELLED: frozenset(),
    WatchStatus.EXPIRED: frozenset(),
}


@dataclass(frozen=True, slots=True)
class Watch:
    """A user watch with immutable, explicitly transitioned state."""

    watch_id: str
    owner_id: str
    query: TrainQuery
    condition: AlertCondition
    status: WatchStatus
    created_at: datetime
    updated_at: datetime
    departure_at: datetime | None = None
    last_avl_count: int | None = None
    last_alerted_avl: int | None = None
    expired_reason: str | None = None

    def __post_init__(self) -> None:
        """Reject identifiers and timestamps that cannot represent a valid watch."""
        if not self.watch_id.strip():
            raise ValueError("watch_id must not be blank")
        if not self.owner_id.strip():
            raise ValueError("owner_id must not be blank")
        if self.updated_at < self.created_at:
            raise ValueError("updated_at must not precede created_at")

    @property
    def is_active(self) -> bool:
        """Return whether background monitoring is enabled for this watch."""
        return self.status is WatchStatus.ACTIVE

    def effective_departure_at(self) -> datetime:
        """Return the UTC departure instant used to auto-dissolve expired alerts."""
        if self.departure_at is not None:
            if self.departure_at.tzinfo is None:
                return self.departure_at.replace(tzinfo=UTC)
            return self.departure_at.astimezone(UTC)
        return compute_departure_at(
            journey_date=self.query.journey_date,
            departure_time=self.query.departure_time,
        )

    def is_departed(self, *, at: datetime) -> bool:
        """Return True once the scheduled departure instant has passed."""
        at_utc = at.replace(tzinfo=UTC) if at.tzinfo is None else at.astimezone(UTC)
        return at_utc >= self.effective_departure_at()

    def transition(self, target: WatchStatus, *, at: datetime) -> Watch:
        """Return a new watch after a permitted lifecycle transition."""
        if target == self.status:
            return self
        if target not in _TRANSITIONS[self.status]:
            raise ValueError(f"cannot transition watch from {self.status} to {target}")
        if at < self.updated_at:
            raise ValueError("transition time must not precede updated_at")
        return replace(self, status=target, updated_at=at)

    def update_condition(self, condition: AlertCondition, *, at: datetime) -> Watch:
        """Update the alert condition on an active or paused watch."""
        if self.status in {WatchStatus.CANCELLED, WatchStatus.EXPIRED}:
            raise ValueError(f"cannot update condition on {self.status} watch")
        if at < self.updated_at:
            raise ValueError("update time must not precede updated_at")
        return replace(self, condition=condition, updated_at=at)

    def record_avl_observation(
        self,
        *,
        current_avl: int | None,
        alerted: bool,
        at: datetime,
    ) -> Watch:
        """Persist latest AVL seat count and last alerted seat watermark."""
        next_alerted = current_avl if alerted and current_avl is not None else self.last_alerted_avl
        if current_avl is None or (
            self.condition.maximum_position is not None
            and current_avl >= self.condition.maximum_position
        ):
            next_alerted = None
        return replace(
            self,
            last_avl_count=current_avl,
            last_alerted_avl=next_alerted,
            updated_at=at if at >= self.updated_at else self.updated_at,
        )

    def expire_if_due(self, *, today: date | None = None, at: datetime) -> Watch:
        """Expire an active or paused watch once train departure passes."""
        if self.status in {WatchStatus.CANCELLED, WatchStatus.EXPIRED}:
            return self
        has_date_passed = today is not None and today > self.query.journey_date
        if not self.is_departed(at=at) and not has_date_passed:
            return self
        return replace(
            self.transition(WatchStatus.EXPIRED, at=at),
            expired_reason="train_departed",
        )

    def dissolve_if_legacy(self, *, at: datetime) -> Watch:
        """Disable legacy RAC/WL alerts under the AVL-only monitoring policy."""
        if self.status in {WatchStatus.CANCELLED, WatchStatus.EXPIRED}:
            return self
        if self.condition.is_avl_only:
            return self
        return replace(
            self.transition(WatchStatus.EXPIRED, at=at),
            expired_reason="avl_only_policy",
        )

    def dissolve_if_due(self, *, at: datetime, today: date | None = None) -> Watch:
        """Auto-dissolve any departed or legacy watch cleanly."""
        return self.dissolve_if_legacy(at=at).expire_if_due(today=today, at=at)
