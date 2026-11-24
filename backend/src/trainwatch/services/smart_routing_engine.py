"""Adaptive Stage-Gated DAG Search (ASG-DAG) engine for train berth splitting."""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from datetime import date, timedelta
from uuid import uuid4

from trainwatch.domain.availability import (
    AvailabilityObservation,
    AvailabilitySnapshot,
    AvailabilityStatus,
    ProviderFailure,
)
from trainwatch.domain.smart_routes import (
    SmartRouteQuery,
    SmartRouteResult,
    SmartRouteSolution,
    SolutionTier,
    SubLeg,
    calculate_booking_strategy,
    calculate_recommendation_score,
    compute_leg_horizon,
)
from trainwatch.domain.watch import TrainQuery
from trainwatch.infrastructure.station_cache.topology_registry import (
    StationTopologyRegistry,
)
from trainwatch.infrastructure.train_api.cdn_schedule import (
    CdnScheduleClient,
    ScheduleStop,
    TrainSchedule,
    TrainScheduleError,
)
from trainwatch.infrastructure.train_api.client import DreamDestinyClient

_LOGGER = logging.getLogger(__name__)

SegmentQuerier = Callable[
    [ScheduleStop, ScheduleStop], Awaitable[tuple[AvailabilityObservation, int | None]]
]


def _calculate_leg_journey_date(
    query_origin_date: date, origin_stop: ScheduleStop, leg_from_stop: ScheduleStop
) -> date:
    """Calculate the calendar departure date for a leg based on stop day offsets."""
    day_offset = leg_from_stop.day - origin_stop.day
    return query_origin_date + timedelta(days=day_offset)


def _calculate_duration_minutes(dep_stop: ScheduleStop, arr_stop: ScheduleStop) -> int:
    """Calculate running duration in minutes between two schedule stops."""
    dep_h, dep_m = (int(x) for x in dep_stop.departure_time.split(":")[:2])
    arr_h, arr_m = (int(x) for x in arr_stop.arrival_time.split(":")[:2])
    day_diff = max(0, arr_stop.day - dep_stop.day)
    duration = (day_diff * 1440) + (arr_h * 60 + arr_m) - (dep_h * 60 + dep_m)
    return max(1, duration)


