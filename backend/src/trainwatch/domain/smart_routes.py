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
class SolutionPresentation:
    """Server-driven presentation metadata rendered dynamically by client UI."""

    badge_text: str
    strategy_label: str
    comparison_sublabel: str
    confirmed_tag: str
    card_headline: str
    alt_summary: str
    guide_steps: tuple[str, ...]
    guide_note: str
    action_button_label: str | None = None
    modal_title: str = "Same-Coach Booking Trick"
    modal_tagline: str = "INTELLIGENT BOOKING ORDER"


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
    presentation: SolutionPresentation | None = None

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
    station_names: tuple[tuple[str, str], ...] = ()


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
    """Extract numeric seat count or queue position from position or raw status."""
    if subleg.position is not None and subleg.position > 0:
        return subleg.position
    match = re.search(r"\b(\d+)\b", subleg.raw_status)
    if match:
        return int(match.group(1))
    return 1 if subleg.status is AvailabilityStatus.AVAILABLE else 0


def _get_confirmed_seats(subleg: SubLeg) -> int:
    """Extract confirmed seat count if subleg is in AVAILABLE status."""
    if subleg.status is not AvailabilityStatus.AVAILABLE:
        return 0
    if subleg.position is not None and subleg.position > 0:
        return subleg.position
    match = re.search(r"\b(\d+)\b", subleg.raw_status)
    if match:
        return int(match.group(1))
    return 1


def _get_rac_position(subleg: SubLeg) -> int:
    """Extract RAC queue position if subleg is in RAC status."""
    if subleg.status is not AvailabilityStatus.RAC:
        return 999999
    if subleg.position is not None and subleg.position > 0:
        return subleg.position
    match = re.search(r"\b(\d+)\b", subleg.raw_status)
    if match:
        return int(match.group(1))
    return 1


class OriginExtensionStrategyBuilder:
    """Strategy builder for single-PNR Origin Extension with boarding point modification."""

    @staticmethod
    def build(
        leg: SubLeg,
        *,
        boarding_station: str,
        boarding_date: date,
        boarding_departure_time: str | None = None,
        fare_surcharge: int = 0,
    ) -> BookingStrategy:
        """Build step-by-step IRCTC instructions for Origin Extension booking."""
        ticket_date = leg.journey_date or boarding_date
        ticket_date_str = ticket_date.strftime("%d-%b-%Y")
        board_date_str = boarding_date.strftime("%d-%b-%Y")
        board_time_note = f" at {boarding_departure_time}" if boarding_departure_time else ""
        surcharge_note = f" for just Rs {fare_surcharge} extra" if fare_surcharge > 0 else ""

        if ticket_date < boarding_date:
            date_shift_note = (
                f" Note the overnight schedule: Train {leg.train_no} starts at {leg.from_station} "
                f"on {ticket_date_str} (Dep: {leg.departure_time or 'Scheduled'}) and reaches "
                f"{boarding_station} on {board_date_str}{board_time_note}."
            )
        else:
            date_shift_note = (
                f" Train {leg.train_no} departs {leg.from_station} on {ticket_date_str} and "
                f"reaches {boarding_station} on the same day{board_time_note}."
            )

        headline = (
            f"Book full ticket from {leg.from_station} to {leg.to_station} "
            f"and set Boarding Station to {boarding_station}"
        )
        reason = (
            f"Upstream quota from {leg.from_station} offers {leg.raw_status}{surcharge_note} "
            f"on a single ticket with zero berth switching.{date_shift_note} By selecting "
            f"{boarding_station} as your Boarding Point during IRCTC checkout, your seat remains "
            f"reserved until you board at {boarding_station}."
        )
        step = BookingOrderStep(
            step_number=1,
            leg_number=leg.leg_number,
            from_station=leg.from_station,
            to_station=leg.to_station,
            journey_date=ticket_date,
            departure_time=leg.departure_time,
            raw_status=leg.raw_status,
            available_seats=_extract_numeric_seats(leg),
            action_title=(
                f"Book Full Ticket ({leg.from_station} -> {leg.to_station}) & Set Boarding Point"
            ),
            action_instructions=(
                f"1. Search and book Train {leg.train_no} ({leg.travel_class}) from "
                f"{leg.from_station} to {leg.to_station} on journey date {ticket_date_str}.\n"
                f"2. On the IRCTC Passenger / Review page, change 'Boarding Station' to "
                f"{boarding_station} ({board_date_str}{board_time_note})."
            ),
            preferred_coach_tip=(
                f"CRITICAL: You MUST select {boarding_station} as your Boarding Station during "
                "booking (or update it at least 24 hours before departure) so the TTE does not "
                "mark you absent after departure from the origin."
            ),
        )
        tips = (
            (
                "Changing Boarding Point forward along the same train is 100% IRCTC compliant "
                "and carries zero extra fee."
            ),
            (
                "Double-check the ticket date: book for the train start date at "
                f"{leg.from_station} ({ticket_date_str}), then board at {boarding_station} on "
                f"{board_date_str}."
            ),
            "Once set, IRCTC updates your Boarding Station on your Electronic Reservation Slip.",
            "Single PNR booking: zero coach switching needed throughout your trip.",
        )
        return BookingStrategy(
            headline=headline,
            recommended_order=(leg.leg_number,),
            strategy_reason=reason,
            same_coach_probability="HIGH",
            steps=(step,),
            insider_tips=tips,
        )


