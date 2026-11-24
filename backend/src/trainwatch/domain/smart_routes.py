"""Domain models and algorithms for multi-leg train berth splitting."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from enum import StrEnum

from trainwatch.domain.availability import AvailabilitySnapshot, AvailabilityStatus
from trainwatch.domain.watch import QUOTAS, TRAVEL_CLASSES

_TRAIN_NUMBER_PATTERN = re.compile(r"^\d{4,5}$")
_STATION_CODE_PATTERN = re.compile(r"^[A-Z0-9]{2,6}$")


class StationRole(StrEnum):
    """Hierarchical classification for intermediate split candidate stations."""

    ORIGIN = "ORIGIN"
    DESTINATION = "DESTINATION"
    MAJOR_HUB = "MAJOR_HUB"
    STATE_CAPITAL = "STATE_CAPITAL"
    DIVISION_HQ = "DIVISION_HQ"
    JUNCTION = "JUNCTION"
    ADJACENT_HALT = "ADJACENT_HALT"


class SolutionTier(StrEnum):
    """Routing solution classification tier."""

    TIER_1_SAME_TRAIN_SPLIT = "TIER_1_SAME_TRAIN_SPLIT"
    TIER_2_ORIGIN_EXTENSION = "TIER_2_ORIGIN_EXTENSION"
    TIER_3_TRANSFER_BACKUP = "TIER_3_TRANSFER_BACKUP"


def compute_leg_horizon(duration_hours: float) -> int:
    """Compute maximum permitted leg horizon based on total journey duration.

    - Under 12 hours: Max 2 legs (1 split point).
    - 12 to 24 hours: Max 3 legs (2 split points).
    - Over 24 hours: Max 4 legs (3 split points).
    - Hard ceiling: 4 legs.
    """
    if duration_hours < 0:
        raise ValueError("journey duration cannot be negative")
    if duration_hours < 12.0:
        return 2
    if duration_hours <= 24.0:
        return 3
    return 4


@dataclass(frozen=True, slots=True)
class SubLeg:
    """A single leg segment of a journey solution."""

    leg_number: int
    train_no: str
    train_name: str
    from_station: str
    to_station: str
    travel_class: str
    quota: str
    status: AvailabilityStatus
    raw_status: str
    position: int | None = None
    fare: int | None = None
    departure_time: str | None = None
    arrival_time: str | None = None
    duration_minutes: int = 0
    distance_km: int = 0
    journey_date: date | None = None

    def __post_init__(self) -> None:
        if self.leg_number <= 0:
            raise ValueError("leg_number must be positive")
        if self.from_station == self.to_station:
            raise ValueError("from_station and to_station must differ")


@dataclass(frozen=True, slots=True)
class BookingOrderStep:
    """A structured step within the intelligent same-coach booking guidance."""

    step_number: int
    leg_number: int
    from_station: str
    to_station: str
    journey_date: date
    departure_time: str | None
    raw_status: str
    available_seats: int | None
    action_title: str
    action_instructions: str
    preferred_coach_tip: str | None = None


@dataclass(frozen=True, slots=True)
class BookingStrategy:
    """Intelligent coach-matching and booking order strategy for a solution."""

    headline: str
    recommended_order: tuple[int, ...]
    strategy_reason: str
    same_coach_probability: str  # "HIGH", "MODERATE", "BEST_EFFORT"
    steps: tuple[BookingOrderStep, ...]
    insider_tips: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class SmartRouteSolution:
    """A viable multi-leg or extended route option."""

    solution_id: str
    tier: SolutionTier
    legs: tuple[SubLeg, ...]
    total_fare: int | None
    fare_surcharge: int
    fare_surcharge_pct: float
    total_duration_minutes: int
    boarding_station: str | None
    is_confirmed: bool
    is_rac: bool
    recommendation_score: float
    split_stations: tuple[str, ...]
    booking_strategy: BookingStrategy | None = None

    def __post_init__(self) -> None:
        if not self.legs:
            raise ValueError("a solution must have at least one leg")


@dataclass(frozen=True, slots=True)
class SmartRouteQuery:
    """Validated query requesting smart berth splitting solutions."""

    train_no: str
    origin: str
    destination: str
    journey_date: date
    travel_class: str
    quota: str = "GN"

    def __post_init__(self) -> None:
        train_no = self.train_no.strip()
        origin = self.origin.strip().upper()
        destination = self.destination.strip().upper()
        travel_class = self.travel_class.strip().upper()
        quota = self.quota.strip().upper()

        if _TRAIN_NUMBER_PATTERN.fullmatch(train_no) is None:
            raise ValueError("train_no must contain 4 or 5 digits")
        if _STATION_CODE_PATTERN.fullmatch(origin) is None:
            raise ValueError("origin must contain 2 to 6 alphanumeric characters")
        if _STATION_CODE_PATTERN.fullmatch(destination) is None:
            raise ValueError("destination must contain 2 to 6 alphanumeric characters")
        if origin == destination:
            raise ValueError("origin and destination must differ")
        if travel_class not in TRAVEL_CLASSES:
            raise ValueError(f"unsupported travel_class '{travel_class}'")
        if quota not in QUOTAS:
            raise ValueError(f"unsupported quota '{quota}'")


@dataclass(frozen=True, slots=True)
class SmartRouteResult:
    """Overall outcome containing all discovered smart routing solutions."""

    train_no: str
    train_name: str
    origin: str
    destination: str
    journey_date: date
    travel_class: str
    journey_duration_hours: float
    journey_distance_km: int
    max_leg_horizon: int
    direct_status: AvailabilitySnapshot | None
    direct_fare: int | None
    solutions: tuple[SmartRouteSolution, ...]
    execution_time_ms: float
    stations_evaluated_count: int
    queries_executed_count: int


def calculate_recommendation_score(
    *,
    is_confirmed: bool,
    is_rac: bool,
    leg_count: int,
    fare_surcharge_pct: float,
    layover_penalty_minutes: int = 0,
) -> float:
    """Calculate normalized recommendation score (0.0 to 100.0).

    Base:
    - Confirmed: 100.0
    - RAC: 70.0
    - Waitlist: 20.0

    Penalties:
    - Extra leg penalty: -10.0 points per switch beyond direct.
    - Surcharge penalty: -1.0 point per 2% surcharge above direct fare.
    - Layover penalty (inter-train only): -0.5 point per 10 minutes wait.
    """
    if is_confirmed:
        base = 100.0
    elif is_rac:
        base = 70.0
    else:
        base = 20.0

    switches = max(0, leg_count - 1)
    switch_penalty = switches * 10.0
    surcharge_penalty = min(30.0, max(0.0, fare_surcharge_pct / 2.0))
    layover_penalty = min(20.0, max(0.0, layover_penalty_minutes / 20.0))

    score = base - switch_penalty - surcharge_penalty - layover_penalty
    return round(max(0.0, min(100.0, score)), 2)


def _extract_numeric_seats(subleg: SubLeg) -> int:
    """Extract numeric seat count from position or raw status."""
    if subleg.position is not None and subleg.position > 0:
        return subleg.position
    match = re.search(r"\b(\d+)\b", subleg.raw_status)
    if match:
        return int(match.group(1))
    return 1 if subleg.status is AvailabilityStatus.AVAILABLE else 0


def calculate_booking_strategy(
    legs: tuple[SubLeg, ...], origin_date: date
) -> BookingStrategy:
    """Evaluate berth inventory across split legs and generate optimal coach-matching booking order."""
    if len(legs) <= 1:
        leg = legs[0]
        leg_date = leg.journey_date or origin_date
        step = BookingOrderStep(
            step_number=1,
            leg_number=leg.leg_number,
            from_station=leg.from_station,
            to_station=leg.to_station,
            journey_date=leg_date,
            departure_time=leg.departure_time,
            raw_status=leg.raw_status,
            available_seats=_extract_numeric_seats(leg),
            action_title="Direct Ticket Booking",
            action_instructions=(
                f"Book Ticket: {leg.from_station} to {leg.to_station} on "
                f"{leg_date.strftime('%d-%b-%Y')} (Train {leg.train_no}, {leg.travel_class})."
            ),
            preferred_coach_tip=None,
        )
        return BookingStrategy(
            headline="Single Leg Booking",
            recommended_order=(leg.leg_number,),
            strategy_reason="Single leg journey requires no intermediate coach transfer.",
            same_coach_probability="HIGH",
            steps=(step,),
            insider_tips=(
                "Book during IRCTC reservation hours (00:20 to 23:45 IST).",
                "Ensure passenger names are in your IRCTC Master List for rapid checkout.",
            ),
        )

    first_leg = legs[0]
    second_leg = legs[1]
    seats1 = _extract_numeric_seats(first_leg)
    seats2 = _extract_numeric_seats(second_leg)

    if len(legs) == 2:
        if seats2 > seats1:
            order = (second_leg.leg_number, first_leg.leg_number)
            primary_leg = second_leg
            dependent_leg = first_leg
            headline = f"Book Leg {second_leg.leg_number} ({second_leg.from_station} to {second_leg.to_station}) first for coach matching"
            reason = (
                f"Leg {second_leg.leg_number} has more open seats ({seats2} available) than Leg {first_leg.leg_number} ({seats1} available). "
                f"Securing your booking on Leg {second_leg.leg_number} first locks in your confirmed coach ID (e.g., S3 or B2). "
                f"You can then enter that coach ID as your 'Preferred Coach' when booking Leg {first_leg.leg_number}."
            )
            probability = "HIGH" if seats2 >= 4 and seats1 >= 1 else "MODERATE"
        elif seats1 > seats2:
            order = (first_leg.leg_number, second_leg.leg_number)
            primary_leg = first_leg
            dependent_leg = second_leg
            headline = f"Book Leg {first_leg.leg_number} ({first_leg.from_station} to {first_leg.to_station}) first for coach matching"
            reason = (
                f"Leg {first_leg.leg_number} has more open seats ({seats1} available) than Leg {second_leg.leg_number} ({seats2} available). "
                f"Securing your booking on Leg {first_leg.leg_number} first locks in your confirmed coach ID. "
                f"You can then enter that coach ID as your 'Preferred Coach' when booking Leg {second_leg.leg_number}."
            )
            probability = "HIGH" if seats1 >= 4 and seats2 >= 1 else "MODERATE"
        else:
            order = (first_leg.leg_number, second_leg.leg_number)
            primary_leg = first_leg
            dependent_leg = second_leg
            if seats1 <= 1:
                headline = f"Book Leg {first_leg.leg_number} first, then select nearby coach preference for Leg {second_leg.leg_number}"
                reason = (
                    "Both legs have scarce inventory (1 seat each). Book Leg "
                    f"{first_leg.leg_number} immediately to secure confirmation, then enter its coach ID when "
                    f"booking Leg {second_leg.leg_number}. If that exact coach is full, IRCTC PRS will allocate the nearest available coach."
                )
                probability = "BEST_EFFORT"
            else:
                headline = f"Book Leg {first_leg.leg_number} first, then match coach in Leg {second_leg.leg_number}"
                reason = (
                    f"Both legs have balanced availability ({seats1} seats each). Book Leg {first_leg.leg_number} to receive "
                    f"your coach number, then set that coach as preferred when booking Leg {second_leg.leg_number}."
                )
                probability = "HIGH" if seats1 >= 5 else "MODERATE"

        date_primary = primary_leg.journey_date or origin_date
        date_dependent = dependent_leg.journey_date or origin_date

        step1 = BookingOrderStep(
            step_number=1,
            leg_number=primary_leg.leg_number,
            from_station=primary_leg.from_station,
            to_station=primary_leg.to_station,
            journey_date=date_primary,
            departure_time=primary_leg.departure_time,
            raw_status=primary_leg.raw_status,
            available_seats=_extract_numeric_seats(primary_leg),
            action_title=f"Step 1: Book Leg {primary_leg.leg_number} ({primary_leg.from_station} -> {primary_leg.to_station})",
            action_instructions=(
                f"Book on IRCTC for journey date {date_primary.strftime('%d-%b-%Y')} "
                f"(Dep: {primary_leg.departure_time or 'Scheduled'}). Complete payment and note down "
                "the assigned Coach ID (e.g. S4, B2, M1) from your confirmation screen."
            ),
            preferred_coach_tip="Do not set preferred coach for this first ticket. Let IRCTC assign the primary coach.",
        )

        step2 = BookingOrderStep(
            step_number=2,
            leg_number=dependent_leg.leg_number,
            from_station=dependent_leg.from_station,
            to_station=dependent_leg.to_station,
            journey_date=date_dependent,
            departure_time=dependent_leg.departure_time,
            raw_status=dependent_leg.raw_status,
            available_seats=_extract_numeric_seats(dependent_leg),
            action_title=f"Step 2: Book Leg {dependent_leg.leg_number} ({dependent_leg.from_station} -> {dependent_leg.to_station})",
            action_instructions=(
                f"Immediately book on IRCTC for journey date {date_dependent.strftime('%d-%b-%Y')} "
                f"(Dep: {dependent_leg.departure_time or 'Scheduled'}). On the Passenger Details page, "
                "expand 'Other Preferences' and enter the Coach ID you received from Step 1."
            ),
            preferred_coach_tip=(
                "Entering the Coach ID from Step 1 instructs IRCTC to seat you in the same coach. "
                "If the exact coach is full, IRCTC will allocate the closest adjacent coach."
            ),
        )

        steps = (step1, step2)
    else:
        sorted_legs = sorted(legs, key=lambda l: (_extract_numeric_seats(l), l.distance_km), reverse=True)
        order = tuple(l.leg_number for l in sorted_legs)
        first = sorted_legs[0]
        headline = f"Book Leg {first.leg_number} ({first.from_station} to {first.to_station}) first as anchor coach"
        reason = (
            f"Leg {first.leg_number} has the highest seat buffer ({_extract_numeric_seats(first)} seats). "
            "Booking it first establishes your anchor coach ID for the remaining connecting legs."
        )
        probability = "MODERATE"
        step_list: list[BookingOrderStep] = []
        for idx, leg in enumerate(sorted_legs):
            ldate = leg.journey_date or origin_date
            if idx == 0:
                s = BookingOrderStep(
                    step_number=1,
                    leg_number=leg.leg_number,
                    from_station=leg.from_station,
                    to_station=leg.to_station,
                    journey_date=ldate,
                    departure_time=leg.departure_time,
                    raw_status=leg.raw_status,
                    available_seats=_extract_numeric_seats(leg),
                    action_title=f"Step 1: Book Leg {leg.leg_number} (Anchor Leg)",
                    action_instructions=(
                        f"Book on IRCTC for journey date {ldate.strftime('%d-%b-%Y')} "
                        f"({leg.from_station} -> {leg.to_station}). Note down the allotted Coach ID."
                    ),
                    preferred_coach_tip="Let IRCTC assign the primary coach for this anchor ticket.",
                )
            else:
                s = BookingOrderStep(
                    step_number=idx + 1,
                    leg_number=leg.leg_number,
                    from_station=leg.from_station,
                    to_station=leg.to_station,
                    journey_date=ldate,
                    departure_time=leg.departure_time,
                    raw_status=leg.raw_status,
                    available_seats=_extract_numeric_seats(leg),
                    action_title=f"Step {idx + 1}: Book Leg {leg.leg_number} with Coach Preference",
                    action_instructions=(
                        f"Book on IRCTC for journey date {ldate.strftime('%d-%b-%Y')} "
                        f"({leg.from_station} -> {leg.to_station}). Enter the Coach ID from Step 1."
                    ),
                    preferred_coach_tip="Set Preferred Coach ID to match your anchor ticket.",
                )
            step_list.append(s)
        steps = tuple(step_list)

    insider_tips = (
        "Book during standard IRCTC hours (00:20 to 23:45 IST) to prevent payment gateway timeouts.",
        "Add all passenger profiles into your IRCTC Master List beforehand to autofill details in seconds.",
        "On the IRCTC passenger page, expand 'Other Preferences' and enter the coach number in 'Preferred Coach ID'.",
        "If exact coach matching is unavailable, IRCTC will automatically place you in the nearest adjacent coach on the same train.",
    )

    return BookingStrategy(
        headline=headline,
        recommended_order=order,
        strategy_reason=reason,
        same_coach_probability=probability,
        steps=steps,
        insider_tips=insider_tips,
    )
