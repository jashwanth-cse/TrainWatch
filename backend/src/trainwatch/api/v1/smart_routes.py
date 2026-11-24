"""Public smart routing and berth splitting API routes."""

from __future__ import annotations

from datetime import date
from typing import Annotated, cast

from fastapi import APIRouter, Depends, Request, status
from pydantic import BaseModel, Field

from trainwatch.api.errors import ApiError
from trainwatch.config import AppSettings
from trainwatch.domain.smart_routes import SmartRouteQuery, SmartRouteResult
from trainwatch.services.smart_routing_engine import SmartRoutingEngine

router = APIRouter(prefix="/trains", tags=["smart-routes"])


class SmartRoutesRequestPayload(BaseModel):
    """Client request to discover multi-leg confirmed berth splits."""

    train_no: str = Field(
        ...,
        pattern=r"^\d{4,5}$",
        description="4 or 5-digit Indian Railways train number",
    )
    origin: str = Field(
        ...,
        pattern=r"^[A-Z0-9]{2,6}$",
        description="Origin station code (e.g., RJPM)",
    )
    destination: str = Field(
        ...,
        pattern=r"^[A-Z0-9]{2,6}$",
        description="Destination station code (e.g., MS)",
    )
    journey_date: date = Field(..., description="Journey date in YYYY-MM-DD format")
    travel_class: str = Field(
        ...,
        pattern=r"^(1A|2A|3A|3E|SL|CC|2S|EC|EA|FC|GN)$",
        description="Travel class code (e.g., SL, 3A)",
    )
    quota: str = Field(
        default="GN",
        pattern=r"^(GN|TQ|PT|LD|SS|DF|FT|HP|DP|OS|RAC)$",
        description="Quota code (e.g., GN, TQ)",
    )


class SubLegPayload(BaseModel):
    """Payload representing a single leg segment of a journey solution."""

    leg_number: int
    train_no: str
    train_name: str
    from_station: str
    to_station: str
    journey_date: str
    travel_class: str
    quota: str
    status: str
    raw_status: str
    position: int | None = None
    fare: int | None = None
    departure_time: str | None = None
    arrival_time: str | None = None
    duration_minutes: int = 0
    distance_km: int = 0


class BookingOrderStepPayload(BaseModel):
    """Step in the intelligent booking order sequence."""

    step_number: int
    leg_number: int
    from_station: str
    to_station: str
    journey_date: str
    departure_time: str | None = None
    raw_status: str
    available_seats: int | None = None
    action_title: str
    action_instructions: str
    preferred_coach_tip: str | None = None


class BookingStrategyPayload(BaseModel):
    """Intelligent booking strategy payload."""

    headline: str
    recommended_order: list[int]
    strategy_reason: str
    same_coach_probability: str
    steps: list[BookingOrderStepPayload]
    insider_tips: list[str]


class SmartRouteSolutionPayload(BaseModel):
    """Payload representing a single smart routing solution."""

    solution_id: str
    tier: str
    legs: list[SubLegPayload]
    total_fare: int | None = None
    fare_surcharge: int = 0
    fare_surcharge_pct: float = 0.0
    total_duration_minutes: int = 0
    boarding_station: str | None = None
    is_confirmed: bool
    is_rac: bool
    recommendation_score: float
    split_stations: list[str]
    booking_strategy: BookingStrategyPayload | None = None


class SmartRoutesDataPayload(BaseModel):
    """Payload containing all discovered solutions and journey metadata."""

    train_no: str
    train_name: str
    origin: str
    destination: str
    journey_date: str
    travel_class: str
    journey_duration_hours: float
    journey_distance_km: int
    max_leg_horizon: int
    direct_status: str | None = None
    direct_fare: int | None = None
    solutions: list[SmartRouteSolutionPayload]
    execution_time_ms: float
    stations_evaluated_count: int
    queries_executed_count: int


class SmartRoutesResponse(BaseModel):
    """Top-level response envelope for smart routing queries."""

    success: bool = True
    message: str = "Smart routes discovered successfully"
    data: SmartRoutesDataPayload


def get_smart_routing_engine(request: Request) -> SmartRoutingEngine:
    """Resolve or lazily initialize the SmartRoutingEngine singleton on application state."""
    engine = getattr(request.app.state, "smart_routing_engine", None)
    if engine is None:
        settings = getattr(request.app.state, "settings", None) or AppSettings.from_environment()
        from trainwatch.infrastructure.train_api.cdn_schedule import CdnScheduleClient
        from trainwatch.infrastructure.train_api.client import (
            DreamDestinyClient,
            create_train_api_http_client,
        )

        schedule_client = CdnScheduleClient(
            cdn_base_url=settings.train_schedule_cdn_base_url,
            fallback_base_url=settings.train_api_base_url,
        )
        train_http = create_train_api_http_client(base_url=settings.train_api_base_url)
        train_client = DreamDestinyClient(train_http)
        engine = SmartRoutingEngine(
            schedule_client=schedule_client,
            train_client=train_client,
        )
        request.app.state.smart_routing_engine = engine
    return cast(SmartRoutingEngine, engine)


