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
    TrainScheduleError,
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
    total_duration_minutes: int | None = None,
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
        total_duration_minutes=total_duration_minutes
        if total_duration_minutes is not None
        else 710,
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


@pytest.mark.anyio
async def test_engine_schedule_failures_and_empty_intermediates() -> None:
    """Verify schedule retrieval error, subroute error, and no intermediate stops."""
    mock_sched_client = AsyncMock(spec=CdnScheduleClient)
    mock_train_client = AsyncMock(spec=DreamDestinyClient)

    # 1. Schedule fetch error
    mock_sched_client.get_schedule.side_effect = TrainScheduleError("Down")
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
    res1 = await engine.search(query)
    assert len(res1.solutions) == 0

    # 2. Subroute error (stations not in schedule)
    mock_sched = _make_mock_schedule()
    mock_sched_client.get_schedule.side_effect = None
    mock_sched_client.get_schedule.return_value = mock_sched
    query_invalid_stn = SmartRouteQuery(
        train_no="12662",
        origin="RJPM",
        destination="NDLS",  # Not on route
        journey_date=date(2026, 12, 16),
        travel_class="SL",
    )
    res2 = await engine.search(query_invalid_stn)
    assert len(res2.solutions) == 0

    # 3. Direct adjacent stops (no intermediate stops)
    direct_adjacent_stops = [
        _stop(1, "SENGOTTAI", "SCT", "18:50", "18:50", 0, 1, 0),
        _stop(2, "TENKASI", "TSI", "19:05", "19:05", 0, 1, 8),
    ]
    mock_sched_adj = _make_mock_schedule(stops=direct_adjacent_stops)
    mock_sched_client.get_schedule.return_value = mock_sched_adj
    mock_train_client.fetch_with_fare.return_value = (
        _avail(AvailabilityStatus.AVAILABLE, "AVAILABLE 50"),
        60,
    )
    query_adj = SmartRouteQuery(
        train_no="12662",
        origin="SCT",
        destination="TSI",
        journey_date=date(2026, 12, 16),
        travel_class="SL",
    )
    res3 = await engine.search(query_adj)
    assert res3.direct_status is not None
    assert res3.direct_status.status is AvailabilityStatus.AVAILABLE
    assert len(res3.solutions) == 0


@pytest.mark.anyio
async def test_engine_4leg_expansion_for_cross_country_journey() -> None:
    """Verify 4-leg expansion is triggered for journeys longer than 24 hours."""
    # 28-hour journey across 5 stops
    stops = [
        _stop(1, "NEW DELHI", "NDLS", "06:00", "06:00", 0, 1, 0),
        _stop(2, "BHOPAL", "BPL", "14:00", "14:10", 10, 1, 700),
        _stop(3, "NAGPUR", "NGP", "22:00", "22:10", 10, 1, 1090),
        _stop(4, "VIJAYAWADA", "BZA", "06:00", "06:10", 10, 2, 1750),
        _stop(5, "CHENNAI", "MAS", "10:30", "10:30", 0, 2, 2180),
    ]
    mock_schedule = _make_mock_schedule(train_no="12622", stops=stops, total_duration_minutes=1800)
    mock_sched_client = AsyncMock(spec=CdnScheduleClient)
    mock_sched_client.get_schedule.return_value = mock_schedule
    mock_train_client = AsyncMock(spec=DreamDestinyClient)

    # Direct NDLS -> MAS is WL
    # 2-leg splits fail: NDLS -> BPL is AVL, BPL -> MAS is WL; NDLS -> NGP is WL; NDLS -> BZA is WL
    # 3-leg splits fail: BPL -> NGP is AVL, NGP -> MAS is WL; BPL -> BZA is WL
    # 4-leg split succeeds:
    # Leg 1: NDLS -> BPL (AVL)
    # Leg 2: BPL -> NGP (AVL)
    # Leg 3: NGP -> BZA (AVL)
    # Leg 4: BZA -> MAS (AVL)
    async def mock_fetch(q: TrainQuery) -> tuple[AvailabilityObservation, int | None]:
        if q.source == "NDLS" and q.destination == "BPL":
            return _avail(AvailabilityStatus.AVAILABLE, "AVL 10"), 300
        if q.source == "BPL" and q.destination == "NGP":
            return _avail(AvailabilityStatus.AVAILABLE, "AVL 8"), 250
        if q.source == "NGP" and q.destination == "BZA":
            return _avail(AvailabilityStatus.AVAILABLE, "AVL 6"), 350
        if q.source == "BZA" and q.destination == "MAS":
            return _avail(AvailabilityStatus.AVAILABLE, "AVL 14"), 200
        return _avail(AvailabilityStatus.WAITLIST, "WL 25", 25), 850

    mock_train_client.fetch_with_fare.side_effect = mock_fetch

    engine = SmartRoutingEngine(
        schedule_client=mock_sched_client,
        train_client=mock_train_client,
    )
    query = SmartRouteQuery(
        train_no="12622",
        origin="NDLS",
        destination="MAS",
        journey_date=date(2026, 12, 16),
        travel_class="SL",
    )
    result = await engine.search(query)
    assert result.max_leg_horizon == 4  # 28.5 hours journey -> max 4 legs
    confirmed_4leg = [s for s in result.solutions if s.is_confirmed and len(s.legs) == 4]
    assert len(confirmed_4leg) == 1
    sol = confirmed_4leg[0]
    assert sol.split_stations == ("BPL", "NGP", "BZA")
    assert sol.total_fare == 1100