class SolutionPresentationBuilder:
    """Builds server-driven UI presentation payloads for SmartRouteSolution objects."""

    @staticmethod
    def build(
        *,
        tier: SolutionTier,
        legs: tuple[SubLeg, ...],
        is_confirmed: bool,
        is_rac: bool,
        split_stations: tuple[str, ...],
        boarding_station: str | None,
        boarding_date: date,
        boarding_departure_time: str | None = None,
        fare_surcharge: int = 0,
    ) -> SolutionPresentation:
        """Construct server-authored copy and UI instructions for any solution tier."""
        first_leg = legs[0]
        badge_text = (
            "CONFIRMED" if is_confirmed else (first_leg.raw_status if is_rac else "ALTERNATIVE")
        )

        if tier is SolutionTier.TIER_2_ORIGIN_EXTENSION and boarding_station:
            ticket_date = first_leg.journey_date or boarding_date
            ticket_date_str = ticket_date.strftime("%d-%b-%Y")
            board_date_str = boarding_date.strftime("%d-%b-%Y")
            board_time = f" ({boarding_departure_time})" if boarding_departure_time else ""
            surcharge_str = f" (+Rs {fare_surcharge})" if fare_surcharge > 0 else ""

            if ticket_date < boarding_date:
                date_note = (
                    f"Date Notice: Train departs {first_leg.from_station} on {ticket_date_str} "
                    f"({first_leg.departure_time or 'Night'}) and reaches {boarding_station} on "
                    f"{board_date_str}{board_time}."
                )
            else:
                date_note = (
                    f"Book for {ticket_date_str} from {first_leg.from_station} and board at "
                    f"{boarding_station} on {board_date_str}{board_time}."
                )

            guide_steps = (
                (
                    f"1. Book Full Ticket: {first_leg.from_station} to {first_leg.to_station} on "
                    f"{ticket_date_str} - Train {first_leg.train_no} ({first_leg.travel_class}) "
                    f"[{first_leg.raw_status}]."
                ),
                (
                    f"2. Set Boarding Station to {boarding_station} on {board_date_str}"
                    f"{board_time} during IRCTC checkout."
                ),
                date_note,
            )
            return SolutionPresentation(
                badge_text=badge_text,
                strategy_label="Origin Quota",
                comparison_sublabel="No seat shift",
                confirmed_tag="Single Ticket" if is_confirmed else "Better RAC Queue",
                card_headline=(
                    f"Book full ticket from {first_leg.from_station} to {first_leg.to_station}"
                    f"{surcharge_str} and select Boarding Point as {boarding_station}. "
                    "Zero seat shifts!"
                ),
                alt_summary=(
                    f"Book {first_leg.from_station} -> {first_leg.to_station}, board at "
                    f"{boarding_station} • {first_leg.raw_status}"
                ),
                guide_steps=guide_steps,
                guide_note=(
                    f"Important: Select Boarding Point as {boarding_station} on IRCTC so your "
                    f"berth is held until {boarding_station}."
                ),
                action_button_label="Show Boarding Point Trick",
                modal_title="Origin Boarding Trick",
                modal_tagline="ORIGIN QUOTA OPTIMIZATION",
            )

        if tier is SolutionTier.TIER_1_SAME_TRAIN_SPLIT:
            switches = max(0, len(legs) - 1)
            shift_word = "shift" if switches == 1 else "shifts"
            split_label = ", ".join(split_stations) if split_stations else "intermediate hub"
            guide_steps_list = [
                (
                    f"{idx + 1}. Book Ticket {idx + 1}: {leg.from_station} to {leg.to_station} "
                    f"on {(leg.journey_date or boarding_date).strftime('%Y-%m-%d')} - "
                    f"Train {leg.train_no} ({leg.travel_class})."
                )
                for idx, leg in enumerate(legs)
            ]
            return SolutionPresentation(
                badge_text=badge_text,
                strategy_label="Smart Split",
                comparison_sublabel=f"{switches} seat {shift_word}",
                confirmed_tag="Guaranteed Seat" if is_confirmed else "RAC Combination",
                card_headline=(f"Stay on the same train! Just shift your seat at {split_label}."),
                alt_summary=f"Shift at {split_label} • {len(legs)} legs ({badge_text})",
                guide_steps=tuple(guide_steps_list),
                guide_note=(
                    f"You remain on Train {first_leg.train_no} throughout the entire journey."
                ),
                action_button_label="Show Same-Coach Booking Trick" if len(legs) > 1 else None,
                modal_title="Same-Coach Booking Trick",
                modal_tagline="INTELLIGENT BOOKING ORDER",
            )

        # Tier 3 / Fallback backup
        guide_steps_backup = tuple(
            f"{idx + 1}. Book {leg.from_station} to {leg.to_station} on "
            f"{(leg.journey_date or boarding_date).strftime('%Y-%m-%d')} - Train {leg.train_no}."
            for idx, leg in enumerate(legs)
        )
        return SolutionPresentation(
            badge_text=badge_text,
            strategy_label="Transfer Route",
            comparison_sublabel=f"{max(0, len(legs) - 1)} transfer",
            confirmed_tag="Confirmed Transfer" if is_confirmed else "Backup Option",
            card_headline=(
                f"Transfer route via {', '.join(split_stations) if split_stations else 'hub'}."
            ),
            alt_summary=f"{len(legs)} segments ({badge_text})",
            guide_steps=guide_steps_backup,
            guide_note="Check transfer buffer time carefully before booking connecting trains.",
            action_button_label="Show Booking Order" if len(legs) > 1 else None,
            modal_title="Transfer Booking Guide",
            modal_tagline="MULTI-TRAIN CONNECTION",
        )


