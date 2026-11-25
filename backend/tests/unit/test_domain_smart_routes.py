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


def test_calculate_booking_strategy_rac_vs_avl_prioritizes_confirmed_berth() -> None:
    """When Leg 1 has RAC 15 and Leg 2 has AVL 5, Leg 2 MUST be booked first."""
    from trainwatch.domain.smart_routes import calculate_booking_strategy

    today = date(2026, 12, 1)
    leg_rac = SubLeg(
        leg_number=1,
        train_no="12662",
        train_name="Pothigai Express",
        from_station="RJPM",
        to_station="MDU",
        travel_class="SL",
        quota="GN",
        status=AvailabilityStatus.RAC,
        raw_status="RAC 15",
        position=15,
        fare=140,
        departure_time="19:55",
        arrival_time="21:15",
        duration_minutes=80,
        distance_km=89,
        journey_date=today,
    )
    leg_avl = SubLeg(
        leg_number=2,
        train_no="12662",
        train_name="Pothigai Express",
        from_station="MDU",
        to_station="MS",
        travel_class="SL",
        quota="GN",
        status=AvailabilityStatus.AVAILABLE,
        raw_status="AVAILABLE 5",
        position=5,
        fare=280,
        departure_time="21:20",
        arrival_time="06:40",
        duration_minutes=560,
        distance_km=495,
        journey_date=today,
    )

    strat = calculate_booking_strategy((leg_rac, leg_avl), today)
    # Leg 2 (AVL 5) must be booked first as confirmed anchor
    assert strat.recommended_order == (2, 1)
    assert "Book Leg 2" in strat.headline
    assert "secure confirmed berth" in strat.headline
    assert "5 confirmed open berths" in strat.strategy_reason
    assert "where berth allocation only occurs at chart preparation" in strat.strategy_reason
    assert strat.same_coach_probability == "MODERATE"
    assert strat.steps[0].leg_number == 2
    assert "Confirmed Anchor" in strat.steps[0].action_title
    assert strat.steps[1].leg_number == 1
    assert "with Coach Preference" in strat.steps[1].action_title
    assert "RAC berth" in (strat.steps[1].preferred_coach_tip or "")

    # Inverted case: Leg 1 is AVL 5 and Leg 2 is RAC 15 -> Leg 1 must be booked first
    strat_inv = calculate_booking_strategy((leg_avl, leg_rac), today)
    assert strat_inv.recommended_order == (2, 1)
    assert strat_inv.steps[0].leg_number == 2


def test_calculate_booking_strategy_both_rac_prioritizes_lower_queue() -> None:
    """When both legs are RAC, prioritize lower queue position for higher confirmation."""
    from trainwatch.domain.smart_routes import calculate_booking_strategy

    today = date(2026, 12, 1)
    leg_rac15 = SubLeg(
        leg_number=1,
        train_no="12662",
        train_name="Pothigai Express",
        from_station="RJPM",
        to_station="MDU",
        travel_class="SL",
        quota="GN",
        status=AvailabilityStatus.RAC,
        raw_status="RAC 15",
        position=15,
        fare=140,
        departure_time="19:55",
        arrival_time="21:15",
        duration_minutes=80,
        distance_km=89,
        journey_date=today,
    )
    leg_rac3 = SubLeg(
        leg_number=2,
        train_no="12662",
        train_name="Pothigai Express",
        from_station="MDU",
        to_station="MS",
        travel_class="SL",
        quota="GN",
        status=AvailabilityStatus.RAC,
        raw_status="RAC 3",
        position=3,
        fare=280,
        departure_time="21:20",
        arrival_time="06:40",
        duration_minutes=560,
        distance_km=495,
        journey_date=today,
    )

    strat = calculate_booking_strategy((leg_rac15, leg_rac3), today)
    # Leg 2 has RAC 3 (closer to confirmation than RAC 15), so Leg 2 is first
    assert strat.recommended_order == (2, 1)
    assert strat.same_coach_probability == "BEST_EFFORT"
    assert "chart preparation" in strat.strategy_reason