@pytest.mark.anyio
async def test_engine_origin_extension_guardrails() -> None:
    """Verify origin extension guardrails: surcharge limits, RAC improvements, direct available."""
    mock_schedule = _make_mock_schedule()
    mock_sched_client = AsyncMock(spec=CdnScheduleClient)
    mock_sched_client.get_schedule.return_value = mock_schedule
    mock_train_client = AsyncMock(spec=DreamDestinyClient)

    # 1. Direct is ALREADY AVAILABLE -> origin extension skipped
    async def mock_fetch_direct_avail(q: TrainQuery) -> tuple[AvailabilityObservation, int | None]:
        if q.source == "RJPM" and q.destination == "MS":
            return _avail(AvailabilityStatus.AVAILABLE, "AVAILABLE 25"), 380
        return _avail(AvailabilityStatus.AVAILABLE, "AVAILABLE 50"), 410

    mock_train_client.fetch_with_fare.side_effect = mock_fetch_direct_avail
    engine1 = SmartRoutingEngine(schedule_client=mock_sched_client, train_client=mock_train_client)
    res1 = await engine1.search(
        SmartRouteQuery(
            train_no="12662",
            origin="RJPM",
            destination="MS",
            journey_date=date(2026, 12, 16),
            travel_class="SL",
        )
    )
    ext1 = [s for s in res1.solutions if s.tier == SolutionTier.TIER_2_ORIGIN_EXTENSION]
    assert len(ext1) == 0

    # 2. Surcharge > 100 in SL -> origin extension skipped
    async def mock_fetch_high_surcharge(
        q: TrainQuery,
    ) -> tuple[AvailabilityObservation, int | None]:
        if q.source == "RJPM" and q.destination == "MS":
            return _avail(AvailabilityStatus.WAITLIST, "WL 10", 10), 300
        if q.source == "SCT" and q.destination == "MS":
            return _avail(AvailabilityStatus.AVAILABLE, "AVAILABLE 5"), 450  # diff = 150 > 100
        return _avail(AvailabilityStatus.WAITLIST, "WL 2", 2), 200

    mock_train_client.fetch_with_fare.side_effect = mock_fetch_high_surcharge
    engine2 = SmartRoutingEngine(schedule_client=mock_sched_client, train_client=mock_train_client)
    res2 = await engine2.search(
        SmartRouteQuery(
            train_no="12662",
            origin="RJPM",
            destination="MS",
            journey_date=date(2026, 12, 16),
            travel_class="SL",
        )
    )
    ext2 = [s for s in res2.solutions if s.tier == SolutionTier.TIER_2_ORIGIN_EXTENSION]
    assert len(ext2) == 0

    # 3. Direct RAC 50 and Extension RAC 60 (worse position) -> origin extension skipped
    async def mock_fetch_worse_rac(q: TrainQuery) -> tuple[AvailabilityObservation, int | None]:
        if q.source == "RJPM" and q.destination == "MS":
            return _avail(AvailabilityStatus.RAC, "RAC 50", 50), 380
        if q.source == "SCT" and q.destination == "MS":
            return _avail(AvailabilityStatus.RAC, "RAC 60", 60), 400
        return _avail(AvailabilityStatus.WAITLIST, "WL 5", 5), 200

    mock_train_client.fetch_with_fare.side_effect = mock_fetch_worse_rac
    engine3 = SmartRoutingEngine(schedule_client=mock_sched_client, train_client=mock_train_client)
    res3 = await engine3.search(
        SmartRouteQuery(
            train_no="12662",
            origin="RJPM",
            destination="MS",
            journey_date=date(2026, 12, 16),
            travel_class="SL",
        )
    )
    ext3 = [s for s in res3.solutions if s.tier == SolutionTier.TIER_2_ORIGIN_EXTENSION]
    assert len(ext3) == 0

    # 4. Surcharge > 20% in 3AC -> origin extension skipped
    async def mock_fetch_3a_surcharge(q: TrainQuery) -> tuple[AvailabilityObservation, int | None]:
        if q.source == "RJPM" and q.destination == "MS":
            return _avail(AvailabilityStatus.WAITLIST, "WL 5", 5), 1000
        if q.source == "SCT" and q.destination == "MS":
            return _avail(AvailabilityStatus.AVAILABLE, "AVAILABLE 2"), 1300  # 30% surcharge
        return _avail(AvailabilityStatus.WAITLIST, "WL 2", 2), 500

    mock_train_client.fetch_with_fare.side_effect = mock_fetch_3a_surcharge
    engine4 = SmartRoutingEngine(schedule_client=mock_sched_client, train_client=mock_train_client)
    res4 = await engine4.search(
        SmartRouteQuery(
            train_no="12662",
            origin="RJPM",
            destination="MS",
            journey_date=date(2026, 12, 16),
            travel_class="3A",
        )
    )
    ext4 = [s for s in res4.solutions if s.tier == SolutionTier.TIER_2_ORIGIN_EXTENSION]
    assert len(ext4) == 0

    # 5. Extension query failure -> returns None
    async def mock_fetch_fail(q: TrainQuery) -> tuple[AvailabilityObservation, int | None]:
        return AvailabilityObservation.failed(ProviderFailure.TIMEOUT), None

    mock_train_client.fetch_with_fare.side_effect = mock_fetch_fail
    engine5 = SmartRoutingEngine(schedule_client=mock_sched_client, train_client=mock_train_client)
    res5 = await engine5.search(
        SmartRouteQuery(
            train_no="12662",
            origin="RJPM",
            destination="MS",
            journey_date=date(2026, 12, 16),
            travel_class="SL",
        )
    )
    assert len(res5.solutions) == 0