def calculate_booking_strategy(
    legs: tuple[SubLeg, ...],
    origin_date: date,
    *,
    boarding_station: str | None = None,
    boarding_departure_time: str | None = None,
    fare_surcharge: int = 0,
) -> BookingStrategy:
    """Evaluate berth inventory across legs and generate optimal booking strategy."""
    if len(legs) <= 1:
        leg = legs[0]
        if boarding_station:
            return OriginExtensionStrategyBuilder.build(
                leg,
                boarding_station=boarding_station,
                boarding_date=origin_date,
                boarding_departure_time=boarding_departure_time,
                fare_surcharge=fare_surcharge,
            )

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

    order: tuple[int, ...]
    steps: tuple[BookingOrderStep, ...]
    headline: str
    reason: str
    probability: str

    if len(legs) == 2:
        leg1 = legs[0]
        leg2 = legs[1]
        is_conf1 = leg1.status is AvailabilityStatus.AVAILABLE
        is_conf2 = leg2.status is AvailabilityStatus.AVAILABLE

        # Case A: Mixed status - One leg is Confirmed (AVL), One is RAC/WL
        if is_conf1 and not is_conf2:
            order = (leg1.leg_number, leg2.leg_number)
            primary_leg = leg1
            dependent_leg = leg2
            conf_seats = _get_confirmed_seats(leg1)
            headline = (
                f"Book Leg {leg1.leg_number} ({leg1.from_station} to {leg1.to_station}) "
                "first to secure confirmed berth and anchor coach"
            )
            reason = (
                f"Leg {leg1.leg_number} has {conf_seats} confirmed open berths, securing a "
                "guaranteed sleeper berth and immediately providing your confirmed Coach ID. "
                f"Leg {leg2.leg_number} is in {dependent_leg.status.value} ({leg2.raw_status}), "
                "where berth allocation only occurs at chart preparation. Securing your booking "
                f"on Leg {leg1.leg_number} first gives you the Coach ID to enter in "
                f"'Preferred Coach' when booking Leg {leg2.leg_number}."
            )
            probability = "MODERATE"
        elif is_conf2 and not is_conf1:
            order = (leg2.leg_number, leg1.leg_number)
            primary_leg = leg2
            dependent_leg = leg1
            conf_seats = _get_confirmed_seats(leg2)
            headline = (
                f"Book Leg {leg2.leg_number} ({leg2.from_station} to {leg2.to_station}) "
                "first to secure confirmed berth and anchor coach"
            )
            reason = (
                f"Leg {leg2.leg_number} has {conf_seats} confirmed open berths, securing a "
                "guaranteed sleeper berth and immediately providing your confirmed Coach ID. "
                f"Leg {leg1.leg_number} is in {dependent_leg.status.value} ({leg1.raw_status}), "
                "where berth allocation only occurs at chart preparation. Securing your booking "
                f"on Leg {leg2.leg_number} first gives you the Coach ID to enter in "
                f"'Preferred Coach' when booking Leg {leg1.leg_number}."
            )
            probability = "MODERATE"

        # Case B: Both legs are Confirmed (AVL)
        elif is_conf1 and is_conf2:
            seats1 = _get_confirmed_seats(leg1)
            seats2 = _get_confirmed_seats(leg2)
            if seats2 > seats1:
                order = (leg2.leg_number, leg1.leg_number)
                primary_leg = leg2
                dependent_leg = leg1
                headline = (
                    f"Book Leg {leg2.leg_number} "
                    f"({leg2.from_station} to {leg2.to_station}) "
                    "first for coach matching"
                )
                reason = (
                    f"Leg {leg2.leg_number} has more open seats ({seats2} available) than "
                    f"Leg {leg1.leg_number} ({seats1} available). "
                    f"Securing your booking on Leg {leg2.leg_number} first locks in your "
                    "confirmed coach ID (e.g., S3 or B2). "
                    f"You can then enter that coach ID as your 'Preferred Coach' when booking "
                    f"Leg {leg1.leg_number}."
                )
                probability = "HIGH" if seats2 >= 4 and seats1 >= 1 else "MODERATE"
            elif seats1 > seats2:
                order = (leg1.leg_number, leg2.leg_number)
                primary_leg = leg1
                dependent_leg = leg2
                headline = (
                    f"Book Leg {leg1.leg_number} "
                    f"({leg1.from_station} to {leg1.to_station}) "
                    "first for coach matching"
                )
                reason = (
                    f"Leg {leg1.leg_number} has more open seats ({seats1} available) than "
                    f"Leg {leg2.leg_number} ({seats2} available). "
                    f"Securing your booking on Leg {leg1.leg_number} first locks in your "
                    "confirmed coach ID. "
                    f"You can then enter that coach ID as your 'Preferred Coach' when booking "
                    f"Leg {leg2.leg_number}."
                )
                probability = "HIGH" if seats1 >= 4 and seats2 >= 1 else "MODERATE"
            else:
                order = (leg1.leg_number, leg2.leg_number)
                primary_leg = leg1
                dependent_leg = leg2
                if seats1 <= 1:
                    headline = (
                        f"Book Leg {leg1.leg_number} first, then select nearby coach "
                        f"preference for Leg {leg2.leg_number}"
                    )
                    reason = (
                        "Both legs have scarce inventory (1 seat each). Book Leg "
                        f"{leg1.leg_number} immediately to confirm, then enter its coach "
                        f"ID when booking Leg {leg2.leg_number}. If that coach is full, "
                        "IRCTC PRS will allocate the nearest available coach."
                    )
                    probability = "BEST_EFFORT"
                else:
                    headline = (
                        f"Book Leg {leg1.leg_number} first, then match coach in "
                        f"Leg {leg2.leg_number}"
                    )
                    reason = (
                        f"Both legs have balanced availability ({seats1} seats each). Book Leg "
                        f"{leg1.leg_number} to receive your coach number, then set that coach as "
                        f"preferred when booking Leg {leg2.leg_number}."
                    )
                    probability = "HIGH" if seats1 >= 5 else "MODERATE"

        # Case C: Both legs are RAC (or non-confirmed)
        else:
            rac1 = _get_rac_position(leg1)
            rac2 = _get_rac_position(leg2)
            if rac2 < rac1:
                order = (leg2.leg_number, leg1.leg_number)
                primary_leg = leg2
                dependent_leg = leg1
                headline = (
                    f"Book Leg {leg2.leg_number} ({leg2.from_station} to {leg2.to_station}) "
                    "first (higher RAC confirmation priority)"
                )
                reason = (
                    f"Both legs are in RAC. Leg {leg2.leg_number} ({leg2.raw_status}) is closer "
                    f"to confirmation than Leg {leg1.leg_number} ({leg1.raw_status}). Note that "
                    "coach and berth assignments for RAC tickets are made during final chart "
                    "preparation (4 hours prior to departure)."
                )
            else:
                order = (leg1.leg_number, leg2.leg_number)
                primary_leg = leg1
                dependent_leg = leg2
                headline = (
                    f"Book Leg {leg1.leg_number} ({leg1.from_station} to {leg1.to_station}) "
                    "first (higher RAC confirmation priority)"
                )
                reason = (
                    f"Both legs are in RAC. Leg {leg1.leg_number} ({leg1.raw_status}) has equal "
                    f"or higher confirmation likelihood than Leg {leg2.leg_number} "
                    f"({leg2.raw_status}). Note that coach and berth assignments for RAC tickets "
                    "are made during final chart preparation (4 hours prior to departure)."
                )
            probability = "BEST_EFFORT"

        date_primary = primary_leg.journey_date or origin_date
        date_dependent = dependent_leg.journey_date or origin_date

        if primary_leg.status is AvailabilityStatus.AVAILABLE:
            s1_title = (
                f"Step 1: Book Leg {primary_leg.leg_number} "
                f"({primary_leg.from_station} -> {primary_leg.to_station}) - Confirmed Anchor"
            )
            s1_instructions = (
                f"Book on IRCTC for journey date {date_primary.strftime('%d-%b-%Y')} "
                f"(Dep: {primary_leg.departure_time or 'Scheduled'}). Complete payment and note "
                "assigned Coach ID (e.g. S4, B2, M1) from your confirmation screen."
            )
            s1_tip = (
                "Do not set preferred coach for this first ticket. "
                "Let IRCTC assign the primary coach."
            )
        else:
            s1_title = (
                f"Step 1: Book Leg {primary_leg.leg_number} "
                f"({primary_leg.from_station} -> {primary_leg.to_station}) - Primary RAC Leg"
            )
            s1_instructions = (
                f"Book on IRCTC for journey date {date_primary.strftime('%d-%b-%Y')} "
                f"(Dep: {primary_leg.departure_time or 'Scheduled'}). Secure this leg first."
            )
            s1_tip = (
                "Primary RAC booking - coach number will be assigned during final chart "
                "preparation."
            )

        step1 = BookingOrderStep(
            step_number=1,
            leg_number=primary_leg.leg_number,
            from_station=primary_leg.from_station,
            to_station=primary_leg.to_station,
            journey_date=date_primary,
            departure_time=primary_leg.departure_time,
            raw_status=primary_leg.raw_status,
            available_seats=_extract_numeric_seats(primary_leg),
            action_title=s1_title,
            action_instructions=s1_instructions,
            preferred_coach_tip=s1_tip,
        )

        if primary_leg.status is AvailabilityStatus.AVAILABLE:
            s2_title = (
                f"Step 2: Book Leg {dependent_leg.leg_number} "
                f"({dependent_leg.from_station} -> {dependent_leg.to_station}) "
                "with Coach Preference"
            )
            s2_instructions = (
                f"Immediately book on IRCTC for journey date {date_dependent.strftime('%d-%b-%Y')} "
                f"(Dep: {dependent_leg.departure_time or 'Scheduled'}). On the Passenger Details "
                "page, expand 'Other Preferences' and enter the Coach ID from Step 1."
            )
            if dependent_leg.status is AvailabilityStatus.AVAILABLE:
                s2_tip = (
                    "Entering the Coach ID from Step 1 instructs IRCTC to seat you in the same "
                    "coach. If the exact coach is full, IRCTC will allocate the closest adjacent "
                    "coach."
                )
            else:
                s2_tip = (
                    "Entering the Coach ID from Step 1 instructs IRCTC PRS to seat or allocate "
                    "your RAC berth in or nearest to your confirmed coach during chart preparation."
                )
        else:
            s2_title = (
                f"Step 2: Book Leg {dependent_leg.leg_number} "
                f"({dependent_leg.from_station} -> {dependent_leg.to_station}) - Connecting RAC Leg"
            )
            s2_instructions = (
                f"Book on IRCTC for journey date {date_dependent.strftime('%d-%b-%Y')} "
                f"(Dep: {dependent_leg.departure_time or 'Scheduled'})."
            )
            s2_tip = (
                "Both legs are in RAC. Berths and coaches are allocated during chart preparation."
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
            action_title=s2_title,
            action_instructions=s2_instructions,
            preferred_coach_tip=s2_tip,
        )

        steps = (step1, step2)
    else:

        def _leg_priority_key(item: SubLeg) -> tuple[int, int, int]:
            if item.status is AvailabilityStatus.AVAILABLE:
                tier = 2
                score = _get_confirmed_seats(item)
            elif item.status is AvailabilityStatus.RAC:
                tier = 1
                score = -_get_rac_position(item)
            else:
                tier = 0
                score = 0
            return (tier, score, item.distance_km)

        sorted_legs = sorted(legs, key=_leg_priority_key, reverse=True)
        order = tuple(item.leg_number for item in sorted_legs)
        first = sorted_legs[0]

        if first.status is AvailabilityStatus.AVAILABLE:
            headline = (
                f"Book Leg {first.leg_number} ({first.from_station} to {first.to_station}) "
                "first as anchor coach"
            )
            reason = (
                f"Leg {first.leg_number} has confirmed berths "
                f"({_get_confirmed_seats(first)} seats available). Booking it first establishes "
                "your anchor coach ID for the remaining connecting legs."
            )
            all_avl = all(item.status is AvailabilityStatus.AVAILABLE for item in legs)
            probability = "HIGH" if all_avl else "MODERATE"
        else:
            headline = (
                f"Book Leg {first.leg_number} ({first.from_station} to {first.to_station}) "
                "first (best confirmation queue)"
            )
            reason = (
                f"All legs are in RAC/Waitlist. Leg {first.leg_number} ({first.raw_status}) has "
                "the highest confirmation priority. Berths will be allotted at chart preparation."
            )
            probability = "BEST_EFFORT"

        step_list: list[BookingOrderStep] = []
        for idx, leg in enumerate(sorted_legs):
            ldate = leg.journey_date or origin_date
            if idx == 0:
                if leg.status is AvailabilityStatus.AVAILABLE:
                    action_title = f"Step 1: Book Leg {leg.leg_number} (Confirmed Anchor Leg)"
                    action_instructions = (
                        f"Book on IRCTC for journey date {ldate.strftime('%d-%b-%Y')} "
                        f"({leg.from_station} -> {leg.to_station}). "
                        "Note down the allotted Coach ID."
                    )
                    preferred_coach_tip = "Let IRCTC assign primary coach for this anchor ticket."
                else:
                    action_title = f"Step 1: Book Leg {leg.leg_number} (Primary RAC Leg)"
                    action_instructions = (
                        f"Book on IRCTC for journey date {ldate.strftime('%d-%b-%Y')} "
                        f"({leg.from_station} -> {leg.to_station})."
                    )
                    preferred_coach_tip = "Primary RAC booking - coach assigned during charting."
            else:
                action_title = f"Step {idx + 1}: Book Leg {leg.leg_number} with Coach Preference"
                if first.status is AvailabilityStatus.AVAILABLE:
                    action_instructions = (
                        f"Book on IRCTC for journey date {ldate.strftime('%d-%b-%Y')} "
                        f"({leg.from_station} -> {leg.to_station}). "
                        "Enter Coach ID from Step 1."
                    )
                    preferred_coach_tip = "Set Preferred Coach ID to match your anchor ticket."
                else:
                    action_instructions = (
                        f"Book on IRCTC for journey date {ldate.strftime('%d-%b-%Y')} "
                        f"({leg.from_station} -> {leg.to_station})."
                    )
                    preferred_coach_tip = "RAC leg - berths allocated during chart preparation."

            s = BookingOrderStep(
                step_number=idx + 1,
                leg_number=leg.leg_number,
                from_station=leg.from_station,
                to_station=leg.to_station,
                journey_date=ldate,
                departure_time=leg.departure_time,
                raw_status=leg.raw_status,
                available_seats=_extract_numeric_seats(leg),
                action_title=action_title,
                action_instructions=action_instructions,
                preferred_coach_tip=preferred_coach_tip,
            )
            step_list.append(s)
        steps = tuple(step_list)

    insider_tips = (
        "Book during standard IRCTC hours (00:20 to 23:45 IST) to prevent payment timeouts.",
        "Add all passenger profiles into your IRCTC Master List to autofill details in seconds.",
        (
            "On IRCTC passenger details page, expand 'Other Preferences' "
            "and enter the coach number in 'Preferred Coach ID'."
        ),
        "If exact coach is full, IRCTC automatically places you in the nearest adjacent coach.",
    )

    return BookingStrategy(
        headline=headline,
        recommended_order=order,
        strategy_reason=reason,
        same_coach_probability=probability,
        steps=steps,
        insider_tips=insider_tips,
    )
