"""Unit tests for smart routing domain models and leg horizon logic."""

from datetime import date

import pytest

from trainwatch.domain.availability import AvailabilityStatus
from trainwatch.domain.smart_routes import (
    SmartRouteQuery,
    SmartRouteSolution,
    SolutionTier,
    SubLeg,
    calculate_recommendation_score,
    compute_leg_horizon,
)


def test_compute_leg_horizon_durations() -> None:
    """Verify dynamic leg horizon based on travel duration."""
    # < 12 hours -> 2 legs
    assert compute_leg_horizon(0.5) == 2
    assert compute_leg_horizon(11.99) == 2

    # 12 to 24 hours -> 3 legs
    assert compute_leg_horizon(12.0) == 3
    assert compute_leg_horizon(18.5) == 3
    assert compute_leg_horizon(24.0) == 3

    # > 24 hours -> 4 legs (hard cap)
    assert compute_leg_horizon(24.01) == 4
    assert compute_leg_horizon(48.0) == 4

    # Negative duration raises ValueError
    with pytest.raises(ValueError, match="negative"):
        compute_leg_horizon(-1.0)


def test_smart_route_query_validation() -> None:
    """Validate strict security and format rules on SmartRouteQuery."""
    valid = SmartRouteQuery(
        train_no="12662",
        origin="RJPM",
        destination="MS",
        journey_date=date(2026, 12, 16),
        travel_class="SL",
        quota="GN",
    )
    assert valid.train_no == "12662"
    assert valid.origin == "RJPM"
    assert valid.destination == "MS"

    # Invalid train number
    with pytest.raises(ValueError, match="train_no"):
        SmartRouteQuery(
            train_no="12",
            origin="RJPM",
            destination="MS",
            journey_date=date(2026, 12, 16),
            travel_class="SL",
        )

    # Invalid origin / destination characters
    with pytest.raises(ValueError, match="origin"):
        SmartRouteQuery(
            train_no="12662",
            origin="R",
            destination="MS",
            journey_date=date(2026, 12, 16),
            travel_class="SL",
        )

    # Same origin and destination
    with pytest.raises(ValueError, match="must differ"):
        SmartRouteQuery(
            train_no="12662",
            origin="MS",
            destination="MS",
            journey_date=date(2026, 12, 16),
            travel_class="SL",
        )

    # Unsupported travel class
    with pytest.raises(ValueError, match="unsupported travel_class"):
        SmartRouteQuery(
            train_no="12662",
            origin="RJPM",
            destination="MS",
            journey_date=date(2026, 12, 16),
            travel_class="INVALID",
        )

    # Unsupported quota
    with pytest.raises(ValueError, match="unsupported quota"):
        SmartRouteQuery(
            train_no="12662",
            origin="RJPM",
            destination="MS",
            journey_date=date(2026, 12, 16),
            travel_class="SL",
            quota="XYZ",
        )


def test_subleg_and_solution_validation() -> None:
    """Validate SubLeg and SmartRouteSolution constraints."""
    leg1 = SubLeg(
        leg_number=1,
        train_no="12662",
        train_name="Pothigai Express",
        from_station="RJPM",
        to_station="MDU",
        travel_class="SL",
        quota="GN",
        status=AvailabilityStatus.AVAILABLE,
        raw_status="AVAILABLE 12",
        fare=140,
        departure_time="20:15",
        arrival_time="21:50",
        duration_minutes=95,
        distance_km=90,
    )
    leg2 = SubLeg(
        leg_number=2,
        train_no="12662",
        train_name="Pothigai Express",
        from_station="MDU",
        to_station="MS",
        travel_class="SL",
        quota="GN",
        status=AvailabilityStatus.AVAILABLE,
        raw_status="AVAILABLE 5",
        fare=300,
        departure_time="22:00",
        arrival_time="07:10",
        duration_minutes=550,
        distance_km=495,
    )

    solution = SmartRouteSolution(
        solution_id="sol-1",
        tier=SolutionTier.TIER_1_SAME_TRAIN_SPLIT,
        legs=(leg1, leg2),
        total_fare=440,
        fare_surcharge=40,
        fare_surcharge_pct=10.0,
        total_duration_minutes=655,
        boarding_station=None,
        is_confirmed=True,
        is_rac=False,
        recommendation_score=85.0,
        split_stations=("MDU",),
    )

    assert solution.is_confirmed is True
    assert solution.split_stations == ("MDU",)
    assert len(solution.legs) == 2

    # Subleg cannot have same from and to
    with pytest.raises(ValueError, match="must differ"):
        SubLeg(
            leg_number=1,
            train_no="12662",
            train_name="Pothigai",
            from_station="MDU",
            to_station="MDU",
            travel_class="SL",
            quota="GN",
            status=AvailabilityStatus.AVAILABLE,
            raw_status="AVAILABLE",
        )

    # Subleg leg_number must be > 0
    with pytest.raises(ValueError, match="positive"):
        SubLeg(
            leg_number=0,
            train_no="12662",
            train_name="Pothigai",
            from_station="RJPM",
            to_station="MDU",
            travel_class="SL",
            quota="GN",
            status=AvailabilityStatus.AVAILABLE,
            raw_status="AVAILABLE",
        )

    # Solution must have at least one leg
    with pytest.raises(ValueError, match="at least one leg"):
        SmartRouteSolution(
            solution_id="sol-empty",
            tier=SolutionTier.TIER_1_SAME_TRAIN_SPLIT,
            legs=(),
            total_fare=0,
            fare_surcharge=0,
            fare_surcharge_pct=0.0,
            total_duration_minutes=0,
            boarding_station=None,
            is_confirmed=False,
            is_rac=False,
            recommendation_score=0.0,
            split_stations=(),
        )


def test_calculate_recommendation_score() -> None:
    """Verify score calculation for confirmed, RAC, and waitlisted solutions."""
    # 2-leg confirmed with 5% surcharge
    score_conf = calculate_recommendation_score(
        is_confirmed=True,
        is_rac=False,
        leg_count=2,
        fare_surcharge_pct=5.0,
    )
    # Base 100 - 10 (1 switch) - 2.5 (5/2) = 87.5
    assert score_conf == 87.5

    # 3-leg confirmed with 10% surcharge
    score_3leg = calculate_recommendation_score(
        is_confirmed=True,
        is_rac=False,
        leg_count=3,
        fare_surcharge_pct=10.0,
    )
    # Base 100 - 20 (2 switches) - 5.0 (10/2) = 75.0
    assert score_3leg == 75.0

    # 2-leg RAC
    score_rac = calculate_recommendation_score(
        is_confirmed=False,
        is_rac=True,
        leg_count=2,
        fare_surcharge_pct=0.0,
    )
    # Base 70 - 10 = 60.0
    assert score_rac == 60.0

    # Waitlist
    score_wl = calculate_recommendation_score(
        is_confirmed=False,
        is_rac=False,
        leg_count=2,
        fare_surcharge_pct=0.0,
    )
    # Base 20 - 10 = 10.0
    assert score_wl == 10.0