@pytest.mark.anyio
async def test_engine_subleg_failure_branches() -> None:
    """Verify pruning branches when intermediate sub-legs fail or return waitlist."""
    stops = [
        _stop(1, "NEW DELHI", "NDLS", "06:00", "06:00", 0, 1, 0),
        _stop(2, "BHOPAL", "BPL", "14:00", "14:10", 10, 1, 700),
        _stop(3, "NAGPUR", "NGP", "22:00", "22:10", 10, 1, 1090),
        _stop(4, "VIJAYAWADA", "BZA", "06:00", "06:10", 10, 2, 1750),
        _stop(5, "CHENNAI", "MAS", "10:30", "10:30", 0, 2, 2180),
    ]
    mock_schedule = _make_mock_schedule(train_no="12622", stops=stops, total_duration_minutes=1800)
    mock_sched_client = AsyncMock(spec=CdnScheduleClient)
    mock_sched_client.get_schedule.return_value = mock_schedule
    mock_train_client = AsyncMock(spec=DreamDestinyClient)

    # Leg 1 is AVL, but downstream legs return None / failure or WL
    async def mock_fetch_downstream_fail(
        q: TrainQuery,
    ) -> tuple[AvailabilityObservation, int | None]:
        if q.source == "NDLS" and q.destination == "BPL":
            return _avail(AvailabilityStatus.AVAILABLE, "AVL 5"), 300
        if q.source == "BPL" and q.destination == "NGP":
            return AvailabilityObservation.failed(ProviderFailure.THROTTLED), None
        return _avail(AvailabilityStatus.WAITLIST, "WL 10", 10), 500

    mock_train_client.fetch_with_fare.side_effect = mock_fetch_downstream_fail
    engine = SmartRoutingEngine(schedule_client=mock_sched_client, train_client=mock_train_client)
    res = await engine.search(
        SmartRouteQuery(
            train_no="12622",
            origin="NDLS",
            destination="MAS",
            journey_date=date(2026, 12, 16),
            travel_class="SL",
        )
    )
    assert all(not s.is_confirmed for s in res.solutions)


