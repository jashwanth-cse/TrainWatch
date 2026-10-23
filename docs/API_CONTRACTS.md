# External Train Service Contract

## Purpose and evidence

TrainWatch consumes the existing Dream Destiny train service as an external dependency. It does not reproduce the provider's station resolution, train search, route fallback, or upstream availability implementation.

This contract was derived from:

- read-only inspection of the supplied service source at `E:\Projects\Dream Destiny v2.0\transport-service\train`;
- its route, Pydantic model, service, and test definitions; and
- five bounded, credential-free live requests authorized by the user on 23 October 2026.

The live checks covered health, readiness, station search, train search, and one availability request. They were contract observations, not availability guarantees or load tests. No authentication material was supplied or used.

## Base URL

TrainWatch configuration key: `TRAIN_API_BASE_URL`

Authorized deployment observed during Phase 1: `https://dreamdestiny.cloud.run`

The repository template continues to use `https://example.invalid`. Deployment-specific values belong in the user's environment and must not be hard-coded into application code.

## Correlation IDs

The service accepts `X-Correlation-ID` or `X-Request-ID` and returns `X-Correlation-ID`. TrainWatch may send an opaque request identifier, but it must never contain a user ID, token, train query, or other sensitive value.

## Availability

### Request

`POST /api/v1/trains/availability`

The deployed route supports both query parameters and a JSON body. The Phase 5 TrainWatch adapter should use the JSON form:

```json
{
  "trainNo": "06030",
  "source": "RJPM",
  "destination": "CBE",
  "travelClass": "SL",
  "date": "25-10-2026",
  "quota": "GN"
}
```

| Field | Required | Verified constraints |
| --- | --- | --- |
| `trainNo` | Yes | String containing 4 or 5 digits. Leading zeroes are significant. |
| `source` | Yes | Station code normalized to 2–5 uppercase letters. |
| `destination` | Yes | Same constraints as `source`; must differ from it. |
| `travelClass` | Yes | One of `1A`, `2A`, `3A`, `3E`, `SL`, `CC`, `2S`, `EC`, `EA`, `FC`, `GN`. |
| `date` | Yes | Accepted source formats include `DD-MM-YYYY`, `YYYY-MM-DD`, `DD/MM/YYYY`, and `YYYY/MM/DD`; normalized to `DD-MM-YYYY`. Source code permits yesterday through 125 days ahead even though its validation message says 120 days. |
| `quota` | No | Defaults to `GN`; accepted values are `GN`, `TQ`, `PT`, `LD`, `SS`, `DF`, `FT`, `HP`, `DP`, `OS`, and `RAC`. |

### Successful response

HTTP 200:

```json
{
  "success": true,
  "message": "Live availability fetched",
  "data": {
    "train_number": "06030",
    "travel_class": "SL",
    "quota": "GN",
    "availability": "WL 61",
    "booking_status": "WL",
    "prediction": 22,
    "fare": 380,
    "total_fare": 417,
    "booking_enabled": true,
    "last_updated": "2026-10-23T20:10:43.097",
    "next_available_dates": ["1-11-2026", "8-11-2026", "15-11-2026"]
  }
}
```

The example above is the sanitized response observed for the plan's synthetic request. It is evidence of shape only; availability, prediction, fare, timestamps, and dates are volatile.

| Response field | Meaning and safe use |
| --- | --- |
| `availability` | Raw provider-derived status. Preserve it for later numeric comparison. Never compare it lexicographically. |
| `booking_status` | Coarse normalized value: `AVAILABLE`, `RAC`, `WL`, `REGRET`, or `UNKNOWN`. |
| `prediction` | Provider prediction integer. Its scale was observed but its business reliability is not documented; do not use as an alert condition yet. |
| `fare`, `total_fare` | Integer amounts. Missing or malformed upstream values may be normalized to zero, so zero is not proof of a free fare. |
| `booking_enabled` | Provider-derived boolean that defaults to true when missing, except for `REGRET`; it is not sufficient evidence for an alert. |
| `last_updated` | String timestamp. If absent upstream, the service may generate a local timestamp. Treat it as metadata, not a stable provider observation ID. |
| `next_available_dates` | List of provider date strings. Date formatting is not guaranteed to be zero-padded. |

### Status normalization observed in source tests

