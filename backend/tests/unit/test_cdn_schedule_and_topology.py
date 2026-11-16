"""Unit tests for CDN schedule parsing, caching, and station topology classification."""

import time
from pathlib import Path

import pytest

from trainwatch.domain.smart_routes import StationRole
from trainwatch.infrastructure.station_cache.topology_registry import (
    StationTopologyRegistry,
    classify_station,
)
from trainwatch.infrastructure.train_api.cdn_schedule import (
    CdnScheduleClient,
    ScheduleStop,
    TrainScheduleError,
    _parse_schedule_payload,
    _safe_int,
    _safe_str,
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
    """Verify station hierarchy matches Capitals -> Hubs -> Div HQs -> Junctions -> Adjacent."""
    assert classify_station("BPL", "BHOPAL JN") == StationRole.STATE_CAPITAL
    assert classify_station("NDLS", "NEW DELHI") == StationRole.STATE_CAPITAL
    assert classify_station("MDU", "MADURAI JN") == StationRole.MAJOR_HUB
    assert classify_station("ET", "ITARSI JN") == StationRole.MAJOR_HUB
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

    # Stop not found
    assert sched.get_stop("XYZ") is None


def test_topology_empty_and_div_hqs() -> None:
    """Verify empty input returns empty tuple and div HQs are prioritized over junctions."""
    assert StationTopologyRegistry.rank_candidate_stations([]) == ()

    div_stops = [
        _stop(2, "LUMDING JN", "LMG", "10:00", "10:05", 5, 1, 100),
        _stop(3, "ALIPURDUAR JN", "APDJ", "12:00", "12:05", 5, 1, 200),
        _stop(4, "JUNCTION 1", "JN1", "14:00", "14:05", 5, 1, 300),
    ]
    ranked = StationTopologyRegistry.rank_candidate_stations(div_stops, max_candidates=2)
    codes = [s.station_code for s in ranked]
    assert "LMG" in codes
    assert "APDJ" in codes


def test_helper_safe_types_and_malformed_payload() -> None:
    """Verify helper parsing functions handle None, invalid types, and malformed JSON."""
    assert _safe_str(None) == ""
    assert _safe_str("hello") == "hello"
    assert _safe_int(None) == 0
    assert _safe_int("invalid") == 0
    assert _safe_int(42) == 42

    with pytest.raises(TrainScheduleError, match="missing schedule"):
        _parse_schedule_payload({"schedule": "not-a-list"})


@pytest.mark.anyio
async def test_cdn_schedule_client_configuration_and_lifecycle() -> None:
    """Verify client constructor validation and lifecycle."""
    with pytest.raises(ValueError, match="HTTP"):
        CdnScheduleClient(cdn_base_url="not-http")

    with pytest.raises(ValueError, match="credentials"):
        CdnScheduleClient(cdn_base_url="https://user:pass@example.com")

    client = CdnScheduleClient(cdn_base_url="https://trains.example.com")
    with pytest.raises(ValueError, match="Invalid train number"):
        await client.get_schedule("invalid")

    await client.close()


@pytest.mark.anyio
async def test_cdn_schedule_client_fetch_and_fallback() -> None:
    """Verify CDN fetching, caching, and failover to fallback URL."""
    import httpx

    sample_payload = {
        "success": True,
        "data": {
            "train_no": "12662",
            "train_name": "POTHIGAI EXP",
            "source_station_name": "SCT",
            "source_station_code": "SCT",
            "destination_station_name": "MS",
            "destination_station_code": "MS",
            "days_of_run": ["MON"],
            "classes": ["SL"],
            "total_duration_minutes": 600,
            "total_distance_km": 600,
            "total_stops": 2,
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
                    "station_name": "CHENNAI EGMORE",
                    "station_code": "MS",
                    "arrival_time": "06:40",
                    "departure_time": "06:40",
                    "halt_minutes": 0,
                    "day": 2,
                    "distance_from_origin_km": 600,
                },
            ],
        },
    }

    # Handler that succeeds on CDN
    def cdn_ok_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=sample_payload)

    http_ok = httpx.AsyncClient(transport=httpx.MockTransport(cdn_ok_handler))
    client = CdnScheduleClient(
        cdn_base_url="https://cdn.example.com",
        http_client=http_ok,
    )
    sched1 = await client.get_schedule("12662")
    assert sched1.train_no == "12662"
    # Call again to verify cache hit
    sched2 = await client.get_schedule("12662")
    assert sched2 is sched1

    # Handler that fails on CDN (500) but succeeds on fallback
    def fallback_handler(request: httpx.Request) -> httpx.Response:
        if "cdn.example.com" in str(request.url):
            return httpx.Response(500, json={"error": "cdn down"})
        return httpx.Response(200, json=sample_payload)

    http_fallback = httpx.AsyncClient(transport=httpx.MockTransport(fallback_handler))
    client_fb = CdnScheduleClient(
        cdn_base_url="https://cdn.example.com",
        fallback_base_url="https://fallback.example.com",
        http_client=http_fallback,
    )
    sched_fb = await client_fb.get_schedule("12662")
    assert sched_fb.train_no == "12662"

    # Handler where both fail
    def both_fail_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"error": "down"})

    http_fail = httpx.AsyncClient(transport=httpx.MockTransport(both_fail_handler))
    client_fail = CdnScheduleClient(
        cdn_base_url="https://cdn.example.com",
        fallback_base_url="https://fallback.example.com",
        http_client=http_fail,
    )
    with pytest.raises(TrainScheduleError, match="Could not retrieve schedule"):
        await client_fail.get_schedule("12662")

    # Handler where requests raise exceptions
    def exc_handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("Network unreachable")

    http_exc = httpx.AsyncClient(transport=httpx.MockTransport(exc_handler))
    client_exc = CdnScheduleClient(
        cdn_base_url="https://cdn.example.com",
        fallback_base_url="https://fallback.example.com",
        http_client=http_exc,
    )
    with pytest.raises(TrainScheduleError, match="Could not retrieve schedule"):
        await client_exc.get_schedule("12662")

    # Internally owned HTTP client instantiation, reuse, and cleanup
    owned_client = CdnScheduleClient(cdn_base_url="https://cdn.example.com")
    http_inst1 = await owned_client._get_http()
    http_inst2 = await owned_client._get_http()
    assert http_inst1 is http_inst2
    assert not http_inst1.is_closed
    await owned_client.close()
    assert owned_client._owned_http is None

    # Cache expiry handling
    client_cache = CdnScheduleClient(cdn_base_url="https://cdn.example.com", http_client=http_ok)
    sched1 = await client_cache.get_schedule("12662")
    client_cache._cache["12662"] = (time.monotonic() - 100000.0, sched1)
    sched2 = await client_cache.get_schedule("12662")
    assert sched2.train_no == "12662"

    # CDN returns 200 with success=False and fallback_base_url is None
    http_bad_success = httpx.AsyncClient(
        transport=httpx.MockTransport(lambda req: httpx.Response(200, json={"success": False}))
    )
    client_bad_cdn = CdnScheduleClient(
        cdn_base_url="https://cdn.example.com",
        fallback_base_url=None,
        http_client=http_bad_success,
    )
    with pytest.raises(TrainScheduleError, match="Could not retrieve schedule"):
        await client_bad_cdn.get_schedule("12662")

    # Fallback returns 200 with success=False
    def fallback_bad_success_handler(request: httpx.Request) -> httpx.Response:
        if "cdn" in str(request.url):
            return httpx.Response(500, json={"error": "cdn down"})
        return httpx.Response(200, json={"success": False, "data": None})

    http_bad_fb = httpx.AsyncClient(transport=httpx.MockTransport(fallback_bad_success_handler))
    client_bad_fb = CdnScheduleClient(
        cdn_base_url="https://cdn.example.com",
        fallback_base_url="https://fallback.example.com",
        http_client=http_bad_fb,
    )
    with pytest.raises(TrainScheduleError, match="Could not retrieve schedule"):
        await client_bad_fb.get_schedule("12662")


