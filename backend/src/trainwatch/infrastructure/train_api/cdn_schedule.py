"""Cloudflare CDN schedule client with in-memory caching and fallback."""

from __future__ import annotations

import logging
import re
import time
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

import httpx

_LOGGER = logging.getLogger(__name__)
_TRAIN_NO_PATTERN = re.compile(r"^\d{4,5}$")
_CACHE_TTL_SECONDS = 86400.0  # 24 hours


class TrainScheduleError(RuntimeError):
    """Raised when train schedule cannot be retrieved from CDN or fallback."""


@dataclass(frozen=True, slots=True)
class ScheduleStop:
    """A single stop along a train's scheduled route."""

    stop_number: int
    station_name: str
    station_code: str
    arrival_time: str
    departure_time: str
    halt_minutes: int
    day: int
    distance_km: int
    platform: str | None = None


@dataclass(frozen=True, slots=True)
class TrainSchedule:
    """Full timetable route schedule for a train."""

    train_no: str
    train_name: str
    source_station_name: str
    source_station_code: str
    destination_station_name: str
    destination_station_code: str
    days_of_run: tuple[str, ...]
    classes: tuple[str, ...]
    total_duration_minutes: int
    total_distance_km: int
    total_stops: int
    stops: tuple[ScheduleStop, ...]

    def get_stop(self, station_code: str) -> ScheduleStop | None:
        """Find a stop by station code."""
        code = station_code.strip().upper()
        for stop in self.stops:
            if stop.station_code == code:
                return stop
        return None

    def get_subroute(self, from_station: str, to_station: str) -> tuple[ScheduleStop, ...]:
        """Extract slice of stops between from_station and to_station inclusive.

        Raises ValueError if either station is missing or to_station precedes from_station.
        """
        from_code = from_station.strip().upper()
        to_code = to_station.strip().upper()

        start_idx = -1
        end_idx = -1
        for idx, stop in enumerate(self.stops):
            if stop.station_code == from_code:
                start_idx = idx
            if stop.station_code == to_code:
                end_idx = idx

        if start_idx == -1:
            raise ValueError(f"from_station '{from_code}' not found in schedule")
        if end_idx == -1:
            raise ValueError(f"to_station '{to_code}' not found in schedule")
        if start_idx >= end_idx:
            raise ValueError(
                f"to_station '{to_code}' appears before or at from_station '{from_code}'"
            )

        return self.stops[start_idx : end_idx + 1]


def _safe_str(val: Any, default: str = "") -> str:
    return str(val).strip() if val is not None else default


def _safe_int(val: Any, default: int = 0) -> int:
    try:
        return int(val) if val is not None else default
    except (ValueError, TypeError):
        return default


def _parse_schedule_payload(data: Mapping[str, Any]) -> TrainSchedule:
    raw_schedule = data.get("schedule")
    if not isinstance(raw_schedule, list):
        raise TrainScheduleError("Malformed schedule payload: missing schedule list")

    stops: list[ScheduleStop] = []
    for item in raw_schedule:
        if not isinstance(item, dict):
            continue
        stops.append(
            ScheduleStop(
                stop_number=_safe_int(item.get("stop_number")),
                station_name=_safe_str(item.get("station_name")),
                station_code=_safe_str(item.get("station_code")).upper(),
                arrival_time=_safe_str(item.get("arrival_time")),
                departure_time=_safe_str(item.get("departure_time")),
                halt_minutes=_safe_int(item.get("halt_minutes")),
                day=_safe_int(item.get("day"), default=1),
                distance_km=_safe_int(item.get("distance_from_origin_km")),
                platform=_safe_str(item.get("expected_platform")) or None,
            )
        )

    days = data.get("days_of_run")
    days_of_run = (
        tuple(str(d).strip().upper() for d in days if isinstance(d, str))
        if isinstance(days, list)
        else ()
    )

    classes_raw = data.get("classes")
    classes = (
        tuple(str(c).strip().upper() for c in classes_raw if isinstance(c, str))
        if isinstance(classes_raw, list)
        else ()
    )

    return TrainSchedule(
        train_no=_safe_str(data.get("train_no")),
        train_name=_safe_str(data.get("train_name")),
        source_station_name=_safe_str(data.get("source_station_name")),
        source_station_code=_safe_str(data.get("source_station_code")).upper(),
        destination_station_name=_safe_str(data.get("destination_station_name")),
        destination_station_code=_safe_str(data.get("destination_station_code")).upper(),
        days_of_run=days_of_run,
        classes=classes,
        total_duration_minutes=_safe_int(data.get("total_duration_minutes")),
        total_distance_km=_safe_int(data.get("total_distance_km")),
        total_stops=_safe_int(data.get("total_stops"), default=len(stops)),
        stops=tuple(stops),
    )


