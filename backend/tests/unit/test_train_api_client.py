"""Offline tests for the typed Dream Destiny train-service adapter."""

from __future__ import annotations

import json
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

import httpx
import pytest

from trainwatch.domain.availability import AvailabilityStatus, ProviderFailure
from trainwatch.domain.watch import TrainQuery
from trainwatch.infrastructure.train_api import (
    DreamDestinyClient,
    TrainApiError,
    TrainApiFailure,
    create_train_api_http_client,
)
from trainwatch.ports.availability import AvailabilityProvider
from trainwatch.ports.train_search import TrainSearchProvider, TrainSearchQuery

FIXTURES = Path(__file__).parents[1] / "fixtures" / "train_api"
OBSERVED_AT = datetime(2026, 10, 24, 9, 0, tzinfo=UTC)


def fixture(name: str) -> Any:
    """Load one sanitized contract fixture."""
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def http_client(handler: httpx.MockTransport) -> httpx.AsyncClient:
    """Create a socket-free HTTP client around a mock transport."""
    return httpx.AsyncClient(transport=handler, base_url="https://provider.example.test")


def availability_query() -> TrainQuery:
    """Build a canonical query that preserves a leading-zero train number."""
    return TrainQuery(
        train_number="06030",
        source="RJPM",
        destination="CBE",
        journey_date=date(2026, 10, 25),
        travel_class="SL",
        quota="GN",
    )


@pytest.mark.anyio
@pytest.mark.parametrize("scheme", ["https", "http"])
async def test_http_client_factory_is_bounded_and_normalizes_base_url(scheme: str) -> None:
    """Construct an HTTP client without sending a request."""
    client = create_train_api_http_client(base_url=f" {scheme}://provider.example.test/ ")
    try:
        assert str(client.base_url) == f"{scheme}://provider.example.test"
        assert client.follow_redirects is False
    finally:
        await client.aclose()


def test_http_client_factory_rejects_non_http_url() -> None:
    """Reject unusable endpoint configuration before network access."""
    with pytest.raises(ValueError, match="HTTP"):
        create_train_api_http_client(base_url="provider.example.test")


@pytest.mark.parametrize("scheme", ["https", "http"])
@pytest.mark.parametrize("userinfo", ["user:synthetic", "user", ":synthetic", "", "u%40ser:p%40ss"])
def test_http_client_factory_rejects_url_credentials(scheme: str, userinfo: str) -> None:
    """Reject URL userinfo without including it in the public error."""
    with pytest.raises(ValueError) as captured:
        create_train_api_http_client(base_url=f" {scheme}://{userinfo}@provider.example.test/ ")
    assert str(captured.value) == "TRAIN_API_BASE_URL must not contain credentials"


@pytest.mark.parametrize(
    "overrides",
    [
        {"source": " "},
        {"destination": "rajapalayam", "source": "Rajapalayam"},
        {"travel_class": "invalid"},
        {"quota": "invalid"},
        {"sort_by": "rating"},
    ],
)
def test_train_search_query_rejects_invalid_values(overrides: dict[str, object]) -> None:
    """Validate search parameters before calling the provider."""
    values: dict[str, object] = {
        "source": "Rajapalayam",
        "destination": "Chennai",
        "journey_date": date(2026, 10, 25),
        "travel_class": "3a",
        "quota": "gn",
        "sort_by": "fare",
    }
    values.update(overrides)
    with pytest.raises(ValueError):
        TrainSearchQuery(**values)  # type: ignore[arg-type]


@pytest.mark.anyio
async def test_station_search_maps_fields_and_safe_correlation_id() -> None:
    """Map station suggestions and forward only a safe opaque request ID."""
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=fixture("station_search_response.json"))

    async with http_client(httpx.MockTransport(handler)) as http:
        provider: TrainSearchProvider = DreamDestinyClient(http)
        stations = await provider.search_stations(" RJPM ")

    assert stations[0].code == "RJPM"
    assert stations[0].name == "Rajapalayam"
    assert stations[0].latitude == 0.0
    assert seen[0].url.params["q"] == "RJPM"

    async with http_client(httpx.MockTransport(handler)) as http:
        client = DreamDestinyClient(http)
        await client.search_stations("RJPM", request_id="request-123")
        await client.search_stations("RJPM", request_id="unsafe request id")
    assert seen[-2].headers["X-Correlation-ID"] == "request-123"
    assert "X-Correlation-ID" not in seen[-1].headers


