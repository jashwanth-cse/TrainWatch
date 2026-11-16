"""Unit tests for smart routes FastAPI endpoint."""

from datetime import UTC, date, datetime
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import FastAPI

from trainwatch.config import AppSettings
from trainwatch.domain.availability import AvailabilitySnapshot, AvailabilityStatus
from trainwatch.domain.smart_routes import (
    SmartRouteResult,
    SmartRouteSolution,
    SolutionTier,
    SubLeg,
)
from trainwatch.main import create_app
from trainwatch.services.smart_routing_engine import SmartRoutingEngine


def _mock_result() -> SmartRouteResult:
    leg1 = SubLeg(
        leg_number=1,
        train_no="12662",
        train_name="Pothigai SF Exp",
        from_station="RJPM",
        to_station="MDU",
        travel_class="SL",
        quota="GN",
        status=AvailabilityStatus.AVAILABLE,
        raw_status="AVAILABLE 12",
        fare=140,
        departure_time="19:55",
        arrival_time="21:15",
        duration_minutes=80,
        distance_km=89,
    )
    leg2 = SubLeg(
        leg_number=2,
        train_no="12662",
        train_name="Pothigai SF Exp",
        from_station="MDU",
        to_station="MS",
        travel_class="SL",
        quota="GN",
        status=AvailabilityStatus.AVAILABLE,
        raw_status="AVAILABLE 4",
        fare=280,
        departure_time="21:20",
        arrival_time="06:40",
        duration_minutes=560,
        distance_km=512,
    )
    sol = SmartRouteSolution(
        solution_id="sol-test-1",
        tier=SolutionTier.TIER_1_SAME_TRAIN_SPLIT,
        legs=(leg1, leg2),
        total_fare=420,
        fare_surcharge=40,
        fare_surcharge_pct=10.5,
        total_duration_minutes=645,
        boarding_station=None,
        is_confirmed=True,
        is_rac=False,
        recommendation_score=85.0,
        split_stations=("MDU",),
    )
    direct_snap = AvailabilitySnapshot(
        status=AvailabilityStatus.WAITLIST,
        raw_availability="WL 10",
        observed_at=datetime.now(UTC),
        position=10,
    )
    return SmartRouteResult(
        train_no="12662",
        train_name="Pothigai SF Exp",
        origin="RJPM",
        destination="MS",
        journey_date=date(2026, 12, 16),
        travel_class="SL",
        journey_duration_hours=10.75,
        journey_distance_km=601,
        max_leg_horizon=2,
        direct_status=direct_snap,
        direct_fare=380,
        solutions=(sol,),
        execution_time_ms=125.4,
        stations_evaluated_count=4,
        queries_executed_count=3,
    )


@pytest.fixture
def test_app() -> tuple[FastAPI, AsyncMock]:
    settings = AppSettings(app_env="test")
    mock_engine = AsyncMock(spec=SmartRoutingEngine)
    mock_engine.search.return_value = _mock_result()
    app = create_app(settings=settings, smart_routing_engine=mock_engine)
    return app, mock_engine


@pytest.mark.anyio
async def test_find_smart_routes_success(test_app: tuple[FastAPI, AsyncMock]) -> None:
    """Verify POST /api/v1/trains/smart-routes returns 200 with formatted solutions."""
    app, _ = test_app
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        response = await client.post(
            "/api/v1/trains/smart-routes",
            json={
                "train_no": "12662",
                "origin": "RJPM",
                "destination": "MS",
                "journey_date": "2026-12-16",
                "travel_class": "SL",
                "quota": "GN",
            },
        )

        assert response.status_code == 200
        payload = response.json()
        assert payload["success"] is True
        data = payload["data"]
        assert data["train_no"] == "12662"
        assert data["origin"] == "RJPM"
        assert data["destination"] == "MS"
        assert data["max_leg_horizon"] == 2
        assert data["direct_status"] == "WL 10"
        assert len(data["solutions"]) == 1

        sol = data["solutions"][0]
        assert sol["is_confirmed"] is True
        assert sol["tier"] == "TIER_1_SAME_TRAIN_SPLIT"
        assert sol["split_stations"] == ["MDU"]
        assert len(sol["legs"]) == 2
        assert sol["legs"][0]["from_station"] == "RJPM"
        assert sol["legs"][0]["to_station"] == "MDU"
        assert sol["legs"][1]["from_station"] == "MDU"
        assert sol["legs"][1]["to_station"] == "MS"


@pytest.mark.anyio
async def test_find_smart_routes_same_origin_destination(
    test_app: tuple[FastAPI, AsyncMock],
) -> None:
    """Verify 400 error when origin and destination are identical."""
    app, _ = test_app
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        response = await client.post(
            "/api/v1/trains/smart-routes",
            json={
                "train_no": "12662",
                "origin": "MS",
                "destination": "MS",
                "journey_date": "2026-12-16",
                "travel_class": "SL",
            },
        )
        assert response.status_code == 400
        error_data = response.json().get("error", {})
        assert "differ" in error_data.get("message", "")


@pytest.mark.anyio
async def test_find_smart_routes_invalid_inputs(
    test_app: tuple[FastAPI, AsyncMock],
) -> None:
    """Verify 422 error on invalid train number or travel class."""
    app, _ = test_app
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        # Invalid train number (too short)
        res1 = await client.post(
            "/api/v1/trains/smart-routes",
            json={
                "train_no": "12",
                "origin": "RJPM",
                "destination": "MS",
                "journey_date": "2026-12-16",
                "travel_class": "SL",
            },
        )
        assert res1.status_code == 422

        # Invalid travel class
        res2 = await client.post(
            "/api/v1/trains/smart-routes",
            json={
                "train_no": "12662",
                "origin": "RJPM",
                "destination": "MS",
                "journey_date": "2026-12-16",
                "travel_class": "INVALID",
            },
        )
        assert res2.status_code == 422