class CdnScheduleClient:
    """Client for fetching train schedules from CDN with in-memory caching and fallback."""

    def __init__(
        self,
        cdn_base_url: str = "https://trains.jashh.me",
        *,
        fallback_base_url: str | None = None,
        http_client: httpx.AsyncClient | None = None,
        timeout_seconds: float = 8.0,
    ) -> None:
        norm_cdn = cdn_base_url.strip().rstrip("/")
        if not norm_cdn.startswith(("https://", "http://")):
            raise ValueError("cdn_base_url must be an HTTP(S) URL")
        parsed = urlsplit(norm_cdn)
        if parsed.username or parsed.password:
            raise ValueError("cdn_base_url must not contain credentials")

        self._cdn_base_url = norm_cdn
        fallback = fallback_base_url.strip().rstrip("/") if fallback_base_url else None
        self._fallback_base_url = fallback
        self._timeout = timeout_seconds
        self._external_http = http_client
        self._owned_http: httpx.AsyncClient | None = None
        self._cache: dict[str, tuple[float, TrainSchedule]] = {}

    async def _get_http(self) -> httpx.AsyncClient:
        if self._external_http is not None:
            return self._external_http
        if self._owned_http is None or self._owned_http.is_closed:
            self._owned_http = httpx.AsyncClient(
                timeout=httpx.Timeout(self._timeout, connect=3.0),
                limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
                follow_redirects=True,
            )
        return self._owned_http

    async def close(self) -> None:
        """Close internally owned HTTP client."""
        if self._owned_http is not None and not self._owned_http.is_closed:
            await self._owned_http.aclose()
            self._owned_http = None

    async def get_schedule(self, train_no: str) -> TrainSchedule:
        """Fetch train schedule from CDN cache, falling back to upstream if CDN fails."""
        clean_train_no = train_no.strip()
        if not _TRAIN_NO_PATTERN.fullmatch(clean_train_no):
            raise ValueError(f"Invalid train number '{clean_train_no}'")

        now = time.monotonic()
        if clean_train_no in self._cache:
            cached_time, schedule = self._cache[clean_train_no]
            if now - cached_time < _CACHE_TTL_SECONDS:
                return schedule

        client = await self._get_http()
        cdn_url = f"{self._cdn_base_url}/api/v1/trains/{clean_train_no}/schedule"

        try:
            resp = await client.get(cdn_url)
            if resp.status_code == 200:
                payload = resp.json()
                if payload.get("success") is True and isinstance(payload.get("data"), dict):
                    schedule = _parse_schedule_payload(payload["data"])
                    self._cache[clean_train_no] = (now, schedule)
                    return schedule
            _LOGGER.warning(
                "CDN schedule request failed for train %s with status %s",
                clean_train_no,
                resp.status_code,
            )
        except Exception as exc:
            _LOGGER.warning(
                "CDN schedule request error for train %s: %s. Attempting fallback.",
                clean_train_no,
                exc,
            )

        # Fallback to upstream if configured
        if self._fallback_base_url:
            fallback_url = f"{self._fallback_base_url}/api/v1/trains/{clean_train_no}/schedule"
            try:
                resp = await client.get(fallback_url)
                if resp.status_code == 200:
                    payload = resp.json()
                    if payload.get("success") is True and isinstance(payload.get("data"), dict):
                        schedule = _parse_schedule_payload(payload["data"])
                        self._cache[clean_train_no] = (now, schedule)
                        return schedule
                _LOGGER.warning(
                    "Fallback schedule request failed for train %s with status %s",
                    clean_train_no,
                    resp.status_code,
                )
            except Exception as exc:
                _LOGGER.error(
                    "Fallback schedule request error for train %s: %s",
                    clean_train_no,
                    exc,
                )

        raise TrainScheduleError(f"Could not retrieve schedule for train {clean_train_no}")