@pytest.mark.anyio
async def test_station_search_handles_empty_and_partial_results() -> None:
    """Allow empty results and retain no invented coordinates."""
    responses = [
        {"success": True, "data": []},
        {
            "success": True,
            "data": [
                {
                    "station_name": "Example",
                    "station_code": "EX",
                    "latitude": True,
                    "longitude": "missing",
                }
            ],
        },
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        del request
        return httpx.Response(200, json=responses.pop(0))

    async with http_client(httpx.MockTransport(handler)) as http:
        client = DreamDestinyClient(http)
        assert await client.search_stations("none") == ()
        partial = await client.search_stations("example")
    assert partial[0].latitude is None
    assert partial[0].longitude is None


@pytest.mark.anyio
async def test_station_search_rejects_blank_query() -> None:
    """Avoid a broad upstream search for blank user input."""
    async with http_client(httpx.MockTransport(lambda request: httpx.Response(500))) as http:
        with pytest.raises(ValueError, match="must not be blank"):
            await DreamDestinyClient(http).search_stations(" ")


@pytest.mark.anyio
async def test_train_search_maps_verified_query_and_response() -> None:
    """Use exact provider parameters and expose stable app-facing fields."""
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=fixture("train_search_response.json"))

    query = TrainSearchQuery(
        source=" Rajapalayam ",
        destination="Chennai",
        journey_date=date(2026, 10, 25),
        travel_class="3a",
        quota="gn",
    )
    async with http_client(httpx.MockTransport(handler)) as http:
        result = await DreamDestinyClient(http).search_trains(query)

    assert dict(seen[0].url.params) == {
        "from": "Rajapalayam",
        "to": "Chennai",
        "date": "25-10-2026",
        "sortBy": "fare",
        "quota": "GN",
        "travelClass": "3A",
    }
    assert result.trains[0].number == "06030"
    assert result.trains[0].source.code == "RJPM"
    assert result.trains[0].classes[0].availability == "WL 61"


@pytest.mark.anyio
async def test_train_search_preserves_missing_optional_fields() -> None:
    """Use None rather than invented values when optional fields are absent or malformed."""
    payload = fixture("train_search_response.json")
    train = payload["data"]["trains"][0]
    train["departure_time"] = None
    train["arrival_time"] = ""
    train.pop("duration")
    travel_class = train["classes"][0]
    travel_class.update(
        fare=True,
        availability=None,
        bookable="yes",
        availability_source="",
    )

    async with http_client(
        httpx.MockTransport(lambda request: httpx.Response(200, json=payload))
    ) as http:
        result = await DreamDestinyClient(http).search_trains(
            TrainSearchQuery(source="RJPM", destination="CBE", journey_date=date(2026, 10, 25))
        )
    summary = result.trains[0]
    assert (summary.departure_time, summary.arrival_time, summary.duration) == (None, None, None)
    assert summary.classes[0].fare is None
    assert summary.classes[0].availability is None
    assert summary.classes[0].bookable is None
    assert summary.classes[0].source is None


@pytest.mark.anyio
async def test_train_search_omits_optional_travel_class_parameter() -> None:
    """Do not send an empty class parameter when no filter was selected."""
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        payload = fixture("train_search_response.json")
        payload["data"]["trains"] = []
        return httpx.Response(200, json=payload)

    async with http_client(httpx.MockTransport(handler)) as http:
        await DreamDestinyClient(http).search_trains(
            TrainSearchQuery(source="RJPM", destination="CBE", journey_date=date(2026, 10, 25))
        )
    assert "travelClass" not in seen[0].url.params


