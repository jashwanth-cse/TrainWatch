"""Train query identity and watch lifecycle rules."""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, replace
from datetime import date, datetime
from enum import StrEnum

from trainwatch.domain.alerts import AlertCondition

TRAVEL_CLASSES = frozenset({"1A", "2A", "3A", "3E", "SL", "CC", "2S", "EC", "EA", "FC", "GN"})
QUOTAS = frozenset({"GN", "TQ", "PT", "LD", "SS", "DF", "FT", "HP", "DP", "OS", "RAC"})
_TRAIN_NUMBER = re.compile(r"[0-9]{4,5}")
_STATION_CODE = re.compile(r"[A-Z]{2,5}")


@dataclass(frozen=True, slots=True)
class TrainQuery:
    """Canonical fields that identify one provider availability query."""

    train_number: str
    source: str
    destination: str
    journey_date: date
    travel_class: str
    quota: str = "GN"

    def __post_init__(self) -> None:
        """Normalize safe textual differences and enforce query invariants."""
        train_number = self.train_number.strip()
        source = self.source.strip().upper()
        destination = self.destination.strip().upper()
        travel_class = self.travel_class.strip().upper()
        quota = self.quota.strip().upper()

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

    def __post_init__(self) -> None:
        """Reject identifiers and timestamps that cannot represent a valid watch."""
        if not self.watch_id.strip():
            raise ValueError("watch_id must not be blank")
        if not self.owner_id.strip():
            raise ValueError("owner_id must not be blank")
        if self.updated_at < self.created_at:
            raise ValueError("updated_at must not precede created_at")

    def transition(self, target: WatchStatus, *, at: datetime) -> Watch:
        """Return a new watch after a permitted lifecycle transition."""
        if target == self.status:
            return self
        if target not in _TRANSITIONS[self.status]:
            raise ValueError(f"cannot transition watch from {self.status} to {target}")
        if at < self.updated_at:
            raise ValueError("transition time must not precede updated_at")
        return replace(self, status=target, updated_at=at)

    def expire_if_due(self, *, today: date, at: datetime) -> Watch:
        """Expire an active or paused watch after its journey date."""
        if today <= self.query.journey_date or self.status in {
            WatchStatus.CANCELLED,
            WatchStatus.EXPIRED,
        }:
            return self
        return self.transition(WatchStatus.EXPIRED, at=at)
