"""Offline contract checks for sanitized Dream Destiny train-service fixtures."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

FIXTURES = Path(__file__).parents[1] / "fixtures" / "train_api"
BOOKING_STATUSES = {"AVAILABLE", "RAC", "WL", "REGRET", "UNKNOWN"}


def load_json(name: str) -> Any:
    """Load a local sanitized fixture without network or credential access."""
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def assert_integer(value: object) -> None:
    """Require a JSON integer while excluding booleans, which subclass int."""
    assert isinstance(value, int) and not isinstance(value, bool)


def assert_class_shape(item: dict[str, Any]) -> None:
    """Validate the class fields shared by train-search results."""
    assert set(item) == {
        "travel_class",
        "fare",
        "availability",
        "prediction",
        "bookable",
        "availability_source",
    }
    assert isinstance(item["travel_class"], str)
    assert_integer(item["fare"])
    assert isinstance(item["availability"], str)
    assert_integer(item["prediction"])
    assert isinstance(item["bookable"], bool)
    assert item["availability_source"] in {"cached", "live", "pending", "unavailable"}


def test_availability_response_fixtures_match_verified_shape() -> None:
    """Cover every normalized status using local sanitized responses."""
    cases = load_json("availability_responses.json")

    assert {case["case"] for case in cases} == {
        "available",
        "rac",
        "waitlist",
        "regret",
        "unknown",
    }
    for case in cases:
        response = case["response"]
        assert response["success"] is True
        assert isinstance(response["message"], str)
        data = response["data"]
        assert set(data) == {
            "train_number",
            "travel_class",
            "quota",
            "availability",
            "booking_status",
            "prediction",
            "fare",
            "total_fare",
            "booking_enabled",
            "last_updated",
            "next_available_dates",
        }
        assert data["booking_status"] in BOOKING_STATUSES
        assert isinstance(data["availability"], str)
        assert_integer(data["prediction"])
        assert_integer(data["fare"])
        assert_integer(data["total_fare"])
        assert isinstance(data["booking_enabled"], bool)
        assert isinstance(data["last_updated"], str)
        assert all(isinstance(value, str) for value in data["next_available_dates"])


def test_unknown_availability_fixture_cannot_be_treated_as_positive() -> None:
    """Keep an explicit fail-closed case for later domain implementation."""
    cases = load_json("availability_responses.json")
    unknown = next(case["response"]["data"] for case in cases if case["case"] == "unknown")

    assert unknown["booking_status"] == "UNKNOWN"
    assert unknown["availability"] == ""


def test_error_fixtures_cover_documented_http_statuses_without_secrets() -> None:
    """Record both deployed error-envelope families for the future adapter."""
    errors = load_json("error_responses.json")

    assert {item["status"] for item in errors} == {400, 404, 500, 502, 503, 504}
    for item in errors:
        assert set(item["body"]).intersection({"detail", "message"})
        assert not any(key in item["body"] for key in {"token", "authorization", "credential"})


def test_station_search_fixture_matches_live_observed_shape() -> None:
    """Validate the station-search envelope and station fields."""
    response = load_json("station_search_response.json")

    assert response["success"] is True
    assert isinstance(response["data"], list)
    for station in response["data"]:
        assert set(station) == {"station_name", "station_code", "latitude", "longitude"}
        assert isinstance(station["station_name"], str)
        assert isinstance(station["station_code"], str)
        assert isinstance(station["latitude"], int | float)
        assert isinstance(station["longitude"], int | float)


def test_train_search_fixture_matches_live_observed_shape() -> None:
    """Validate route metadata and nested train/class structures offline."""
    response = load_json("train_search_response.json")
    data = response["data"]

    assert response["success"] is True
    assert set(data) == {
        "result_type",
        "source",
        "destination",
        "total_trains",
        "trains",
        "route_type",
        "original_source",
        "original_destination",
        "actual_source",
        "actual_destination",
        "fallback_reason",
        "fallback_searches_count",
        "latency_ms",
    }
    assert data["route_type"] in {
        "direct",
        "division_fallback",
        "state_capital_fallback",
        "no_route_found",
    }
    assert data["total_trains"] == len(data["trains"])
    for train in data["trains"]:
        assert set(train) == {
            "train_number",
            "train_name",
            "train_type",
            "from",
            "to",
            "departure_time",
            "arrival_time",
            "duration_minutes",
            "duration",
            "distance",
            "running_days",
            "rating",
            "has_pantry",
            "lowest_fare",
            "recommended_class",
            "classes",
        }
        assert set(train["from"]) == {"code", "name"}
        assert set(train["to"]) == {"code", "name"}
        assert isinstance(train["classes"], list)
        for travel_class in train["classes"]:
            assert_class_shape(travel_class)
        if train["recommended_class"] is not None:
            assert_class_shape(train["recommended_class"])
