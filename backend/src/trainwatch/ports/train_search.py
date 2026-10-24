"""Provider-independent station and train-search values."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Protocol

from trainwatch.domain.watch import QUOTAS, TRAVEL_CLASSES


@dataclass(frozen=True, slots=True)
class StationSuggestion:
    """One station returned by autocomplete."""

    name: str
    code: str
    latitude: float | None = None
    longitude: float | None = None


@dataclass(frozen=True, slots=True)
class TrainSearchQuery:
    """Validated fields accepted by the external train-search endpoint."""

    source: str
    destination: str
    journey_date: date
    travel_class: str | None = None
    quota: str = "GN"
    sort_by: str = "fare"

    def __post_init__(self) -> None:
        source = self.source.strip()
        destination = self.destination.strip()
        travel_class = self.travel_class.strip().upper() if self.travel_class else None
        quota = self.quota.strip().upper()
        sort_by = self.sort_by.strip().lower()
        if not source or not destination or source.casefold() == destination.casefold():
            raise ValueError("source and destination must be different non-empty stations")
        if travel_class is not None and travel_class not in TRAVEL_CLASSES:
            raise ValueError("unsupported travel_class")
        if quota not in QUOTAS:
            raise ValueError("unsupported quota")
        if sort_by not in {"fare", "departure", "arrival", "duration"}:
            raise ValueError("unsupported sort_by")
        object.__setattr__(self, "source", source)
        object.__setattr__(self, "destination", destination)
        object.__setattr__(self, "travel_class", travel_class)
        object.__setattr__(self, "quota", quota)
        object.__setattr__(self, "sort_by", sort_by)


@dataclass(frozen=True, slots=True)
class StationRef:
    """Station identity embedded in a train result."""

    code: str
    name: str


@dataclass(frozen=True, slots=True)
class ClassAvailability:
    """Class details actually supplied by train search."""

    travel_class: str
    fare: int | None
    availability: str | None
    bookable: bool | None
    source: str | None


@dataclass(frozen=True, slots=True)
class TrainSummary:
    """Stable train fields used by the mobile results screen."""

    number: str
    name: str
    source: StationRef
    destination: StationRef
    departure_time: str | None
    arrival_time: str | None
    duration: str | None
    running_days: tuple[str, ...]
    classes: tuple[ClassAvailability, ...]


@dataclass(frozen=True, slots=True)
class TrainSearchResult:
    """Typed route result without provider fallback internals."""

    result_type: str
    source: str
    destination: str
    trains: tuple[TrainSummary, ...]


class TrainSearchProvider(Protocol):
    """Search stations and trains behind one external-service boundary."""

    async def search_stations(self, query: str) -> tuple[StationSuggestion, ...]:
        """Return autocomplete suggestions for a non-empty query."""
        ...

    async def search_trains(self, query: TrainSearchQuery) -> TrainSearchResult:
        """Return typed trains for one journey search."""
        ...