@router.post(
    "/smart-routes",
    response_model=SmartRoutesResponse,
    status_code=status.HTTP_200_OK,
    summary="Discover confirmed multi-leg berth splitting solutions for a train journey",
)
async def find_smart_routes(
    payload: SmartRoutesRequestPayload,
    engine: Annotated[SmartRoutingEngine, Depends(get_smart_routing_engine)],
) -> SmartRoutesResponse:
    """Execute ASG-DAG multi-leg berth splitting engine and return prioritized solutions."""
    if payload.origin.strip().upper() == payload.destination.strip().upper():
        raise ApiError(
            status_code=400,
            code="invalid_request",
            message="Origin and destination stations must differ",
        )

    domain_query = SmartRouteQuery(
        train_no=payload.train_no,
        origin=payload.origin,
        destination=payload.destination,
        journey_date=payload.journey_date,
        travel_class=payload.travel_class,
        quota=payload.quota,
    )

    result: SmartRouteResult = await engine.search(domain_query)

    direct_status_str = result.direct_status.raw_availability if result.direct_status else None

    solutions_payload = [
        SmartRouteSolutionPayload(
            solution_id=sol.solution_id,
            tier=sol.tier.value,
            legs=[
                SubLegPayload(
                    leg_number=leg.leg_number,
                    train_no=leg.train_no,
                    train_name=leg.train_name,
                    from_station=leg.from_station,
                    to_station=leg.to_station,
                    journey_date=leg.journey_date.isoformat()
                    if leg.journey_date
                    else str(result.journey_date),
                    travel_class=leg.travel_class,
                    quota=leg.quota,
                    status=leg.status.value,
                    raw_status=leg.raw_status,
                    position=leg.position,
                    fare=leg.fare,
                    departure_time=leg.departure_time,
                    arrival_time=leg.arrival_time,
                    duration_minutes=leg.duration_minutes,
                    distance_km=leg.distance_km,
                )
                for leg in sol.legs
            ],
            total_fare=sol.total_fare,
            fare_surcharge=sol.fare_surcharge,
            fare_surcharge_pct=sol.fare_surcharge_pct,
            total_duration_minutes=sol.total_duration_minutes,
            boarding_station=sol.boarding_station,
            is_confirmed=sol.is_confirmed,
            is_rac=sol.is_rac,
            recommendation_score=sol.recommendation_score,
            split_stations=list(sol.split_stations),
            booking_strategy=BookingStrategyPayload(
                headline=sol.booking_strategy.headline,
                recommended_order=list(sol.booking_strategy.recommended_order),
                strategy_reason=sol.booking_strategy.strategy_reason,
                same_coach_probability=sol.booking_strategy.same_coach_probability,
                steps=[
                    BookingOrderStepPayload(
                        step_number=step.step_number,
                        leg_number=step.leg_number,
                        from_station=step.from_station,
                        to_station=step.to_station,
                        journey_date=step.journey_date.isoformat(),
                        departure_time=step.departure_time,
                        raw_status=step.raw_status,
                        available_seats=step.available_seats,
                        action_title=step.action_title,
                        action_instructions=step.action_instructions,
                        preferred_coach_tip=step.preferred_coach_tip,
                    )
                    for step in sol.booking_strategy.steps
                ],
                insider_tips=list(sol.booking_strategy.insider_tips),
            )
            if sol.booking_strategy
            else None,
        )
        for sol in result.solutions
    ]

    return SmartRoutesResponse(
        success=True,
        message="Smart routes discovered successfully",
        data=SmartRoutesDataPayload(
            train_no=result.train_no,
            train_name=result.train_name,
            origin=result.origin,
            destination=result.destination,
            journey_date=str(result.journey_date),
            travel_class=result.travel_class,
            journey_duration_hours=result.journey_duration_hours,
            journey_distance_km=result.journey_distance_km,
            max_leg_horizon=result.max_leg_horizon,
            direct_status=direct_status_str,
            direct_fare=result.direct_fare,
            solutions=solutions_payload,
            execution_time_ms=result.execution_time_ms,
            stations_evaluated_count=result.stations_evaluated_count,
            queries_executed_count=result.queries_executed_count,
        ),
    )