def test_calculate_booking_strategy_3leg_mixed_rac_and_avl() -> None:
    """Multi-leg sorting ensures all confirmed legs precede any RAC legs."""
    from trainwatch.domain.smart_routes import calculate_booking_strategy

    today = date(2026, 12, 1)
    leg1 = SubLeg(
        leg_number=1,
        train_no="12662",
        train_name="Pothigai",
        from_station="A",
        to_station="B",
        travel_class="SL",
        quota="GN",
        status=AvailabilityStatus.RAC,
        raw_status="RAC 20",
        position=20,
        distance_km=100,
        journey_date=today,
    )
    leg2 = SubLeg(
        leg_number=2,
        train_no="12662",
        train_name="Pothigai",
        from_station="B",
        to_station="C",
        travel_class="SL",
        quota="GN",
        status=AvailabilityStatus.AVAILABLE,
        raw_status="AVAILABLE 2",
        position=2,
        distance_km=200,
        journey_date=today,
    )
    leg3 = SubLeg(
        leg_number=3,
        train_no="12662",
        train_name="Pothigai",
        from_station="C",
        to_station="D",
        travel_class="SL",
        quota="GN",
        status=AvailabilityStatus.AVAILABLE,
        raw_status="AVAILABLE 8",
        position=8,
        distance_km=300,
        journey_date=today,
    )

    strat = calculate_booking_strategy((leg1, leg2, leg3), today)
    # Confirmed leg 3 (8 seats) > Confirmed leg 2 (2 seats) > RAC leg 1
    assert strat.recommended_order == (3, 2, 1)
    assert strat.same_coach_probability == "MODERATE"
    assert strat.steps[0].leg_number == 3
    assert strat.steps[1].leg_number == 2
    assert strat.steps[2].leg_number == 1

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

    # Additional coverage for _get_confirmed_seats and _get_rac_position
    from trainwatch.domain.smart_routes import _get_confirmed_seats, _get_rac_position

    assert _get_confirmed_seats(subleg_wl_nodigit) == 0
    assert _get_rac_position(subleg_avl_nodigit) == 999999

    subleg_avl_regex = SubLeg(
        leg_number=1,
        train_no="12662",
        train_name="Pothigai",
        from_station="RJPM",
        to_station="MDU",
        travel_class="SL",
        quota="GN",
        status=AvailabilityStatus.AVAILABLE,
        raw_status="AVAILABLE 4",
        position=None,
    )
    assert _get_confirmed_seats(subleg_avl_regex) == 4

    subleg_rac_regex = SubLeg(
        leg_number=1,
        train_no="12662",
        train_name="Pothigai",
        from_station="RJPM",
        to_station="MDU",
        travel_class="SL",
        quota="GN",
        status=AvailabilityStatus.RAC,
        raw_status="RAC 6",
        position=None,
    )
    assert _get_rac_position(subleg_rac_regex) == 6

    # Balanced confirmed inventory with >= 5 seats
    leg_bal1 = SubLeg(
        leg_number=1,
        train_no="12662",
        train_name="Pothigai",
        from_station="A",
        to_station="B",
        travel_class="SL",
        quota="GN",
        status=AvailabilityStatus.AVAILABLE,
        raw_status="AVAILABLE 6",
        position=6,
        journey_date=today,
    )
    leg_bal2 = SubLeg(
        leg_number=2,
        train_no="12662",
        train_name="Pothigai",
        from_station="B",
        to_station="C",
        travel_class="SL",
        quota="GN",
        status=AvailabilityStatus.AVAILABLE,
        raw_status="AVAILABLE 6",
        position=6,
        journey_date=today,
    )
    strat_bal = calculate_booking_strategy((leg_bal1, leg_bal2), today)
    assert strat_bal.same_coach_probability == "HIGH"
    assert "balanced availability" in strat_bal.strategy_reason

    # Both RAC where Leg 1 has lower queue than Leg 2
    leg_r1 = SubLeg(
        leg_number=1,
        train_no="12662",
        train_name="Pothigai",
        from_station="A",
        to_station="B",
        travel_class="SL",
        quota="GN",
        status=AvailabilityStatus.RAC,
        raw_status="RAC 2",
        position=2,
        journey_date=today,
    )
    leg_r2 = SubLeg(
        leg_number=2,
        train_no="12662",
        train_name="Pothigai",
        from_station="B",
        to_station="C",
        travel_class="SL",
        quota="GN",
        status=AvailabilityStatus.RAC,
        raw_status="RAC 10",
        position=10,
        journey_date=today,
    )
    strat_r = calculate_booking_strategy((leg_r1, leg_r2), today)
    assert strat_r.recommended_order == (1, 2)
    assert strat_r.same_coach_probability == "BEST_EFFORT"

    # 3-leg all RAC/Waitlist coverage
    leg_w1 = SubLeg(
        leg_number=1,
        train_no="12662",
        train_name="Pothigai",
        from_station="A",
        to_station="B",
        travel_class="SL",
        quota="GN",
        status=AvailabilityStatus.RAC,
        raw_status="RAC 8",
        position=8,
        distance_km=100,
        journey_date=today,
    )
    leg_w2 = SubLeg(
        leg_number=2,
        train_no="12662",
        train_name="Pothigai",
        from_station="B",
        to_station="C",
        travel_class="SL",
        quota="GN",
        status=AvailabilityStatus.RAC,
        raw_status="RAC 2",
        position=2,
        distance_km=200,
        journey_date=today,
    )
    leg_w3 = SubLeg(
        leg_number=3,
        train_no="12662",
        train_name="Pothigai",
        from_station="C",
        to_station="D",
        travel_class="SL",
        quota="GN",
        status=AvailabilityStatus.WAITLIST,
        raw_status="WL 15",
        position=15,
        distance_km=150,
        journey_date=today,
    )
    strat_all_w = calculate_booking_strategy((leg_w1, leg_w2, leg_w3), today)
    assert strat_all_w.recommended_order == (2, 1, 3)
    assert strat_all_w.same_coach_probability == "BEST_EFFORT"
    assert "best confirmation queue" in strat_all_w.headline


