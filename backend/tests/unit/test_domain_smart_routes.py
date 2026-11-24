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

    with pytest.raises(ValueError, match="destination"):
        SmartRouteQuery(
            train_no="12662",
            origin="RJPM",
            destination="M",
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


def test_calculate_booking_strategy_scarce_vs_plentiful() -> None:
    """When Leg 2 has AVL 7 and Leg 1 has AVL 1, Leg 2 must be booked first."""
    from trainwatch.domain.smart_routes import calculate_booking_strategy

    today = date(2026, 12, 1)
    leg1 = SubLeg(
        leg_number=1,
        train_no="12662",
        train_name="Pothigai Express",
        from_station="RJPM",
        to_station="MDU",
        travel_class="SL",
        quota="GN",
        status=AvailabilityStatus.AVAILABLE,
        raw_status="AVAILABLE 1",
        position=1,
        fare=140,
        departure_time="19:55",
        arrival_time="21:15",
        duration_minutes=80,
        distance_km=89,
        journey_date=today,
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
        raw_status="AVAILABLE 7",
        position=7,
        fare=280,
        departure_time="21:20",
        arrival_time="06:40",
        duration_minutes=560,
        distance_km=495,
        journey_date=today,
    )

    strat = calculate_booking_strategy((leg1, leg2), today)
    assert strat.recommended_order == (2, 1)
    assert "Book Leg 2" in strat.headline
    assert "Leg 2 has more open seats (7 available)" in strat.strategy_reason
    assert strat.same_coach_probability == "HIGH"
    assert len(strat.steps) == 2
    assert strat.steps[0].leg_number == 2
    assert strat.steps[1].leg_number == 1

    # Inverted case: Leg 1 has 7 seats, Leg 2 has 1 seat -> Leg 1 first
    strat_inv = calculate_booking_strategy((leg2, leg1), today)
    assert strat_inv.recommended_order == (2, 1)


def test_calculate_booking_strategy_scarce_both() -> None:
    """When both legs have AVL 1, flag BEST_EFFORT and nearby coach preference."""
    from trainwatch.domain.smart_routes import calculate_booking_strategy

    today = date(2026, 12, 1)
    leg1 = SubLeg(
        leg_number=1,
        train_no="12662",
        train_name="Pothigai Express",
        from_station="RJPM",
        to_station="MDU",
        travel_class="SL",
        quota="GN",
        status=AvailabilityStatus.AVAILABLE,
        raw_status="AVAILABLE 1",
        position=1,
        fare=140,
        departure_time="19:55",
        arrival_time="21:15",
        duration_minutes=80,
        distance_km=89,
        journey_date=today,
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
        raw_status="AVAILABLE 1",
        position=1,
        fare=280,
        departure_time="21:20",
        arrival_time="06:40",
        duration_minutes=560,
        distance_km=495,
        journey_date=today,
    )

    strat = calculate_booking_strategy((leg1, leg2), today)
    assert strat.recommended_order == (1, 2)
    assert strat.same_coach_probability == "BEST_EFFORT"
    assert "nearby coach preference" in strat.headline.lower()


def test_calculate_booking_strategy_single_leg_and_3leg() -> None:
    """Verify single-leg direct guidance and 3-leg multi-seat buffer sorting."""
    from trainwatch.domain.smart_routes import calculate_booking_strategy

    today = date(2026, 12, 1)
    leg1 = SubLeg(
        leg_number=1,
        train_no="12662",
        train_name="Pothigai Express",
        from_station="RJPM",
        to_station="MS",
        travel_class="SL",
        quota="GN",
        status=AvailabilityStatus.AVAILABLE,
        raw_status="AVAILABLE 10",
        position=10,
        fare=420,
        journey_date=today,
    )
    strat1 = calculate_booking_strategy((leg1,), today)
    assert strat1.recommended_order == (1,)
    assert len(strat1.steps) == 1

    leg_a = SubLeg(
        leg_number=1,
        train_no="12622",
        train_name="TN Exp",
        from_station="NDLS",
        to_station="BPL",
        travel_class="3A",
        quota="GN",
        status=AvailabilityStatus.AVAILABLE,
        raw_status="AVAILABLE 2",
        position=2,
        distance_km=702,
        journey_date=today,
    )
    leg_b = SubLeg(
        leg_number=2,
        train_no="12622",
        train_name="TN Exp",
        from_station="BPL",
        to_station="BZA",
        travel_class="3A",
        quota="GN",
        status=AvailabilityStatus.AVAILABLE,
        raw_status="AVAILABLE 12",
        position=12,
        distance_km=1049,
        journey_date=today,
    )
    leg_c = SubLeg(
        leg_number=3,
        train_no="12622",
        train_name="TN Exp",
        from_station="BZA",
        to_station="MAS",
        travel_class="3A",
        quota="GN",
        status=AvailabilityStatus.AVAILABLE,
        raw_status="AVAILABLE 5",
        position=5,
        distance_km=431,
        journey_date=today,
    )
    strat3 = calculate_booking_strategy((leg_a, leg_b, leg_c), today)
    assert strat3.recommended_order[0] == 2  # leg 2 had 12 seats, so it is anchor leg

    # Coverage for _extract_numeric_seats fallback branches
    from trainwatch.domain.smart_routes import _extract_numeric_seats

    subleg_avl_nodigit = SubLeg(
        leg_number=1,
        train_no="12662",
        train_name="Pothigai",
        from_station="RJPM",
        to_station="MDU",
        travel_class="SL",
        quota="GN",
        status=AvailabilityStatus.AVAILABLE,
        raw_status="AVAILABLE",
        position=None,
    )
    assert _extract_numeric_seats(subleg_avl_nodigit) == 1

    subleg_wl_nodigit = SubLeg(
        leg_number=1,
        train_no="12662",
        train_name="Pothigai",
        from_station="RJPM",
        to_station="MDU",
        travel_class="SL",
        quota="GN",
        status=AvailabilityStatus.WAITLIST,
        raw_status="WAITLIST",
        position=None,
    )
    assert _extract_numeric_seats(subleg_wl_nodigit) == 0