@pytest.mark.anyio
async def test_engine_empty_multileg_tasks_and_edge_branches() -> None:
    """Verify empty stage3/stage4 branches when candidate intermediate stops are sparse."""
    # Journey > 24 hours (so max_leg_horizon == 4), but only 1 candidate stop in between
    stops = [
        _stop(1, "START", "DLI", "06:00", "06:00", 0, 1, 0),
        _stop(2, "MID", "BPL", "10:00", "10:10", 10, 1, 800),
        _stop(3, "END", "MAS", "12:00", "12:00", 0, 2, 2000),  # 30 hours total
    ]
    mock_schedule = _make_mock_schedule(train_no="12622", stops=stops, total_duration_minutes=1800)
    mock_sched_client = AsyncMock(spec=CdnScheduleClient)
    mock_sched_client.get_schedule.return_value = mock_schedule
    mock_train_client = AsyncMock(spec=DreamDestinyClient)

    # DLI -> BPL is AVL, but BPL -> MAS is WL, so 2-leg is not confirmed
    # Since only 1 candidate stop exists, stage3_tasks and stage4_tasks are empty
    async def mock_sparse_fetch(q: TrainQuery) -> tuple[AvailabilityObservation, int | None]:
        if q.source == "DLI" and q.destination == "BPL":
            return _avail(AvailabilityStatus.AVAILABLE, "AVL 5"), 300
        return _avail(AvailabilityStatus.WAITLIST, "WL 5", 5), 800

    mock_train_client.fetch_with_fare.side_effect = mock_sparse_fetch
    engine = SmartRoutingEngine(schedule_client=mock_sched_client, train_client=mock_train_client)
    res = await engine.search(
        SmartRouteQuery(
            train_no="12622",
            origin="DLI",
            destination="MAS",
            journey_date=date(2026, 12, 16),
            travel_class="SL",
        )
    )
    assert len(res.solutions) == 0


