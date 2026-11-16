"""Comprehensive unit tests for Adaptive Stage-Gated DAG Search (ASG-DAG) engine."""

from datetime import UTC, date, datetime
from unittest.mock import AsyncMock

import pytest

from trainwatch.domain.availability import (
    AvailabilityObservation,
    AvailabilitySnapshot,
    AvailabilityStatus,
    ProviderFailure,
)
from trainwatch.domain.smart_routes import SmartRouteQuery, SolutionTier
from trainwatch.domain.watch import TrainQuery
from trainwatch.infrastructure.train_api.cdn_schedule import (
    CdnScheduleClient,
    ScheduleStop,
    TrainSchedule,
)
from trainwatch.infrastructure.train_api.client import DreamDestinyClient
from trainwatch.services.smart_routing_engine import SmartRoutingEngine


def _stop(
    num: int, name: str, code: str, arr: str, dep: str, halt: int, day: int, km: int
) -> ScheduleStop:
    return ScheduleStop(
        stop_number=num,
        station_name=name,
        station_code=code,
        arrival_time=arr,
        departure_time=dep,
        halt_minutes=halt,
        day=day,
        distance_km=km,
    )


def _make_mock_schedule(
    train_no: str = "12662",
    train_name: str = "Pothigai Express",
    stops: list[ScheduleStop] | None = None,
) -> TrainSchedule:
    if stops is None:
        stops = [
            _stop(1, "SENGOTTAI", "SCT", "18:50", "18:50", 0, 1, 0),
            _stop(2, "RAJAPALAYAM", "RJPM", "19:53", "19:55", 2, 1, 67),
            _stop(3, "VIRUDHUNAGAR JN", "VPT", "20:30", "20:32", 2, 1, 113),
            _stop(4, "MADURAI JN", "MDU", "21:15", "21:20", 5, 1, 156),
            _stop(5, "TIRUCHCHIRAPPALLI JN", "TPJ", "23:35", "23:40", 5, 1, 313),
            _stop(6, "VILLUPURAM JN", "VM", "02:30", "02:35", 5, 2, 491),
            _stop(7, "CHENNAI EGMORE", "MS", "06:40", "06:40", 0, 2, 668),
        ]

    return TrainSchedule(
        train_no=train_no,
        train_name=train_name,
        source_station_name=stops[0].station_name,
        source_station_code=stops[0].station_code,
        destination_station_name=stops[-1].station_name,
        destination_station_code=stops[-1].station_code,
        days_of_run=("DAILY",),
        classes=("SL", "3A", "2A"),
        total_duration_minutes=710,
        total_distance_km=stops[-1].distance_km,
        total_stops=len(stops),
        stops=tuple(stops),
    )


def _avail(
    status: AvailabilityStatus, raw: str, position: int | None = None
) -> AvailabilityObservation:
    snapshot = AvailabilitySnapshot(
        status=status,
        raw_availability=raw,
        observed_at=datetime.now(UTC),
        position=position,
    )
    return AvailabilityObservation.success(snapshot)