class SmartRoutingEngine:
    """ASG-DAG orchestrator for discovering multi-leg confirmed berth splits."""

    def __init__(
        self,
        *,
        schedule_client: CdnScheduleClient,
        train_client: DreamDestinyClient,
        concurrency_limit: int = 15,
    ) -> None:
        self._schedule_client = schedule_client
        self._train_client = train_client
        self._semaphore = asyncio.Semaphore(concurrency_limit)

    async def search(self, query: SmartRouteQuery) -> SmartRouteResult:
        """Execute the stage-gated search across 1 to 4 legs and origin extension."""
        start_time = time.monotonic()
        query_counter = 0

        # Step 1: Timetable Lookup
        try:
            schedule = await self._schedule_client.get_schedule(query.train_no)
        except TrainScheduleError as exc:
            _LOGGER.error("Schedule retrieval failed for train %s: %s", query.train_no, exc)
            return self._empty_result(query, start_time)

        try:
            subroute = schedule.get_subroute(query.origin, query.destination)
        except ValueError as exc:
            _LOGGER.warning(
                "Subroute invalid for %s -> %s: %s",
                query.origin,
                query.destination,
                exc,
            )
            return self._empty_result(query, start_time, schedule=schedule)

        origin_stop = subroute[0]
        dest_stop = subroute[-1]
        journey_duration_min = _calculate_duration_minutes(origin_stop, dest_stop)
        journey_duration_hours = journey_duration_min / 60.0
        journey_distance_km = max(1, dest_stop.distance_km - origin_stop.distance_km)
        max_leg_horizon = compute_leg_horizon(journey_duration_hours)

        # Memoization cache for segment queries: (from_stn, to_stn, dep_date) -> (obs, fare)
        memo: dict[tuple[str, str, date], tuple[AvailabilityObservation, int | None]] = {}

        async def query_segment(
            from_stop: ScheduleStop, to_stop: ScheduleStop
        ) -> tuple[AvailabilityObservation, int | None]:
            nonlocal query_counter
            dep_date = _calculate_leg_journey_date(query.journey_date, origin_stop, from_stop)
            key = (from_stop.station_code, to_stop.station_code, dep_date)
            if key in memo:
                return memo[key]
            async with self._semaphore:
                query_counter += 1
                try:
                    t_query = TrainQuery(
                        train_number=query.train_no,
                        source=from_stop.station_code,
                        destination=to_stop.station_code,
                        journey_date=dep_date,
                        travel_class=query.travel_class,
                        quota=query.quota,
                    )
                    obs, fare = await self._train_client.fetch_with_fare(t_query)
                except Exception as exc:
                    _LOGGER.warning(
                        "Segment query error %s->%s on %s: %s",
                        from_stop.station_code,
                        to_stop.station_code,
                        dep_date,
                        exc,
                    )
                    obs = AvailabilityObservation.failed(ProviderFailure.UPSTREAM)
                    fare = None
                memo[key] = (obs, fare)
                return obs, fare

        # Stage 1: Direct availability query
        direct_obs, direct_fare = await query_segment(origin_stop, dest_stop)
        direct_snapshot = direct_obs.snapshot if direct_obs else None

        solutions: list[SmartRouteSolution] = []

        # Candidate selection from intermediate stops
        intermediate_stops = subroute[1:-1]
        ranked_candidates = StationTopologyRegistry.rank_candidate_stations(
            intermediate_stops, max_candidates=5
        )
        stations_evaluated = len(ranked_candidates)

        if not ranked_candidates:
            return self._build_result(
                query=query,
                schedule=schedule,
                journey_duration_hours=journey_duration_hours,
                journey_distance_km=journey_distance_km,
                max_leg_horizon=max_leg_horizon,
                direct_snapshot=direct_snapshot,
                direct_fare=direct_fare,
                solutions=solutions,
                start_time=start_time,
                stations_evaluated=0,
                queries_executed=query_counter,
            )

        # Stage 2: 2-Leg Concurrent ASG-DAG Evaluation
        confirmed_prefixes_leg1: dict[str, tuple[ScheduleStop, SubLeg]] = {}
        stage2_tasks = [
            self._evaluate_2leg_candidate(
                candidate=cand,
                query=query,
                schedule=schedule,
                origin_stop=origin_stop,
                dest_stop=dest_stop,
                direct_fare=direct_fare,
                query_segment=query_segment,
                confirmed_prefixes_leg1=confirmed_prefixes_leg1,
            )
            for cand in ranked_candidates
        ]
        stage2_results = await asyncio.gather(*stage2_tasks, return_exceptions=True)
        for res in stage2_results:
            if isinstance(res, SmartRouteSolution):
                solutions.append(res)

        # Stage 3: 3-Leg Expansion (if permitted and confirmed prefixes exist)
        if max_leg_horizon >= 3 and len(confirmed_prefixes_leg1) >= 1:
            stage3_tasks = []
            cand_list = list(ranked_candidates)
            for i, cand_u in enumerate(cand_list):
                if cand_u.station_code not in confirmed_prefixes_leg1:
                    continue  # Prefix-Reusability: only expand if Leg 1 was AVAILABLE
                u_leg1 = confirmed_prefixes_leg1[cand_u.station_code][1]
                for cand_v in cand_list[i + 1 :]:
                    stage3_tasks.append(
                        self._evaluate_3leg_candidate(
                            cand_u=cand_u,
                            cand_v=cand_v,
                            leg1=u_leg1,
                            query=query,
                            schedule=schedule,
                            origin_stop=origin_stop,
                            dest_stop=dest_stop,
                            direct_fare=direct_fare,
                            query_segment=query_segment,
                        )
                    )
            if stage3_tasks:
                stage3_results = await asyncio.gather(*stage3_tasks, return_exceptions=True)
                for res in stage3_results:
                    if isinstance(res, SmartRouteSolution):
                        solutions.append(res)

        # Stage 4: 4-Leg Expansion (if permitted and 3-leg solutions still not confirmed)
        has_any_confirmed = any(s.is_confirmed for s in solutions)
        if max_leg_horizon >= 4 and not has_any_confirmed and len(confirmed_prefixes_leg1) >= 1:
            cand_list = list(ranked_candidates)
            stage4_tasks = []
            for i, cand_u in enumerate(cand_list):
                if cand_u.station_code not in confirmed_prefixes_leg1:
                    continue
                u_leg1 = confirmed_prefixes_leg1[cand_u.station_code][1]
                for j in range(i + 1, len(cand_list)):
                    cand_v = cand_list[j]
                    for cand_w in cand_list[j + 1 :]:
                        stage4_tasks.append(
                            self._evaluate_4leg_candidate(
                                cand_u=cand_u,
                                cand_v=cand_v,
                                cand_w=cand_w,
                                leg1=u_leg1,
                                query=query,
                                schedule=schedule,
                                origin_stop=origin_stop,
                                dest_stop=dest_stop,
                                direct_fare=direct_fare,
                                query_segment=query_segment,
                            )
                        )
            if stage4_tasks:
                stage4_results = await asyncio.gather(*stage4_tasks, return_exceptions=True)
                for res in stage4_results:
                    if isinstance(res, SmartRouteSolution):
                        solutions.append(res)

        # Tier 2: Same-Train Origin Extension Evaluation
        if origin_stop.stop_number > 1:
            ext_solution = await self._evaluate_origin_extension(
                query=query,
                schedule=schedule,
                origin_stop=origin_stop,
                dest_stop=dest_stop,
                direct_fare=direct_fare,
                direct_snapshot=direct_snapshot,
                query_segment=query_segment,
            )
            if ext_solution is not None:
                solutions.append(ext_solution)

        # Sort solutions: Confirmed first, then RAC, then score, then lowest fare
        solutions.sort(
            key=lambda s: (
                1 if s.is_confirmed else 0,
                1 if s.is_rac else 0,
                s.recommendation_score,
                -1 * (s.total_fare or 99999),
            ),
            reverse=True,
        )

        return self._build_result(
            query=query,
            schedule=schedule,
            journey_duration_hours=journey_duration_hours,
            journey_distance_km=journey_distance_km,
            max_leg_horizon=max_leg_horizon,
            direct_snapshot=direct_snapshot,
            direct_fare=direct_fare,
            solutions=solutions,
            start_time=start_time,
            stations_evaluated=stations_evaluated,
            queries_executed=query_counter,
        )

    async def _evaluate_2leg_candidate(
        self,
        *,
        candidate: ScheduleStop,
        query: SmartRouteQuery,
        schedule: TrainSchedule,
        origin_stop: ScheduleStop,
        dest_stop: ScheduleStop,
        direct_fare: int | None,
        query_segment: SegmentQuerier,
        confirmed_prefixes_leg1: dict[str, tuple[ScheduleStop, SubLeg]],
    ) -> SmartRouteSolution | None:
        """Evaluate 2-leg split O -> s and s -> D with short-circuit pruning."""
        obs1, fare1 = await query_segment(origin_stop, candidate)
        if not obs1 or not obs1.snapshot:
            return None

        status1 = obs1.snapshot.status
        leg1 = self._build_subleg(
            leg_num=1,
            query=query,
            schedule=schedule,
            from_stop=origin_stop,
            to_stop=candidate,
            obs=obs1,
            fare=fare1,
            origin_stop=origin_stop,
        )

        if status1 is AvailabilityStatus.AVAILABLE:
            confirmed_prefixes_leg1[candidate.station_code] = (candidate, leg1)

        # SHORT-CIRCUIT: If Leg 1 is waitlisted or regret, do not evaluate Leg 2
        bad_statuses = {
            AvailabilityStatus.WAITLIST,
            AvailabilityStatus.REGRET,
            AvailabilityStatus.UNKNOWN,
        }
        if status1 in bad_statuses:
            return None

        obs2, fare2 = await query_segment(candidate, dest_stop)
        if not obs2 or not obs2.snapshot:
            return None

        status2 = obs2.snapshot.status
        if status2 in bad_statuses:
            return None

        leg2 = self._build_subleg(
            leg_num=2,
            query=query,
            schedule=schedule,
            from_stop=candidate,
            to_stop=dest_stop,
            obs=obs2,
            fare=fare2,
            origin_stop=origin_stop,
        )

        is_confirmed = (
            status1 is AvailabilityStatus.AVAILABLE and status2 is AvailabilityStatus.AVAILABLE
        )
        is_rac = not is_confirmed and (
            status1 in {AvailabilityStatus.AVAILABLE, AvailabilityStatus.RAC}
            and status2 in {AvailabilityStatus.AVAILABLE, AvailabilityStatus.RAC}
        )

        total_fare = (fare1 + fare2) if (fare1 is not None and fare2 is not None) else None
        surcharge = (
            (total_fare - direct_fare)
            if (total_fare is not None and direct_fare is not None)
            else 0
        )
        surcharge_pct = (
            ((surcharge / direct_fare) * 100.0) if (direct_fare and direct_fare > 0) else 0.0
        )

        score = calculate_recommendation_score(
            is_confirmed=is_confirmed,
            is_rac=is_rac,
            leg_count=2,
            fare_surcharge_pct=surcharge_pct,
        )

        booking_strat = calculate_booking_strategy((leg1, leg2), query.journey_date)

        return SmartRouteSolution(
            solution_id=f"sol-2leg-{candidate.station_code}-{uuid4().hex[:6]}",
            tier=SolutionTier.TIER_1_SAME_TRAIN_SPLIT,
            legs=(leg1, leg2),
            total_fare=total_fare,
            fare_surcharge=max(0, surcharge),
            fare_surcharge_pct=round(max(0.0, surcharge_pct), 1),
            total_duration_minutes=_calculate_duration_minutes(origin_stop, dest_stop),
            boarding_station=None,
            is_confirmed=is_confirmed,
            is_rac=is_rac,
            recommendation_score=score,
            split_stations=(candidate.station_code,),
            booking_strategy=booking_strat,
        )

    async def _evaluate_3leg_candidate(
        self,
        *,
        cand_u: ScheduleStop,
        cand_v: ScheduleStop,
        leg1: SubLeg,
        query: SmartRouteQuery,
        schedule: TrainSchedule,
        origin_stop: ScheduleStop,
        dest_stop: ScheduleStop,
        direct_fare: int | None,
        query_segment: SegmentQuerier,
    ) -> SmartRouteSolution | None:
        """Evaluate 3-leg split: (O -> u confirmed) -> (u -> v) -> (v -> D)."""
        obs2, fare2 = await query_segment(cand_u, cand_v)
        if not obs2 or not obs2.snapshot:
            return None
        if obs2.snapshot.status is not AvailabilityStatus.AVAILABLE:
            return None

        obs3, fare3 = await query_segment(cand_v, dest_stop)
        if not obs3 or not obs3.snapshot:
            return None

        status3 = obs3.snapshot.status
        bad_statuses = {
            AvailabilityStatus.WAITLIST,
            AvailabilityStatus.REGRET,
            AvailabilityStatus.UNKNOWN,
        }
        if status3 in bad_statuses:
            return None

        leg2 = self._build_subleg(
            leg_num=2,
            query=query,
            schedule=schedule,
            from_stop=cand_u,
            to_stop=cand_v,
            obs=obs2,
            fare=fare2,
            origin_stop=origin_stop,
        )
        leg3 = self._build_subleg(
            leg_num=3,
            query=query,
            schedule=schedule,
            from_stop=cand_v,
            to_stop=dest_stop,
            obs=obs3,
            fare=fare3,
            origin_stop=origin_stop,
        )

        is_confirmed = status3 is AvailabilityStatus.AVAILABLE
        is_rac = not is_confirmed and (status3 is AvailabilityStatus.RAC)

        total_fare = (
            (leg1.fare + fare2 + fare3)
            if (leg1.fare is not None and fare2 is not None and fare3 is not None)
            else None
        )
        surcharge = (
            (total_fare - direct_fare)
            if (total_fare is not None and direct_fare is not None)
            else 0
        )
        surcharge_pct = (
            ((surcharge / direct_fare) * 100.0) if (direct_fare and direct_fare > 0) else 0.0
        )

        score = calculate_recommendation_score(
            is_confirmed=is_confirmed,
            is_rac=is_rac,
            leg_count=3,
            fare_surcharge_pct=surcharge_pct,
        )

        duration_min = _calculate_duration_minutes(origin_stop, dest_stop)

        booking_strat = calculate_booking_strategy((leg1, leg2, leg3), query.journey_date)

        return SmartRouteSolution(
            solution_id=f"sol-3leg-{cand_u.station_code}-{cand_v.station_code}-{uuid4().hex[:6]}",
            tier=SolutionTier.TIER_1_SAME_TRAIN_SPLIT,
            legs=(leg1, leg2, leg3),
            total_fare=total_fare,
            fare_surcharge=max(0, surcharge),
            fare_surcharge_pct=round(max(0.0, surcharge_pct), 1),
            total_duration_minutes=duration_min,
            boarding_station=None,
            is_confirmed=is_confirmed,
            is_rac=is_rac,
            recommendation_score=score,
            split_stations=(cand_u.station_code, cand_v.station_code),
            booking_strategy=booking_strat,
        )

    async def _evaluate_4leg_candidate(
        self,
        *,
        cand_u: ScheduleStop,
        cand_v: ScheduleStop,
        cand_w: ScheduleStop,
        leg1: SubLeg,
        query: SmartRouteQuery,
        schedule: TrainSchedule,
        origin_stop: ScheduleStop,
        dest_stop: ScheduleStop,
        direct_fare: int | None,
        query_segment: SegmentQuerier,
    ) -> SmartRouteSolution | None:
        """Evaluate 4-leg split: (O -> u confirmed) -> (u -> v) -> (v -> w) -> (w -> D)."""
        obs2, fare2 = await query_segment(cand_u, cand_v)
        if (
            not obs2
            or not obs2.snapshot
            or obs2.snapshot.status is not AvailabilityStatus.AVAILABLE
        ):
            return None

        obs3, fare3 = await query_segment(cand_v, cand_w)
        if (
            not obs3
            or not obs3.snapshot
            or obs3.snapshot.status is not AvailabilityStatus.AVAILABLE
        ):
            return None

        obs4, fare4 = await query_segment(cand_w, dest_stop)
        if not obs4 or not obs4.snapshot:
            return None

        status4 = obs4.snapshot.status
        bad_statuses = {
            AvailabilityStatus.WAITLIST,
            AvailabilityStatus.REGRET,
            AvailabilityStatus.UNKNOWN,
        }
        if status4 in bad_statuses:
            return None

        leg2 = self._build_subleg(
            leg_num=2,
            query=query,
            schedule=schedule,
            from_stop=cand_u,
            to_stop=cand_v,
            obs=obs2,
            fare=fare2,
            origin_stop=origin_stop,
        )
        leg3 = self._build_subleg(
            leg_num=3,
            query=query,
            schedule=schedule,
            from_stop=cand_v,
            to_stop=cand_w,
            obs=obs3,
            fare=fare3,
            origin_stop=origin_stop,
        )
        leg4 = self._build_subleg(
            leg_num=4,
            query=query,
            schedule=schedule,
            from_stop=cand_w,
            to_stop=dest_stop,
            obs=obs4,
            fare=fare4,
            origin_stop=origin_stop,
        )

        is_confirmed = status4 is AvailabilityStatus.AVAILABLE
        is_rac = not is_confirmed and (status4 is AvailabilityStatus.RAC)

        fares = (leg1.fare, fare2, fare3, fare4)
        total_fare = sum(fares) if all(f is not None for f in fares) else None  # type: ignore[arg-type]
        surcharge = (
            (total_fare - direct_fare)
            if (total_fare is not None and direct_fare is not None)
            else 0
        )
        surcharge_pct = (
            ((surcharge / direct_fare) * 100.0) if (direct_fare and direct_fare > 0) else 0.0
        )

        score = calculate_recommendation_score(
            is_confirmed=is_confirmed,
            is_rac=is_rac,
            leg_count=4,
            fare_surcharge_pct=surcharge_pct,
        )

        duration_min = _calculate_duration_minutes(origin_stop, dest_stop)

        booking_strat = calculate_booking_strategy((leg1, leg2, leg3, leg4), query.journey_date)

        return SmartRouteSolution(
            solution_id=(
                f"sol-4leg-{cand_u.station_code}-{cand_v.station_code}-"
                f"{cand_w.station_code}-{uuid4().hex[:6]}"
            ),
            tier=SolutionTier.TIER_1_SAME_TRAIN_SPLIT,
            legs=(leg1, leg2, leg3, leg4),
            total_fare=total_fare,
            fare_surcharge=max(0, surcharge),
            fare_surcharge_pct=round(max(0.0, surcharge_pct), 1),
            total_duration_minutes=duration_min,
            boarding_station=None,
            is_confirmed=is_confirmed,
            is_rac=is_rac,
            recommendation_score=score,
            split_stations=(cand_u.station_code, cand_v.station_code, cand_w.station_code),
            booking_strategy=booking_strat,
        )

    async def _evaluate_origin_extension(
        self,
        *,
        query: SmartRouteQuery,
        schedule: TrainSchedule,
        origin_stop: ScheduleStop,
        dest_stop: ScheduleStop,
        direct_fare: int | None,
        direct_snapshot: AvailabilitySnapshot | None,
        query_segment: SegmentQuerier,
    ) -> SmartRouteSolution | None:
        """Evaluate Tier 2 Origin Extension."""
        train_origin_stop = schedule.stops[0]
        ext_obs, ext_fare = await query_segment(train_origin_stop, dest_stop)
        if not ext_obs or not ext_obs.snapshot:
            return None

        ext_status = ext_obs.snapshot.status
        bad_statuses = {
            AvailabilityStatus.WAITLIST,
            AvailabilityStatus.REGRET,
            AvailabilityStatus.UNKNOWN,
        }
        if ext_status in bad_statuses:
            return None

        # Check surcharge guardrails: max <= 100 extra in SL, or <= 20% surcharge
        surcharge = (
            (ext_fare - direct_fare) if (ext_fare is not None and direct_fare is not None) else 0
        )
        surcharge_pct = (
            ((surcharge / direct_fare) * 100.0) if (direct_fare and direct_fare > 0) else 0.0
        )

        if query.travel_class == "SL" and surcharge > 100:
            return None
        if surcharge_pct > 20.0:
            return None

        is_confirmed = ext_status is AvailabilityStatus.AVAILABLE
        is_rac = ext_status is AvailabilityStatus.RAC

        # Only recommend if it improves on direct status
        if direct_snapshot:
            if direct_snapshot.status is AvailabilityStatus.AVAILABLE:
                return None
            if (
                direct_snapshot.status is AvailabilityStatus.RAC
                and not is_confirmed
                and ext_obs.snapshot.position is not None
                and direct_snapshot.position is not None
                and ext_obs.snapshot.position >= direct_snapshot.position
            ):
                return None

        score = calculate_recommendation_score(
            is_confirmed=is_confirmed,
            is_rac=is_rac,
            leg_count=1,
            fare_surcharge_pct=surcharge_pct,
        )

        ext_leg = self._build_subleg(
            leg_num=1,
            query=query,
            schedule=schedule,
            from_stop=train_origin_stop,
            to_stop=dest_stop,
            obs=ext_obs,
            fare=ext_fare,
            origin_stop=origin_stop,
        )

        booking_strat = calculate_booking_strategy((ext_leg,), query.journey_date)

        return SmartRouteSolution(
            solution_id=f"sol-orig-ext-{train_origin_stop.station_code}-{uuid4().hex[:6]}",
            tier=SolutionTier.TIER_2_ORIGIN_EXTENSION,
            legs=(ext_leg,),
            total_fare=ext_fare,
            fare_surcharge=max(0, surcharge),
            fare_surcharge_pct=round(max(0.0, surcharge_pct), 1),
            total_duration_minutes=_calculate_duration_minutes(origin_stop, dest_stop),
            boarding_station=query.origin,
            is_confirmed=is_confirmed,
            is_rac=is_rac,
            recommendation_score=score,
            split_stations=(),
            booking_strategy=booking_strat,
        )

    def _build_subleg(
        self,
        *,
        leg_num: int,
        query: SmartRouteQuery,
        schedule: TrainSchedule,
        from_stop: ScheduleStop,
        to_stop: ScheduleStop,
        obs: AvailabilityObservation,
        fare: int | None,
        origin_stop: ScheduleStop,
    ) -> SubLeg:
        """Construct a strongly-typed SubLeg from schedule stops and observation."""
        snapshot = obs.snapshot
        status = snapshot.status if snapshot else AvailabilityStatus.UNKNOWN
        raw_status = snapshot.raw_availability if snapshot else "UNKNOWN"
        position = snapshot.position if snapshot else None

        duration_min = _calculate_duration_minutes(from_stop, to_stop)
        distance_km = max(0, to_stop.distance_km - from_stop.distance_km)
        leg_date = _calculate_leg_journey_date(query.journey_date, origin_stop, from_stop)

        return SubLeg(
            leg_number=leg_num,
            train_no=query.train_no,
            train_name=schedule.train_name,
            from_station=from_stop.station_code,
            to_station=to_stop.station_code,
            travel_class=query.travel_class,
            quota=query.quota,
            status=status,
            raw_status=raw_status,
            position=position,
            fare=fare,
            departure_time=from_stop.departure_time,
            arrival_time=to_stop.arrival_time,
            duration_minutes=duration_min,
            distance_km=distance_km,
            journey_date=leg_date,
        )

    def _empty_result(
        self,
        query: SmartRouteQuery,
        start_time: float,
        schedule: TrainSchedule | None = None,
    ) -> SmartRouteResult:
        elapsed = (time.monotonic() - start_time) * 1000.0
        return SmartRouteResult(
            train_no=query.train_no,
            train_name=schedule.train_name if schedule else "",
            origin=query.origin,
            destination=query.destination,
            journey_date=query.journey_date,
            travel_class=query.travel_class,
            journey_duration_hours=0.0,
            journey_distance_km=0,
            max_leg_horizon=2,
            direct_status=None,
            direct_fare=None,
            solutions=(),
            execution_time_ms=round(elapsed, 2),
            stations_evaluated_count=0,
            queries_executed_count=0,
        )

    def _build_result(
        self,
        *,
        query: SmartRouteQuery,
        schedule: TrainSchedule,
        journey_duration_hours: float,
        journey_distance_km: int,
        max_leg_horizon: int,
        direct_snapshot: AvailabilitySnapshot | None,
        direct_fare: int | None,
        solutions: list[SmartRouteSolution],
        start_time: float,
        stations_evaluated: int,
        queries_executed: int,
    ) -> SmartRouteResult:
        elapsed = (time.monotonic() - start_time) * 1000.0
        return SmartRouteResult(
            train_no=query.train_no,
            train_name=schedule.train_name,
            origin=query.origin,
            destination=query.destination,
            journey_date=query.journey_date,
            travel_class=query.travel_class,
            journey_duration_hours=round(journey_duration_hours, 2),
            journey_distance_km=journey_distance_km,
            max_leg_horizon=max_leg_horizon,
            direct_status=direct_snapshot,
            direct_fare=direct_fare,
            solutions=tuple(solutions),
            execution_time_ms=round(elapsed, 2),
            stations_evaluated_count=stations_evaluated,
            queries_executed_count=queries_executed,
        )
