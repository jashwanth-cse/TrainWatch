"""Unit tests for CDN schedule parsing, caching, and station topology classification."""

import pytest

from trainwatch.domain.smart_routes import StationRole
from trainwatch.infrastructure.station_cache.topology_registry import (
    StationTopologyRegistry,
    classify_station,
)
from trainwatch.infrastructure.train_api.cdn_schedule import (
    ScheduleStop,
    _parse_schedule_payload,
)


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


def test_classify_station_hierarchy() -> None:
    """Verify station hierarchy matches Major Hubs -> Div HQs -> Junctions -> Adjacent."""
    assert classify_station("MDU", "MADURAI JN") == StationRole.MAJOR_HUB
    assert classify_station("BPL", "BHOPAL JN") == StationRole.MAJOR_HUB
    assert classify_station("NDLS", "NEW DELHI") == StationRole.MAJOR_HUB
    assert classify_station("PGT", "PALAKKAD JN") == StationRole.MAJOR_HUB
    assert classify_station("LMG", "LUMDING JN") == StationRole.DIVISION_HQ
    assert classify_station("VPT", "VIRUDHUNAGAR JN") == StationRole.JUNCTION
    assert classify_station("CGL", "CHENGALPATTU JN") == StationRole.JUNCTION
    assert classify_station("SVKS", "SIVAKASI") == StationRole.ADJACENT_HALT
    assert classify_station("TMQ", "TIRUMANGALAM") == StationRole.ADJACENT_HALT


def test_station_topology_pruner_prioritizes_hubs_over_adjacent() -> None:
    """Verify that ranking prioritizes hubs and junctions, only picking adjacent if needed."""
    stops = [
        _stop(1, "RAJAPALAYAM", "RJPM", "20:15", "20:17", 2, 1, 0),
        _stop(2, "SIVAKASI", "SVKS", "20:38", "20:40", 2, 1, 24),
        _stop(3, "VIRUDHUNAGAR JN", "VPT", "21:05", "21:07", 2, 1, 46),
        _stop(4, "TIRUMANGALAM", "TMQ", "21:24", "21:25", 1, 1, 72),
        _stop(5, "MADURAI JN", "MDU", "21:50", "21:55", 5, 1, 90),
        _stop(6, "DINDIGUL JN", "DG", "22:58", "23:00", 2, 1, 152),
        _stop(7, "TIRUCHCHIRAPPALLI JN", "TPJ", "00:15", "00:20", 5, 2, 246),
        _stop(8, "VRIDDHACHALAM JN", "VRI", "02:00", "02:02", 2, 2, 369),
        _stop(9, "VILLUPURAM JN", "VM", "03:00", "03:05", 5, 2, 424),
        _stop(10, "CHENNAI EGMORE", "MS", "06:30", "06:30", 0, 2, 600),
    ]

    intermediate = stops[1:-1]
    ranked = StationTopologyRegistry.rank_candidate_stations(intermediate, max_candidates=5)

    codes = [s.station_code for s in ranked]
    assert "MDU" in codes
    assert "TPJ" in codes
    assert "VM" in codes
    assert "SVKS" not in codes
    assert "TMQ" not in codes
    assert codes == sorted(
        codes,
        key=lambda c: next(s.stop_number for s in ranked if s.station_code == c),
    )


def test_station_topology_falls_back_to_adjacent_if_sparse() -> None:
    """When only 1 hub/junction exists, adjacent halts must be included as fallback."""
    sparse_stops = [
        _stop(2, "SMALL HALT 1", "SH1", "10:00", "10:02", 2, 1, 20),
        _stop(3, "JUNCTION 1", "JN1", "11:00", "11:05", 5, 1, 60),
    ]
    ranked = StationTopologyRegistry.rank_candidate_stations(sparse_stops, max_candidates=4)
    codes = [s.station_code for s in ranked]
    assert "JN1" in codes
    assert "SH1" in codes


def test_parse_schedule_payload() -> None:
    """Verify parsing raw dictionary payload into TrainSchedule dataclass."""
    raw = {
        "train_no": "12662",
        "train_name": "POTHIGAI SF EXP",
        "source_station_name": "SENGOTTAI",
        "source_station_code": "SCT",
        "destination_station_name": "CHENNAI EGMORE",
        "destination_station_code": "MS",
        "days_of_run": ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"],
        "classes": ["SL", "3A", "2A", "1A"],
        "total_duration_minutes": 710,
        "total_distance_km": 668,
        "total_stops": 3,
        "schedule": [
            {
                "stop_number": 1,
                "station_name": "SENGOTTAI",
                "station_code": "SCT",
                "arrival_time": "18:50",
                "departure_time": "18:50",
                "halt_minutes": 0,
                "day": 1,
                "distance_from_origin_km": 0,
            },
            {
                "stop_number": 2,
                "station_name": "RAJAPALAYAM",
                "station_code": "RJPM",
                "arrival_time": "19:53",
                "departure_time": "19:55",
                "halt_minutes": 2,
                "day": 1,
                "distance_from_origin_km": 67,
            },
            {
                "stop_number": 3,
                "station_name": "CHENNAI EGMORE",
                "station_code": "MS",
                "arrival_time": "06:40",
                "departure_time": "06:40",
                "halt_minutes": 0,
                "day": 2,
                "distance_from_origin_km": 668,
            },
        ],
    }

    sched = _parse_schedule_payload(raw)
    assert sched.train_no == "12662"
    assert len(sched.stops) == 3
    rjpm_stop = sched.get_stop("RJPM")
    assert rjpm_stop is not None
    assert rjpm_stop.halt_minutes == 2

    # Test get_subroute
    sub = sched.get_subroute("RJPM", "MS")
    assert len(sub) == 2
    assert sub[0].station_code == "RJPM"
    assert sub[1].station_code == "MS"

    # Test invalid subroute
    with pytest.raises(ValueError, match="not found"):
        sched.get_subroute("INVALID", "MS")

    with pytest.raises(ValueError, match="appears before"):
        sched.get_subroute("MS", "RJPM")