@pytest.mark.anyio
async def test_engine_discovers_confirmed_2leg_solution() -> None:
    """Verify 2-leg search discovers confirmed split at intermediate hub MDU."""
    mock_schedule = _make_mock_schedule()
    mock_sched_client = AsyncMock(spec=CdnScheduleClient)
    mock_sched_client.get_schedule.return_value = mock_schedule

    mock_train_client = AsyncMock(spec=DreamDestinyClient)

    async def mock_fetch(q: TrainQuery) -> tuple[AvailabilityObservation, int | None]:
        if q.source == "RJPM" and q.destination == "MS":
            return _avail(AvailabilityStatus.WAITLIST, "WL 10", 10), 380
        if q.source == "RJPM" and q.destination == "MDU":
            return _avail(AvailabilityStatus.AVAILABLE, "AVAILABLE 15"), 140
        if q.source == "MDU" and q.destination == "MS":
            return _avail(AvailabilityStatus.AVAILABLE, "AVAILABLE 4"), 280
        if q.source == "SCT" and q.destination == "MS":
            return _avail(AvailabilityStatus.WAITLIST, "WL 20", 20), 410
        return _avail(AvailabilityStatus.WAITLIST, "WL 8", 8), 200

    mock_train_client.fetch_with_fare.side_effect = mock_fetch

    engine = SmartRoutingEngine(
        schedule_client=mock_sched_client,
        train_client=mock_train_client,
    )

    query = SmartRouteQuery(
        train_no="12662",
        origin="RJPM",
        destination="MS",
        journey_date=date(2026, 12, 16),
        travel_class="SL",
    )

    result = await engine.search(query)

    assert result.train_no == "12662"
    assert result.max_leg_horizon == 2
    assert result.direct_status is not None
    assert result.direct_status.status is AvailabilityStatus.WAITLIST

    assert len(result.solutions) >= 1
    best_sol = result.solutions[0]
    assert best_sol.is_confirmed is True
    assert best_sol.tier == SolutionTier.TIER_1_SAME_TRAIN_SPLIT
    assert best_sol.split_stations == ("MDU",)
    assert len(best_sol.legs) == 2
    assert best_sol.legs[0].from_station == "RJPM"
    assert best_sol.legs[0].to_station == "MDU"
    assert best_sol.legs[0].status is AvailabilityStatus.AVAILABLE
    assert best_sol.legs[1].from_station == "MDU"
    assert best_sol.legs[1].to_station == "MS"
    assert best_sol.legs[1].status is AvailabilityStatus.AVAILABLE
    assert best_sol.total_fare == 420
    assert best_sol.fare_surcharge == 40


@pytest.mark.anyio
async def test_engine_short_circuit_pruning() -> None:
    """Verify that if Leg 1 (O -> s) is waitlisted, Leg 2 (s -> D) is NEVER queried."""
    mock_schedule = _make_mock_schedule()
    mock_sched_client = AsyncMock(spec=CdnScheduleClient)
    mock_sched_client.get_schedule.return_value = mock_schedule

    mock_train_client = AsyncMock(spec=DreamDestinyClient)

    queried_destinations_from_vpt = []

    async def mock_fetch(q: TrainQuery) -> tuple[AvailabilityObservation, int | None]:
        if q.source == "VPT":
            queried_destinations_from_vpt.append(q.destination)
        return _avail(AvailabilityStatus.WAITLIST, "WL 5", 5), 150

    mock_train_client.fetch_with_fare.side_effect = mock_fetch

    engine = SmartRoutingEngine(
        schedule_client=mock_sched_client,
        train_client=mock_train_client,
    )

    query = SmartRouteQuery(
        train_no="12662",
        origin="RJPM",
        destination="MS",
        journey_date=date(2026, 12, 16),
        travel_class="SL",
    )

    result = await engine.search(query)
    assert "MS" not in queried_destinations_from_vpt
    assert all(not sol.is_confirmed for sol in result.solutions)


@pytest.mark.anyio
async def test_engine_tier2_origin_extension() -> None:
    """Verify Tier 2 Origin Extension is selected when direct is RAC and origin has better seat."""
    mock_schedule = _make_mock_schedule()
    mock_sched_client = AsyncMock(spec=CdnScheduleClient)
    mock_sched_client.get_schedule.return_value = mock_schedule

    mock_train_client = AsyncMock(spec=DreamDestinyClient)

    async def mock_fetch(q: TrainQuery) -> tuple[AvailabilityObservation, int | None]:
        if q.source == "RJPM" and q.destination == "MS":
            return _avail(AvailabilityStatus.RAC, "RAC 99", 99), 380
        if q.source == "SCT" and q.destination == "MS":
            return _avail(AvailabilityStatus.AVAILABLE, "AVAILABLE 20"), 410
        return _avail(AvailabilityStatus.WAITLIST, "WL 2", 2), 150

    mock_train_client.fetch_with_fare.side_effect = mock_fetch

    engine = SmartRoutingEngine(
        schedule_client=mock_sched_client,
        train_client=mock_train_client,
    )

    query = SmartRouteQuery(
        train_no="12662",
        origin="RJPM",
        destination="MS",
        journey_date=date(2026, 12, 16),
        travel_class="SL",
    )

    result = await engine.search(query)
    ext_solutions = [s for s in result.solutions if s.tier == SolutionTier.TIER_2_ORIGIN_EXTENSION]
    assert len(ext_solutions) == 1
    ext_sol = ext_solutions[0]
    assert ext_sol.is_confirmed is True
    assert ext_sol.boarding_station == "RJPM"
    assert ext_sol.legs[0].from_station == "SCT"
    assert ext_sol.legs[0].to_station == "MS"
    assert ext_sol.fare_surcharge == 30


