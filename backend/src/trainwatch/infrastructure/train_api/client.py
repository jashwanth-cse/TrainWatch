"""Typed, bounded client for the existing Dream Destiny train service."""

from __future__ import annotations

import asyncio
import re
from collections.abc import Awaitable, Callable, Mapping, Sequence
from datetime import UTC, datetime
from enum import StrEnum
from random import random
from typing import Any

import httpx

from trainwatch.domain.availability import (
    AvailabilityObservation,
    ProviderFailure,
    parse_availability,
)
from trainwatch.domain.watch import TrainQuery
from trainwatch.ports.train_search import (
    ClassAvailability,
    StationRef,
    StationSuggestion,
    TrainSearchQuery,
    TrainSearchResult,
    TrainSummary,
)

_TRANSIENT_STATUSES = frozenset({429, 502, 503, 504})
_CORRELATION_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,63}")


class TrainApiFailure(StrEnum):
    """Sanitized external-service failure categories."""

    INVALID_REQUEST = "invalid_request"
    NOT_FOUND = "not_found"
    THROTTLED = "throttled"
    TIMEOUT = "timeout"
    TRANSPORT = "transport"
    UPSTREAM = "upstream"
    MALFORMED_RESPONSE = "malformed_response"


class TrainApiError(RuntimeError):
    """External-service failure without response bodies or request values."""

    def __init__(self, failure: TrainApiFailure) -> None:
        super().__init__(failure.value)
        self.failure = failure


Sleep = Callable[[float], Awaitable[None]]
Clock = Callable[[], datetime]
Jitter = Callable[[], float]


def create_train_api_http_client(*, base_url: str) -> httpx.AsyncClient:
    """Create a bounded HTTP client without making a request."""
    normalized = base_url.strip().rstrip("/")
    if not normalized.startswith(("https://", "http://")):
        raise ValueError("TRAIN_API_BASE_URL must be an HTTP(S) URL")
    return httpx.AsyncClient(
        base_url=normalized,
        timeout=httpx.Timeout(10.0, connect=3.0),
        limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
        follow_redirects=False,
    )


def _mapping(value: object) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise TrainApiError(TrainApiFailure.MALFORMED_RESPONSE)
    return value


def _sequence(value: object) -> Sequence[Any]:
    if not isinstance(value, list):
        raise TrainApiError(TrainApiFailure.MALFORMED_RESPONSE)
    return value


def _required_text(value: object) -> str:
    if not isinstance(value, str) or not value.strip():
        raise TrainApiError(TrainApiFailure.MALFORMED_RESPONSE)
    return value.strip()


def _string(value: object) -> str:
    if not isinstance(value, str):
        raise TrainApiError(TrainApiFailure.MALFORMED_RESPONSE)
    return value