@pytest.mark.anyio
async def test_engine_candidate_evaluators_defensive_branches() -> None:
    """Directly verify None/failed snapshot branches across 2-leg, 3-leg, 4-leg and origin ext."""
    from trainwatch.domain.smart_routes import SubLeg

    mock_sched_client = AsyncMock(spec=CdnScheduleClient)
    mock_train_client = AsyncMock(spec=DreamDestinyClient)
    engine = SmartRoutingEngine(schedule_client=mock_sched_client, train_client=mock_train_client)

    stops = [
        _stop(1, "STOP1", "S1", "06:00", "06:00", 0, 1, 0),
        _stop(2, "STOP2", "S2", "10:00", "10:05", 5, 1, 100),
        _stop(3, "STOP3", "S3", "12:00", "12:05", 5, 1, 200),
        _stop(4, "STOP4", "S4", "14:00", "14:05", 5, 1, 300),
        _stop(5, "STOP5", "S5", "16:00", "16:00", 0, 1, 400),
    ]
    sched = _make_mock_schedule(stops=stops)
    query = SmartRouteQuery(
        train_no="12622",
        origin="S1",
        destination="S5",
        journey_date=date(2026, 12, 16),
        travel_class="SL",
    )
    dummy_leg1 = SubLeg(
        leg_number=1,
        train_no="12622",
        train_name="Mock Exp",
        from_station="S1",
        to_station="S2",
        travel_class="SL",
        quota="GN",
        status=AvailabilityStatus.AVAILABLE,
        raw_status="AVL 10",
        fare=100,
        departure_time="06:00",
        arrival_time="10:00",
        duration_minutes=240,
        distance_km=100,
    )

    def _code(x: object) -> str:
        return getattr(x, "station_code", str(x))

    # 1. _evaluate_2leg_candidate: obs2 is None / failed (line 312)
    async def query_seg_none(src: object, dst: object) -> tuple[AvailabilityObservation, int | None]:
        if _code(src) == "S1" and _code(dst) == "S2":
            return _avail(AvailabilityStatus.AVAILABLE, "AVL 10"), 100
        return AvailabilityObservation.failed(ProviderFailure.OTHER), None

    prefixes: dict[str, tuple[ScheduleStop, SubLeg]] = {}
    sol_2leg = await engine._evaluate_2leg_candidate(
        candidate=stops[1],
        query=query,
        schedule=sched,
        origin_stop=stops[0],
        dest_stop=stops[4],
        direct_fare=500,
        query_segment=query_seg_none,
        confirmed_prefixes_leg1=prefixes,
    )
    assert sol_2leg is None

    # 2. _evaluate_3leg_candidate: obs3 is None (line 389)
    async def query_seg_3leg_none(src: object, dst: object) -> tuple[AvailabilityObservation, int | None]:
        if _code(src) == "S2" and _code(dst) == "S3":
            return _avail(AvailabilityStatus.AVAILABLE, "AVL 10"), 100
        return AvailabilityObservation.failed(ProviderFailure.OTHER), None

    sol_3leg = await engine._evaluate_3leg_candidate(
        cand_u=stops[1],
        cand_v=stops[2],
        leg1=dummy_leg1,
        query=query,
        schedule=sched,
        origin_stop=stops[0],
        dest_stop=stops[4],
        direct_fare=500,
        query_segment=query_seg_3leg_none,
    )
    assert sol_3leg is None

    # 3. _evaluate_4leg_candidate: obs3 not AVL (line 489)
    async def query_seg_4leg_obs3_wl(
        src: object, dst: object
    ) -> tuple[AvailabilityObservation, int | None]:
        if _code(src) == "S2" and _code(dst) == "S3":
            return _avail(AvailabilityStatus.AVAILABLE, "AVL 10"), 100
        if _code(src) == "S3" and _code(dst) == "S4":
            return _avail(AvailabilityStatus.WAITLIST, "WL 1", 1), 100
        return AvailabilityObservation.failed(ProviderFailure.OTHER), None

    sol_4leg_1 = await engine._evaluate_4leg_candidate(
        cand_u=stops[1],
        cand_v=stops[2],
        cand_w=stops[3],
        leg1=dummy_leg1,
        query=query,
        schedule=sched,
        origin_stop=stops[0],
        dest_stop=stops[4],
        direct_fare=500,
        query_segment=query_seg_4leg_obs3_wl,
    )
    assert sol_4leg_1 is None

    # 4. _evaluate_4leg_candidate: obs4 is None (line 493)
    async def query_seg_4leg_obs4_none(
        src: object, dst: object
    ) -> tuple[AvailabilityObservation, int | None]:
        if _code(src) in {"S2", "S3"} and _code(dst) in {"S3", "S4"}:
            return _avail(AvailabilityStatus.AVAILABLE, "AVL 10"), 100
        return AvailabilityObservation.failed(ProviderFailure.OTHER), None

    sol_4leg_2 = await engine._evaluate_4leg_candidate(
        cand_u=stops[1],
        cand_v=stops[2],
        cand_w=stops[3],
        leg1=dummy_leg1,
        query=query,
        schedule=sched,
        origin_stop=stops[0],
        dest_stop=stops[4],
        direct_fare=500,
        query_segment=query_seg_4leg_obs4_none,
    )
    assert sol_4leg_2 is None

    # 5. _evaluate_4leg_candidate: obs4 is bad status (line 502)
    async def query_seg_4leg_obs4_bad(
        src: object, dst: object
    ) -> tuple[AvailabilityObservation, int | None]:
        if _code(src) in {"S2", "S3"} and _code(dst) in {"S3", "S4"}:
            return _avail(AvailabilityStatus.AVAILABLE, "AVL 10"), 100
        return _avail(AvailabilityStatus.WAITLIST, "WL 2", 2), 100

    sol_4leg_3 = await engine._evaluate_4leg_candidate(
        cand_u=stops[1],
        cand_v=stops[2],
        cand_w=stops[3],
        leg1=dummy_leg1,
        query=query,
        schedule=sched,
        origin_stop=stops[0],
        dest_stop=stops[4],
        direct_fare=500,
        query_segment=query_seg_4leg_obs4_bad,
    )
    assert sol_4leg_3 is None

    # 6. _evaluate_origin_extension: direct_snapshot is None (line 617->629)
    async def query_seg_ext(src: object, dst: object) -> tuple[AvailabilityObservation, int | None]:
        return _avail(AvailabilityStatus.AVAILABLE, "AVL 10"), 520

    sol_ext = await engine._evaluate_origin_extension(
        query=query,
        schedule=sched,
        origin_stop=stops[1],
        dest_stop=stops[4],
        direct_fare=500,
        direct_snapshot=None,
        query_segment=query_seg_ext,
    )
    assert sol_ext is not None
    assert sol_ext.tier == SolutionTier.TIER_2_ORIGIN_EXTENSION