@pytest.mark.anyio
async def test_engine_graceful_error_resilience() -> None:
    """Verify engine handles upstream timeouts on individual legs without crashing."""
    mock_schedule = _make_mock_schedule()
    mock_sched_client = AsyncMock(spec=CdnScheduleClient)
    mock_sched_client.get_schedule.return_value = mock_schedule

    mock_train_client = AsyncMock(spec=DreamDestinyClient)

    async def mock_fetch(q: TrainQuery) -> tuple[AvailabilityObservation, int | None]:
        if q.source == "RJPM" and q.destination == "MDU":
            raise TimeoutError("Upstream timeout")
        if q.source == "RJPM" and q.destination == "TPJ":
            return AvailabilityObservation.failed(ProviderFailure.TIMEOUT), None
        return _avail(AvailabilityStatus.WAITLIST, "WL 3", 3), 200

    mock_train_client.fetch_with_fare.side_effect = mock_fetch

    engine = SmartRoutingEngine(
        schedule_client=mock_sched_client,
        train_client=mock_train_client,
    )

    query = SmartRouteQuery(
        train_no="12662",
        origin="RJPM",
        destination="MS",
        journey_date=date(2026, 12, 16),
        travel_class="SL",
    )

    result = await engine.search(query)
    assert result.train_no == "12662"
    assert isinstance(result.execution_time_ms, float)


@pytest.mark.anyio
async def test_engine_3leg_expansion_for_long_journey() -> None:
    """Verify 3-leg expansion is triggered for journeys between 12 and 24 hours."""
    stops = [
        _stop(1, "KANYAKUMARI", "CAPE", "06:00", "06:00", 0, 1, 0),
        _stop(2, "HUB1", "MDU", "10:00", "10:10", 10, 1, 200),
        _stop(3, "HUB2", "TPJ", "14:00", "14:10", 10, 1, 450),
        _stop(4, "DEST", "MS", "22:30", "22:30", 0, 1, 900),
    ]
    mock_schedule = _make_mock_schedule(train_no="12345", stops=stops)
    mock_sched_client = AsyncMock(spec=CdnScheduleClient)
    mock_sched_client.get_schedule.return_value = mock_schedule

    mock_train_client = AsyncMock(spec=DreamDestinyClient)

    async def mock_fetch(q: TrainQuery) -> tuple[AvailabilityObservation, int | None]:
        if q.source == "CAPE" and q.destination == "MDU":
            return _avail(AvailabilityStatus.AVAILABLE, "AVAILABLE 8"), 200
        if q.source == "MDU" and q.destination == "TPJ":
            return _avail(AvailabilityStatus.AVAILABLE, "AVAILABLE 5"), 150
        if q.source == "TPJ" and q.destination == "MS":
            return _avail(AvailabilityStatus.AVAILABLE, "AVAILABLE 12"), 250
        return _avail(AvailabilityStatus.WAITLIST, "WL 10", 10), 500

    mock_train_client.fetch_with_fare.side_effect = mock_fetch

    engine = SmartRoutingEngine(
        schedule_client=mock_sched_client,
        train_client=mock_train_client,
    )

    query = SmartRouteQuery(
        train_no="12345",
        origin="CAPE",
        destination="MS",
        journey_date=date(2026, 12, 16),
        travel_class="SL",
    )

    result = await engine.search(query)
    assert result.max_leg_horizon == 3
    confirmed_sols = [s for s in result.solutions if s.is_confirmed and len(s.legs) == 3]
    assert len(confirmed_sols) == 1
    assert confirmed_sols[0].split_stations == ("MDU", "TPJ")
    assert confirmed_sols[0].total_fare == 600