def test_get_confirmed_seats_and_rac_position_fallback() -> None:
    """Test fallback when position is None/0 and raw_status contains no digits."""
    from trainwatch.domain.smart_routes import _get_confirmed_seats, _get_rac_position

    today = date(2026, 12, 1)
    leg_avl_no_digits = SubLeg(
        leg_number=1,
        train_no="12662",
        train_name="Pothigai",
        from_station="A",
        to_station="B",
        travel_class="SL",
        quota="GN",
        status=AvailabilityStatus.AVAILABLE,
        raw_status="AVAILABLE",
        position=None,
        journey_date=today,
    )
    assert _get_confirmed_seats(leg_avl_no_digits) == 1

    leg_rac_no_digits = SubLeg(
        leg_number=1,
        train_no="12662",
        train_name="Pothigai",
        from_station="A",
        to_station="B",
        travel_class="SL",
        quota="GN",
        status=AvailabilityStatus.RAC,
        raw_status="RAC",
        position=None,
        journey_date=today,
    )
    assert _get_rac_position(leg_rac_no_digits) == 1


def test_origin_extension_strategy_and_presentation_builder() -> None:
    """Verify OriginExtensionStrategyBuilder and SolutionPresentationBuilder across tiers."""
    from trainwatch.domain.smart_routes import (
        SolutionPresentationBuilder,
        SolutionTier,
        calculate_booking_strategy,
    )

    board_date = date(2026, 12, 16)
    prev_night = date(2026, 12, 15)

    # Overnight Origin Extension leg (starts Dec 15 23:30, boards Dec 16 06:30)
    leg_ext_night = SubLeg(
        leg_number=1,
        train_no="12662",
        train_name="Pothigai Exp",
        from_station="SCT",
        to_station="MS",
        travel_class="SL",
        quota="GN",
        status=AvailabilityStatus.AVAILABLE,
        raw_status="AVAILABLE 22",
        position=22,
        fare=440,
        departure_time="23:30",
        arrival_time="09:00",
        journey_date=prev_night,
    )
    strat_night = calculate_booking_strategy(
        (leg_ext_night,),
        board_date,
        boarding_station="RJPM",
        boarding_departure_time="06:30",
        fare_surcharge=30,
    )
    assert "Boarding Station to RJPM" in strat_night.headline
    assert "15-Dec-2026" in strat_night.strategy_reason
    assert "16-Dec-2026" in strat_night.strategy_reason
    assert "06:30" in strat_night.strategy_reason
    assert strat_night.steps[0].preferred_coach_tip is not None
    assert "RJPM" in strat_night.steps[0].preferred_coach_tip

    pres_ext_night = SolutionPresentationBuilder.build(
        tier=SolutionTier.TIER_2_ORIGIN_EXTENSION,
        legs=(leg_ext_night,),
        is_confirmed=True,
        is_rac=False,
        split_stations=(),
        boarding_station="RJPM",
        boarding_date=board_date,
        boarding_departure_time="06:30",
        fare_surcharge=30,
    )
    assert pres_ext_night.badge_text == "CONFIRMED"
    assert pres_ext_night.strategy_label == "Origin Quota"
    assert "(+Rs 30)" in pres_ext_night.card_headline
    assert "Boarding Point as RJPM" in pres_ext_night.card_headline
    assert "Date Notice:" in pres_ext_night.guide_steps[2]

    # Same-day Origin Extension with RAC status & 0 surcharge
    leg_ext_same_day = SubLeg(
        leg_number=1,
        train_no="12662",
        train_name="Pothigai Exp",
        from_station="TSI",
        to_station="MS",
        travel_class="SL",
        quota="GN",
        status=AvailabilityStatus.RAC,
        raw_status="RAC 12",
        position=12,
        journey_date=board_date,
    )
    strat_same = calculate_booking_strategy(
        (leg_ext_same_day,),
        board_date,
        boarding_station="RJPM",
    )
    assert "same day" in strat_same.strategy_reason

    pres_ext_rac = SolutionPresentationBuilder.build(
        tier=SolutionTier.TIER_2_ORIGIN_EXTENSION,
        legs=(leg_ext_same_day,),
        is_confirmed=False,
        is_rac=True,
        split_stations=(),
        boarding_station="RJPM",
        boarding_date=board_date,
        fare_surcharge=0,
    )
    assert pres_ext_rac.badge_text == "RAC 12"
    assert pres_ext_rac.confirmed_tag == "Better RAC Queue"

    # Tier 1 Same Train Split (3 legs vs 2 legs)
    leg2 = SubLeg(
        leg_number=2,
        train_no="12662",
        train_name="Pothigai Exp",
        from_station="MDU",
        to_station="TPJ",
        travel_class="SL",
        quota="GN",
        status=AvailabilityStatus.AVAILABLE,
        raw_status="AVAILABLE 8",
        journey_date=board_date,
    )
    leg3 = SubLeg(
        leg_number=3,
        train_no="12662",
        train_name="Pothigai Exp",
        from_station="TPJ",
        to_station="MS",
        travel_class="SL",
        quota="GN",
        status=AvailabilityStatus.AVAILABLE,
        raw_status="AVAILABLE 4",
        journey_date=board_date,
    )
    pres_t1 = SolutionPresentationBuilder.build(
        tier=SolutionTier.TIER_1_SAME_TRAIN_SPLIT,
        legs=(leg_ext_same_day, leg2, leg3),
        is_confirmed=False,
        is_rac=True,
        split_stations=("MDU", "TPJ"),
        boarding_station=None,
        boarding_date=board_date,
    )
    assert pres_t1.comparison_sublabel == "2 seat shifts"
    assert pres_t1.action_button_label == "Show Same-Coach Booking Trick"

    # Tier 3 Transfer Backup coverage
    pres_t3 = SolutionPresentationBuilder.build(
        tier=SolutionTier.TIER_3_TRANSFER_BACKUP,
        legs=(leg_ext_same_day,),
        is_confirmed=False,
        is_rac=False,
        split_stations=(),
        boarding_station=None,
        boarding_date=board_date,
    )
    assert pres_t3.badge_text == "ALTERNATIVE"
    assert pres_t3.strategy_label == "Transfer Route"
    assert pres_t3.action_button_label is None
