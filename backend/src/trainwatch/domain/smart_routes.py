"""Domain models and algorithms for multi-leg train berth splitting."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from enum import StrEnum

from trainwatch.domain.availability import AvailabilitySnapshot, AvailabilityStatus
from trainwatch.domain.watch import QUOTAS, TRAVEL_CLASSES

_TRAIN_NUMBER_PATTERN = re.compile(r"^\d{4,5}$")
_STATION_CODE_PATTERN = re.compile(r"^[A-Z0-9]{2,6}$")


class StationRole(StrEnum):
    """Hierarchical classification for intermediate split candidate stations."""

    ORIGIN = "ORIGIN"
    DESTINATION = "DESTINATION"
    MAJOR_HUB = "MAJOR_HUB"
    DIVISION_HQ = "DIVISION_HQ"
    JUNCTION = "JUNCTION"
    ADJACENT_HALT = "ADJACENT_HALT"


class SolutionTier(StrEnum):
    """Routing solution classification tier."""

    TIER_1_SAME_TRAIN_SPLIT = "TIER_1_SAME_TRAIN_SPLIT"
    TIER_2_ORIGIN_EXTENSION = "TIER_2_ORIGIN_EXTENSION"
    TIER_3_TRANSFER_BACKUP = "TIER_3_TRANSFER_BACKUP"


def compute_leg_horizon(duration_hours: float) -> int:
    """Compute maximum permitted leg horizon based on total journey duration.

    - Under 12 hours: Max 2 legs (1 split point).
    - 12 to 24 hours: Max 3 legs (2 split points).
    - Over 24 hours: Max 4 legs (3 split points).
    - Hard ceiling: 4 legs.
    """
    if duration_hours < 0:
        raise ValueError("journey duration cannot be negative")
    if duration_hours < 12.0:
        return 2
    if duration_hours <= 24.0:
        return 3
    return 4


@dataclass(frozen=True, slots=True)
class SubLeg:
    """A single leg segment of a journey solution."""

    leg_number: int
    train_no: str
    train_name: str
    from_station: str
    to_station: str
    travel_class: str
    quota: str
    status: AvailabilityStatus
    raw_status: str
    position: int | None = None
    fare: int | None = None
    departure_time: str | None = None
    arrival_time: str | None = None
    duration_minutes: int = 0
    distance_km: int = 0

    def __post_init__(self) -> None:
        if self.leg_number <= 0:
            raise ValueError("leg_number must be positive")
        if self.from_station == self.to_station:
            raise ValueError("from_station and to_station must differ")


@dataclass(frozen=True, slots=True)
class SmartRouteSolution:
    """A viable multi-leg or extended route option."""

    solution_id: str
    tier: SolutionTier
    legs: tuple[SubLeg, ...]
    total_fare: int | None
    fare_surcharge: int
    fare_surcharge_pct: float
    total_duration_minutes: int
    boarding_station: str | None
    is_confirmed: bool
    is_rac: bool
    recommendation_score: float
    split_stations: tuple[str, ...]

    def __post_init__(self) -> None:
        if not self.legs:
            raise ValueError("a solution must have at least one leg")


@dataclass(frozen=True, slots=True)
class SmartRouteQuery:
    """Validated query requesting smart berth splitting solutions."""

    train_no: str
    origin: str
    destination: str
    journey_date: date
    travel_class: str
    quota: str = "GN"

    def __post_init__(self) -> None:
        train_no = self.train_no.strip()
        origin = self.origin.strip().upper()
        destination = self.destination.strip().upper()
        travel_class = self.travel_class.strip().upper()
        quota = self.quota.strip().upper()

        if _TRAIN_NUMBER_PATTERN.fullmatch(train_no) is None:
            raise ValueError("train_no must contain 4 or 5 digits")
        if _STATION_CODE_PATTERN.fullmatch(origin) is None:
            raise ValueError("origin must contain 2 to 6 alphanumeric characters")
        if _STATION_CODE_PATTERN.fullmatch(destination) is None:
            raise ValueError("destination must contain 2 to 6 alphanumeric characters")
        if origin == destination:
            raise ValueError("origin and destination must differ")
        if travel_class not in TRAVEL_CLASSES:
            raise ValueError(f"unsupported travel_class '{travel_class}'")
        if quota not in QUOTAS:
            raise ValueError(f"unsupported quota '{quota}'")


@dataclass(frozen=True, slots=True)
class SmartRouteResult:
    """Overall outcome containing all discovered smart routing solutions."""

    train_no: str
    train_name: str
    origin: str
    destination: str
    journey_date: date
    travel_class: str
    journey_duration_hours: float
    journey_distance_km: int
    max_leg_horizon: int
    direct_status: AvailabilitySnapshot | None
    direct_fare: int | None
    solutions: tuple[SmartRouteSolution, ...]
    execution_time_ms: float
    stations_evaluated_count: int
    queries_executed_count: int


def calculate_recommendation_score(
    *,
    is_confirmed: bool,
    is_rac: bool,
    leg_count: int,
    fare_surcharge_pct: float,
    layover_penalty_minutes: int = 0,
) -> float:
    """Calculate normalized recommendation score (0.0 to 100.0).

    Base:
    - Confirmed: 100.0
    - RAC: 70.0
    - Waitlist: 20.0

    Penalties:
    - Extra leg penalty: -10.0 points per switch beyond direct.
    - Surcharge penalty: -1.0 point per 2% surcharge above direct fare.
    - Layover penalty (inter-train only): -0.5 point per 10 minutes wait.
    """
    if is_confirmed:
        base = 100.0
    elif is_rac:
        base = 70.0
    else:
        base = 20.0

    switches = max(0, leg_count - 1)
    switch_penalty = switches * 10.0
    surcharge_penalty = min(30.0, max(0.0, fare_surcharge_pct / 2.0))
    layover_penalty = min(20.0, max(0.0, layover_penalty_minutes / 20.0))

    score = base - switch_penalty - surcharge_penalty - layover_penalty
    return round(max(0.0, min(100.0, score)), 2)