def test_schedule_non_dict_element_and_state_capitals() -> None:
    """Verify non-dict items in schedule array are safely ignored and state capitals classify."""
    from pathlib import Path

    from trainwatch.infrastructure.station_cache.topology_registry import (
        load_topology_datasets,
    )

    raw = {
        "schedule": [
            None,  # Non-dict element should be skipped
            {
                "stop_number": 1,
                "station_name": "DELHI",
                "station_code": "DLI",
                "arrival_time": "10:00",
                "departure_time": "10:05",
                "halt_minutes": 5,
                "day": 1,
                "distance_from_origin_km": 0,
            },
        ]
    }
    sched = _parse_schedule_payload(raw)
    assert len(sched.stops) == 1

    # State capital classification
    assert classify_station("GHY", "GUWAHATI") == StationRole.STATE_CAPITAL
    assert classify_station("MAS", "CHENNAI CENTRAL") == StationRole.STATE_CAPITAL

    # Load datasets from explicit directory
    data_dir = Path(__file__).resolve().parents[3] / "data"
    majors, _divs, caps = load_topology_datasets(data_dir=data_dir)
    assert "GHY" in caps
    assert "MAS" in majors


def test_topology_dataset_loading_fallbacks(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Verify fallback when data directories are invalid or corrupted."""
    import json

    from trainwatch.infrastructure.station_cache.topology_registry import (
        _find_data_directory,
        load_topology_datasets,
    )

    # 1. Non-existent explicit dir
    majors, _divs, _caps = load_topology_datasets(data_dir=tmp_path / "nonexistent")
    assert len(majors) > 0

    # 2. STATION_DATA_DIR env var points to nonexistent dir (branch 249->252)
    monkeypatch.setenv("STATION_DATA_DIR", str(tmp_path / "not_existing_dir"))
    # Also verify when no search candidate is a dir (lines 258->257, 260, 276)
    orig_is_dir = Path.is_dir
    monkeypatch.setattr(Path, "is_dir", lambda self: False)
    assert _find_data_directory() is None
    majors_none, _, _ = load_topology_datasets(data_dir=None)
    assert len(majors_none) > 0
    monkeypatch.setattr(Path, "is_dir", orig_is_dir)

    # 3. STATION_DATA_DIR points to valid dir
    valid_dir = tmp_path / "data"
    valid_dir.mkdir()
    monkeypatch.setenv("STATION_DATA_DIR", str(valid_dir))
    assert _find_data_directory() == valid_dir

    # 4. Invalid JSON files in directory
    (valid_dir / "division_hubs.json").write_text("invalid json")
    (valid_dir / "state_capitals.json").write_text("invalid json")
    majors_corrupt, _, _ = load_topology_datasets(data_dir=valid_dir)
    assert len(majors_corrupt) > 0

    # 5. Non-dict payloads in division_hubs.json and state_capitals.json
    p_dir = tmp_path / "p_dir"
    p_dir.mkdir()
    (p_dir / "division_hubs.json").write_text(json.dumps([1, 2, 3]))
    (p_dir / "state_capitals.json").write_text(json.dumps([1, 2, 3]))
    majors_list, _, _ = load_topology_datasets(data_dir=p_dir)
    assert len(majors_list) > 0

    # 6. Dict with non-dict values and empty codes
    mixed_dir = tmp_path / "mixed"
    mixed_dir.mkdir()
    (mixed_dir / "division_hubs.json").write_text(
        json.dumps({"1": "not_dict", "2": {"hub_code": ""}, "3": {"hub_code": "TESTDIV"}})
    )
    (mixed_dir / "state_capitals.json").write_text(
        json.dumps({"1": "not_dict", "2": {"station_code": ""}, "3": {"station_code": "TESTCAP"}})
    )
    majors_m, divs_m, caps_m = load_topology_datasets(data_dir=mixed_dir)
    assert "TESTDIV" in divs_m
    assert "TESTCAP" in caps_m
    assert "TESTCAP" in majors_m

    # 7. Partial files (only one file present)
    div_only = tmp_path / "div_only"
    div_only.mkdir()
    (div_only / "division_hubs.json").write_text(json.dumps({"1": {"hub_code": "DIVONLY"}}))
    _, divs_o, _ = load_topology_datasets(data_dir=div_only)
    assert "DIVONLY" in divs_o

    cap_only = tmp_path / "cap_only"
    cap_only.mkdir()
    (cap_only / "state_capitals.json").write_text(json.dumps({"1": {"station_code": "CAPONLY"}}))
    _, _, caps_o = load_topology_datasets(data_dir=cap_only)
    assert "CAPONLY" in caps_o


def test_topology_rank_candidates_limits() -> None:
    """Verify max_candidates limits for tier1, tier2, and tier4 stops."""
    # Tier 1 stops exceeding limit
    tier1_stops = [
        _stop(1, "CAPITAL 1", "BPL", "10:00", "10:05", 5, 1, 100),
        _stop(2, "CAPITAL 2", "NDLS", "12:00", "12:05", 5, 1, 200),
        _stop(3, "CAPITAL 3", "MAS", "14:00", "14:05", 5, 1, 300),
    ]
    res1 = StationTopologyRegistry.rank_candidate_stations(tier1_stops, max_candidates=2)
    assert len(res1) == 2

    # Tier 2 stops exceeding limit
    tier2_stops = [
        _stop(1, "DIV 1", "LMG", "10:00", "10:05", 5, 1, 100),
        _stop(2, "DIV 2", "APDJ", "12:00", "12:05", 5, 1, 200),
        _stop(3, "DIV 3", "BVC", "14:00", "14:05", 5, 1, 300),
    ]
    res2 = StationTopologyRegistry.rank_candidate_stations(tier2_stops, max_candidates=2)
    assert len(res2) == 2

    # Tier 4 adjacent stops exceeding limit
    tier4_stops = [
        _stop(1, "ADJ 1", "HALT1", "10:00", "10:05", 2, 1, 100),
        _stop(2, "ADJ 2", "HALT2", "12:00", "12:05", 2, 1, 200),
        _stop(3, "ADJ 3", "HALT3", "14:00", "14:05", 2, 1, 300),
    ]
    res4 = StationTopologyRegistry.rank_candidate_stations(tier4_stops, max_candidates=1)
    assert len(res4) == 1