def _optional_text(value: object) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _optional_int(value: object) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _optional_float(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return float(value)


def _optional_bool(value: object) -> bool | None:
    return value if isinstance(value, bool) else None


def _envelope(response: httpx.Response) -> Any:
    try:
        envelope = _mapping(response.json())
    except (ValueError, UnicodeDecodeError) as exc:
        raise TrainApiError(TrainApiFailure.MALFORMED_RESPONSE) from exc
    if envelope.get("success") is not True:
        raise TrainApiError(TrainApiFailure.MALFORMED_RESPONSE)
    return envelope.get("data")


def _failure_for_status(status_code: int) -> TrainApiFailure:
    if status_code == 400:
        return TrainApiFailure.INVALID_REQUEST
    if status_code == 404:
        return TrainApiFailure.NOT_FOUND
    if status_code == 429:
        return TrainApiFailure.THROTTLED
    if status_code == 504:
        return TrainApiFailure.TIMEOUT
    return TrainApiFailure.UPSTREAM


class DreamDestinyClient:
    """Call the provider through an injected async HTTP transport."""

    def __init__(
        self,
        http: httpx.AsyncClient,
        *,
        max_attempts: int = 3,
        backoff_seconds: float = 0.1,
        sleep: Sleep = asyncio.sleep,
        jitter: Jitter = random,
        clock: Clock = lambda: datetime.now(UTC),
    ) -> None:
        if max_attempts < 1 or backoff_seconds < 0:
            raise ValueError(
                "retry configuration must be non-negative and have at least one attempt"
            )
        self._http = http
        self._max_attempts = max_attempts
        self._backoff_seconds = backoff_seconds
        self._sleep = sleep
        self._jitter = jitter
        self._clock = clock

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: Mapping[str, str] | None = None,
        json: Mapping[str, str] | None = None,
        request_id: str | None = None,
    ) -> httpx.Response:
        headers = {}
        if request_id is not None and _CORRELATION_ID.fullmatch(request_id):
            headers["X-Correlation-ID"] = request_id
        for attempt in range(self._max_attempts):
            try:
                response = await self._http.request(
                    method, path, params=params, json=json, headers=headers
                )
            except httpx.TimeoutException as exc:
                failure = TrainApiFailure.TIMEOUT
                last_error: Exception = exc
            except httpx.TransportError as exc:
                failure = TrainApiFailure.TRANSPORT
                last_error = exc
            else:
                if response.status_code < 400:
                    return response
                failure = _failure_for_status(response.status_code)
                last_error = TrainApiError(failure)
                if response.status_code not in _TRANSIENT_STATUSES:
                    raise last_error
            if attempt + 1 < self._max_attempts:
                delay = self._backoff_seconds * (2**attempt) * (1 + self._jitter())
                await self._sleep(delay)
        raise TrainApiError(failure) from last_error

    async def search_stations(
        self, query: str, *, request_id: str | None = None
    ) -> tuple[StationSuggestion, ...]:
        """Return typed station suggestions without provider-only fields."""
        normalized = query.strip()
        if not normalized:
            raise ValueError("station query must not be blank")
        response = await self._request(
            "GET", "/api/v1/stations/search", params={"q": normalized}, request_id=request_id
        )
        data = _sequence(_envelope(response))
        return tuple(
            StationSuggestion(
                name=_required_text(item.get("station_name")),
                code=_required_text(item.get("station_code")),
                latitude=_optional_float(item.get("latitude")),
                longitude=_optional_float(item.get("longitude")),
            )
            for item in (_mapping(value) for value in data)
        )

    async def search_trains(
        self, query: TrainSearchQuery, *, request_id: str | None = None
    ) -> TrainSearchResult:
        """Return typed train results while retaining only app-facing fields."""
        params = {
            "from": query.source,
            "to": query.destination,
            "date": query.journey_date.strftime("%d-%m-%Y"),
            "sortBy": query.sort_by,
            "quota": query.quota,
        }
        if query.travel_class is not None:
            params["travelClass"] = query.travel_class
        response = await self._request(
            "GET", "/api/v1/trains/search", params=params, request_id=request_id
        )
        data = _mapping(_envelope(response))
        trains = tuple(self._train(_mapping(item)) for item in _sequence(data.get("trains")))
        return TrainSearchResult(
            result_type=_required_text(data.get("result_type")),
            source=_required_text(data.get("source")),
            destination=_required_text(data.get("destination")),
            trains=trains,
        )

    def _train(self, item: Mapping[str, Any]) -> TrainSummary:
        source = _mapping(item.get("from"))
        destination = _mapping(item.get("to"))
        running_days = tuple(_required_text(value) for value in _sequence(item.get("running_days")))
        classes = tuple(
            ClassAvailability(
                travel_class=_required_text(value.get("travel_class")),
                fare=_optional_int(value.get("fare")),
                availability=_optional_text(value.get("availability")),
                bookable=_optional_bool(value.get("bookable")),
                source=_optional_text(value.get("availability_source")),
            )
            for value in (_mapping(entry) for entry in _sequence(item.get("classes")))
        )
        return TrainSummary(
            number=_required_text(item.get("train_number")),
            name=_required_text(item.get("train_name")),
            source=StationRef(
                code=_required_text(source.get("code")), name=_required_text(source.get("name"))
            ),
            destination=StationRef(
                code=_required_text(destination.get("code")),
                name=_required_text(destination.get("name")),
            ),
            departure_time=_optional_text(item.get("departure_time")),
            arrival_time=_optional_text(item.get("arrival_time")),
            duration=_optional_text(item.get("duration")),
            running_days=running_days,
            classes=classes,
        )

    async def fetch(self, query: TrainQuery) -> AvailabilityObservation:
        """Fetch one availability observation and fail closed on every error."""
        try:
            response = await self._request(
                "POST",
                "/api/v1/trains/availability",
                json={
                    "trainNo": query.train_number,
                    "source": query.source,
                    "destination": query.destination,
                    "travelClass": query.travel_class,
                    "date": query.journey_date.strftime("%d-%m-%Y"),
                    "quota": query.quota,
                },
            )
            data = _mapping(_envelope(response))
            snapshot = parse_availability(
                booking_status=_required_text(data.get("booking_status")),
                raw_availability=_string(data.get("availability")),
                observed_at=self._clock(),
            )
            return AvailabilityObservation.success(snapshot)
        except TrainApiError as exc:
            failure = {
                TrainApiFailure.TIMEOUT: ProviderFailure.TIMEOUT,
                TrainApiFailure.THROTTLED: ProviderFailure.THROTTLED,
                TrainApiFailure.MALFORMED_RESPONSE: ProviderFailure.MALFORMED_RESPONSE,
                TrainApiFailure.INVALID_REQUEST: ProviderFailure.OTHER,
                TrainApiFailure.NOT_FOUND: ProviderFailure.OTHER,
                TrainApiFailure.TRANSPORT: ProviderFailure.UPSTREAM,
                TrainApiFailure.UPSTREAM: ProviderFailure.UPSTREAM,
            }[exc.failure]
            return AvailabilityObservation.failed(failure)