@pytest.mark.anyio
@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(200, content=b"not-json"),
        httpx.Response(200, json={"success": False, "data": []}),
        httpx.Response(200, json={"success": True, "data": {}}),
        httpx.Response(200, json={"success": True, "data": ["not-an-object"]}),
        httpx.Response(
            200,
            json={
                "success": True,
                "data": [{"station_name": "", "station_code": "XX"}],
            },
        ),
    ],
)
async def test_malformed_station_responses_are_sanitized(response: httpx.Response) -> None:
    """Reject malformed provider data without returning its contents."""
    async with http_client(httpx.MockTransport(lambda request: response)) as http:
        with pytest.raises(TrainApiError) as captured:
            await DreamDestinyClient(http).search_stations("test")
    assert captured.value.failure is TrainApiFailure.MALFORMED_RESPONSE
    assert "not-an-object" not in str(captured.value)


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("status", "expected"),
    [
        (400, TrainApiFailure.INVALID_REQUEST),
        (404, TrainApiFailure.NOT_FOUND),
        (401, TrainApiFailure.UPSTREAM),
        (500, TrainApiFailure.UPSTREAM),
    ],
)
async def test_non_retryable_http_errors_are_mapped(status: int, expected: TrainApiFailure) -> None:
    """Map provider errors without parsing or exposing their bodies."""
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(status, json={"detail": "sensitive provider detail"})

    async with http_client(httpx.MockTransport(handler)) as http:
        with pytest.raises(TrainApiError) as captured:
            await DreamDestinyClient(http).search_stations("test")
    assert captured.value.failure is expected
    assert calls == 1
    assert "sensitive" not in str(captured.value)


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("status", "expected"),
    [
        (429, TrainApiFailure.THROTTLED),
        (502, TrainApiFailure.UPSTREAM),
        (503, TrainApiFailure.UPSTREAM),
        (504, TrainApiFailure.TIMEOUT),
    ],
)
async def test_transient_statuses_retry_with_bounded_backoff(
    status: int, expected: TrainApiFailure
) -> None:
    """Retry only the documented transient status family and then stop."""
    calls = 0
    delays: list[float] = []

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(status)

    async def sleep(delay: float) -> None:
        delays.append(delay)

    async with http_client(httpx.MockTransport(handler)) as http:
        with pytest.raises(TrainApiError) as captured:
            await DreamDestinyClient(
                http, max_attempts=3, backoff_seconds=0.5, sleep=sleep, jitter=lambda: 0.0
            ).search_stations("test")
    assert captured.value.failure is expected
    assert calls == 3
    assert delays == [0.5, 1.0]


@pytest.mark.anyio
async def test_retry_can_recover_without_extra_attempts() -> None:
    """Return immediately after a transient failure is followed by success."""
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        if calls == 1:
            return httpx.Response(503)
        return httpx.Response(200, json={"success": True, "data": []})

    async with http_client(httpx.MockTransport(handler)) as http:
        result = await DreamDestinyClient(http, sleep=lambda delay: _no_sleep()).search_stations(
            "test"
        )
    assert result == ()
    assert calls == 2


async def _no_sleep() -> None:
    """Provide an awaitable no-op for retry tests."""


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("exception", "expected"),
    [
        (httpx.ReadTimeout("timeout"), TrainApiFailure.TIMEOUT),
        (httpx.ConnectError("offline"), TrainApiFailure.TRANSPORT),
        (httpx.DecodingError("sensitive provider detail"), TrainApiFailure.TRANSPORT),
        (httpx.TooManyRedirects("sensitive provider detail"), TrainApiFailure.TRANSPORT),
    ],
)
async def test_transport_failures_are_bounded(
    exception: httpx.RequestError, expected: TrainApiFailure
) -> None:
    """Retry transport failures without leaking exception messages."""

    calls = 0
    delays: list[float] = []

    async def sleep(delay: float) -> None:
        delays.append(delay)

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        exception.request = request
        raise exception

    async with http_client(httpx.MockTransport(handler)) as http:
        with pytest.raises(TrainApiError) as captured:
            await DreamDestinyClient(
                http, max_attempts=3, sleep=sleep, jitter=lambda: 0.0
            ).search_stations("test")
    assert captured.value.failure is expected
    assert str(captured.value) == expected.value
    assert calls == 3
    assert delays == [0.1, 0.2]


@pytest.mark.anyio
async def test_retry_configuration_is_validated() -> None:
    """Reject retry settings that cannot make a bounded request."""
    transport = httpx.MockTransport(lambda request: httpx.Response(200))
    http = http_client(transport)
    with pytest.raises(ValueError, match="retry configuration"):
        DreamDestinyClient(http, max_attempts=0)
    with pytest.raises(ValueError, match="retry configuration"):
        DreamDestinyClient(http, backoff_seconds=-1)
    await http.aclose()