@pytest.mark.anyio
async def test_multi_day_midnight_date_offsets_and_subleg_dates() -> None:
    """Verify that multi-day journeys calculate and query exact calendar dates across midnight rollovers."""
    from datetime import timedelta

    stops = [
        _stop(1, "DIBRUGARH", "DBRG", "19:25", "19:25", 0, 1, 0),
        _stop(2, "GUWAHATI", "GHY", "08:45", "09:00", 15, 2, 558),
        _stop(3, "VISAKHAPATNAM", "VSKP", "19:40", "20:00", 20, 3, 2060),
        _stop(4, "VIJAYAWADA JN", "BZA", "01:50", "02:00", 10, 4, 2410),
        _stop(5, "KANYAKUMARI", "CAPE", "22:00", "22:00", 0, 4, 4154),
    ]
    sched = _make_mock_schedule(train_no="15906", train_name="Vivek Express", stops=stops, total_duration_minutes=4475)

    captured_queries: list[tuple[str, str, date]] = []
    mock_train_client = AsyncMock(spec=DreamDestinyClient)

    async def mock_fetch(q: TrainQuery) -> tuple[AvailabilityObservation, int | None]:
        captured_queries.append((q.source, q.destination, q.journey_date))
        if q.source == "DBRG" and q.destination == "CAPE":
            return _avail(AvailabilityStatus.WAITLIST, "WL 50", 50), 1050
        return _avail(AvailabilityStatus.AVAILABLE, "AVL 15", 15), 450

    mock_train_client.fetch_with_fare.side_effect = mock_fetch

    mock_sched_client = AsyncMock(spec=CdnScheduleClient)
    mock_sched_client.get_schedule.return_value = sched

    engine = SmartRoutingEngine(schedule_client=mock_sched_client, train_client=mock_train_client)

    journey_origin_date = date(2026, 12, 5)  # Saturday
    query = SmartRouteQuery(
        train_no="15906",
        origin="DBRG",
        destination="CAPE",
        journey_date=journey_origin_date,
        travel_class="SL",
        quota="GN",
    )

    result = await engine.search(query)
    assert len(result.solutions) > 0

    # Verify that VSKP (Day 3) is queried with Saturday + 2 days = Monday (2026-12-07)
    vskp_to_cape_queries = [
        jdate for (src, dst, jdate) in captured_queries if src == "VSKP" and dst == "CAPE"
    ]
    assert len(vskp_to_cape_queries) > 0
    assert vskp_to_cape_queries[0] == journey_origin_date + timedelta(days=2)
    assert vskp_to_cape_queries[0] == date(2026, 12, 7)

    # Verify BZA (Day 4) is queried with Saturday + 3 days = Tuesday (2026-12-08)
    bza_to_cape_queries = [
        jdate for (src, dst, jdate) in captured_queries if src == "BZA" and dst == "CAPE"
    ]
    assert len(bza_to_cape_queries) > 0
    assert bza_to_cape_queries[0] == journey_origin_date + timedelta(days=3)
    assert bza_to_cape_queries[0] == date(2026, 12, 8)

    # Check solution legs have accurate journey_date
    for sol in result.solutions:
        for leg in sol.legs:
            assert leg.journey_date is not None
            assert isinstance(leg.journey_date, date)
            assert sol.booking_strategy is not None

    # Test Tier 2 origin extension date: passenger boards at GHY on Day 2 (Sunday 2026-12-06)
    captured_queries.clear()
    query_from_day2 = SmartRouteQuery(
        train_no="15906",
        origin="GHY",
        destination="CAPE",
        journey_date=date(2026, 12, 6),  # Sunday (Day 2 of train run)
        travel_class="SL",
        quota="GN",
    )
    result_day2 = await engine.search(query_from_day2)
    # Origin extension should query DBRG (Day 1) on Sunday - 1 day = Saturday (2026-12-05)
    dbrg_to_cape_queries = [
        jdate for (src, dst, jdate) in captured_queries if src == "DBRG" and dst == "CAPE"
    ]
    assert len(dbrg_to_cape_queries) > 0
    assert dbrg_to_cape_queries[0] == date(2026, 12, 5)