| Raw examples | Normalized status |
| --- | --- |
| `AVAILABLE 15`, `AVL 282`, `CURR_AVBL 4` | `AVAILABLE` |
| `RAC 5` | `RAC` |
| `WL 12`, `GNWL 45/WL 12`, `PQWL 2`, `RLWL 1`, `WAITLIST 5` | `WL` |
| `REGRET`, `REGRET/WL` | `REGRET` |
| blank or unrecognized text | `UNKNOWN` |

`UNKNOWN`, blank availability, missing data, malformed responses, and all error responses must fail closed. They cannot create a positive alert.

### Errors

| HTTP status | Observed source meaning |
| --- | --- |
| 400 | Missing or invalid request, or a provider-declared non-not-found failure. |
| 404 | Train or route schedule not found. |
| 502 | Upstream connection or service failure. |
| 503 | Availability circuit breaker open. |
| 504 | Upstream timeout. |
| 500 | Unexpected internal failure. |

The service currently has two error envelope shapes: FastAPI `HTTPException` responses use `{"detail": "..."}`, while application/global handlers can use `{"success": false, "message": "..."}` with optional `errors`. A future adapter must parse both without returning raw provider details to TrainWatch clients.

## Station search

`GET /api/v1/stations/search?q={query}`

HTTP 200 response:

```json
{
  "success": true,
  "message": "Stations found",
  "data": [
    {
      "station_name": "Rajapalayam",
      "station_code": "RJPM",
      "latitude": 0.0,
      "longitude": 0.0
    }
  ]
}
```

The live shape was observed with `q=RJPM`. Empty results remain a successful response with an empty list. The source may fall back from its local station dataset to an external provider.

## Train search

`GET /api/v1/trains/search`

| Parameter | Required | Meaning |
| --- | --- | --- |
| `from` | Yes | Source station name or code. |
| `to` | Yes | Destination station name or code. |
| `date` | Yes | Journey date; the service normalizes common slash/dash formats. |
| `travelClass` | No | Limits returned/enriched travel classes. |
| `sortBy` | No | `departure` by default; source also handles `arrival`, `duration`, and `fare`. |
| `maxFare` | No | Maximum lowest fare filter. |
| `minRating` | No | Minimum train rating filter. |
| `pantry` | No | Pantry availability filter. |
| `quota` | No | Availability-enrichment quota; defaults to `GN`. |

The live response was observed as HTTP 200 with a direct route and these data fields:

- route result: `result_type`, `source`, `destination`, `total_trains`, `trains`;
- fallback metadata: `route_type`, original/actual stations, `fallback_reason`, search count, and latency;
- train: number, name, type, stations, times, duration, distance, running days, rating, pantry flag, lowest fare, recommended class, and classes;
- class: travel class, fare, raw availability, prediction, bookable flag, and `availability_source`.

Train search can fan out into multiple availability requests when cached availability is absent. Monitoring workers should call the dedicated availability endpoint instead of using train search for polling.

## Health and readiness

- `GET /health` returned HTTP 200 with service name and version.
- `GET /ready` returned HTTP 200 and confirmed the local station dataset was loaded.

These routes describe the external service only. TrainWatch retains its own independent health contract.

## Resilience observed in source

- Availability calls use bounded connection pools and per-process concurrency.
- Identical in-flight availability requests are coalesced within one process.
- Successful observations are cached in memory for a configured TTL.
- Transient `429`, `502`, `503`, and `504` statuses use bounded retries with backoff and jitter.
- A per-process circuit breaker opens after repeated failures.

These controls are local to a service process. TrainWatch must still implement persistent shared-watch deduplication, bounded scheduling, and stale-result protection in its later phases.

## Unresolved contract items

- The service exposes no documented consumer authentication mechanism in the supplied source.
- Provider and deployment request-rate limits are unknown.
- The source does not honor `Retry-After` explicitly.
- Operational documentation and code defaults disagree on timeout, pool, concurrency, cache, and retry values; effective deployment values were not inspected.
- Numeric RAC/waitlist parsing and improvement ordering remain a Phase 2 domain decision.
- Prediction semantics and acceptable alert use remain unverified.
- The source contains credential-like fallback configuration. TrainWatch must not copy, log, or depend on those values; remediation belongs to the existing service owner.

No load test, credential inspection, database access, cloud-resource change, or deployment change was performed in Phase 1.