@pytest.mark.anyio
async def test_availability_maps_request_and_successful_snapshot() -> None:
    """Use the verified JSON contract and Phase 2 normalization."""
    seen: list[httpx.Request] = []
    payload = fixture("availability_responses.json")[1]["response"]

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=payload)

    async with http_client(httpx.MockTransport(handler)) as http:
        provider: AvailabilityProvider = DreamDestinyClient(http, clock=lambda: OBSERVED_AT)
        observation = await provider.fetch(availability_query())

    assert json.loads(seen[0].content) == {
        "trainNo": "06030",
        "source": "RJPM",
        "destination": "CBE",
        "travelClass": "SL",
        "date": "25-10-2026",
        "quota": "GN",
    }
    assert observation.snapshot is not None
    assert observation.snapshot.status is AvailabilityStatus.RAC
    assert observation.snapshot.position == 12
    assert observation.snapshot.observed_at == OBSERVED_AT


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("response", "expected"),
    [
        (httpx.Response(504), ProviderFailure.TIMEOUT),
        (httpx.Response(429), ProviderFailure.THROTTLED),
        (httpx.Response(503), ProviderFailure.UPSTREAM),
        (httpx.Response(400), ProviderFailure.OTHER),
        (httpx.Response(404), ProviderFailure.OTHER),
        (
            httpx.Response(200, json={"success": True, "data": {}}),
            ProviderFailure.MALFORMED_RESPONSE,
        ),
        (
            httpx.Response(
                200,
                json={
                    "success": True,
                    "data": {"booking_status": "AVAILABLE", "availability": 4},
                },
            ),
            ProviderFailure.MALFORMED_RESPONSE,
        ),
    ],
)
async def test_availability_failures_never_become_snapshots(
    response: httpx.Response, expected: ProviderFailure
) -> None:
    """Convert every provider failure to a non-alerting observation."""
    async with http_client(httpx.MockTransport(lambda request: response)) as http:
        observation = await DreamDestinyClient(http, max_attempts=1).fetch(availability_query())
    assert observation.snapshot is None
    assert observation.failure is expected


@pytest.mark.anyio
@pytest.mark.parametrize(
    "error_type", [httpx.ConnectError, httpx.DecodingError, httpx.TooManyRedirects]
)
async def test_availability_transport_failure_maps_to_upstream(
    error_type: type[httpx.RequestError],
) -> None:
    """Hide connection exceptions behind the domain failure category."""

    def handler(request: httpx.Request) -> httpx.Response:
        raise error_type("sensitive provider detail", request=request)

    async with http_client(httpx.MockTransport(handler)) as http:
        observation = await DreamDestinyClient(http, max_attempts=1).fetch(availability_query())
    assert observation.failure is ProviderFailure.UPSTREAM
    assert observation.snapshot is None


@pytest.mark.anyio
async def test_corrupt_encoded_availability_response_fails_closed() -> None:
    """Handle an actual HTTPX decoding failure before response mapping."""
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(
            200,
            headers={"Content-Encoding": "gzip"},
            stream=httpx.ByteStream(b"invalid gzip provider body"),
        )

    async with http_client(httpx.MockTransport(handler)) as http:
        observation = await DreamDestinyClient(
            http, max_attempts=2, sleep=lambda delay: _no_sleep()
        ).fetch(availability_query())
    assert calls == 2
    assert observation.failure is ProviderFailure.UPSTREAM
    assert observation.snapshot is None


@pytest.mark.anyio
async def test_unknown_availability_remains_non_comparable() -> None:
    """Preserve a verified UNKNOWN response without inventing availability."""
    payload = fixture("availability_responses.json")[-1]["response"]
    async with http_client(
        httpx.MockTransport(lambda request: httpx.Response(200, json=payload))
    ) as http:
        observation = await DreamDestinyClient(http, clock=lambda: OBSERVED_AT).fetch(
            availability_query()
        )
    assert observation.snapshot is not None
    assert observation.snapshot.status is AvailabilityStatus.UNKNOWN
    assert observation.snapshot.is_comparable is False
