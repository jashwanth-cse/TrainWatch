# Architecture

## Current Phase 5 shape

```text
repository root
├── docs/                         decision and safety records
├── scripts/check_secrets.py      dependency-free repository safety check
└── backend/
    ├── pyproject.toml            package and shared tool configuration
    ├── src/trainwatch/
    │   ├── config.py             non-secret process configuration
    │   ├── main.py               FastAPI app factory and dependency wiring
    │   ├── api/                  versioned routes, auth, errors, request IDs
    │   ├── domain/               pure queries, watches, snapshots, and alerts
    │   ├── ports/                provider, repository, and identity protocols
    │   └── infrastructure/
    │       ├── firestore/        guarded client factory, codecs, watch adapter
    │       └── train_api/        typed, retry-bounded Dream Destiny adapter
    └── tests/                    offline unit and provider-contract tests
```

The domain layer uses only the Python standard library. It has no FastAPI, persistence, provider client, background-task, authentication SDK, or notification dependency. The API layer owns HTTP concerns and depends on an identity port; ports initialize nothing and perform no I/O.

## Train-provider boundary

- `DreamDestinyClient` implements the search and availability ports through an injected `httpx.AsyncClient`; constructing the adapter performs no I/O.
- Station and train searches use the source-verified endpoints and parameter names. Journey dates are serialized as `DD-MM-YYYY`; normalized class/quota codes and train-number strings remain intact.
- Provider responses are mapped into immutable application-facing DTOs. Extra provider fields are discarded, optional malformed values become `None`, and malformed required structures fail closed.
- Network exceptions and HTTP failures become stable error categories without returning provider bodies or exception text. Availability failures become unsuccessful observations and can never be interpreted as an improved seat state.
- The production HTTP-client factory applies strict timeout and connection-pool limits. Retries are bounded and limited to transport failures and the transient status set `429`, `502`, `503`, and `504`.
- Tests inject `httpx.MockTransport`; the default test suite cannot reach the deployed provider.

## Firestore boundary

- `FirestoreWatchRepository` implements the existing `WatchRepository` port; domain and application code remain unaware of Google Cloud types.
- Documents live at `users/{uid}/reminders/{watchId}`. The verified owner ID selects the parent path, so the adapter never performs a global watch lookup.
- Stored data carries a schema version and is decoded back through domain constructors. Unknown versions, invalid types, invalid enums, and broken invariants raise a sanitized `WatchDataError`.
- The adapter receives a narrow client interface. Unit tests provide an in-memory fake and never construct a Google client.
- The production client factory uses Application Default Credentials only after an explicit `allow_live_access=True` call with non-placeholder project and database IDs.
- Direct mobile access is not approved, so committed Firestore rules deny all reads and writes. Server SDK calls must still enforce ownership because Admin clients bypass rules.
- No composite index exists yet because Phase 4 implements only direct document reads and writes.

## API and identity boundary

- `/api/v1` is the public version prefix. Liveness and readiness inspect only local process state.
- A `TokenVerifier` is injected into the app factory. The safe default rejects all tokens; tests inject an in-memory fake.
- Verified identities contain only a UID. Client-supplied identity claims are ignored.
- Ownership is a separate reusable policy and returns `404` for both absent and cross-user resources.
- Request IDs and sanitized error envelopes are centralized. Raw validation data, exception text, tokens, and stack traces are not returned.

## Domain rules

- A shared query key is a versioned SHA-256 digest over normalized train number, source, destination, journey date, travel class, and quota. Leading zeroes in train numbers are preserved.
- Watch values are immutable. Active and paused watches may be transitioned explicitly; cancelled and expired watches are terminal.
- Availability ordering is structural: `AVAILABLE` is better than `RAC`, which is better than `WL`; lower RAC/WL positions are better.
- The first valid observation establishes a baseline. Duplicate observations do not alert.
- Unknown, malformed, or failed provider observations cannot trigger an alert. Prediction, fare, and timestamps do not influence ordering.

## Target modular monolith

Later approved phases will add cohesive packages under `src/trainwatch/`:

| Package | Responsibility | May depend on |
|---|---|---|
| `domain` | Pure entities, lifecycle rules, comparisons, alert semantics | Python standard library only where practical |
| `application` | Use-case orchestration | Domain and ports |
| `ports` | Small interfaces for external capabilities | Domain types |
| `api` | HTTP validation, authentication boundary, DTO mapping | Application use cases |
| `infrastructure` | Firestore, Firebase Auth, train API, Cloud Tasks, and FCM adapters | Ports and vendor SDKs |
| `dispatcher` | Find and enqueue due shared watches | Application/ports |
| `worker` | Claim, check, compare, and record work safely | Application/ports |
| `observability` | Sanitized structured telemetry | Shared safe primitives |

Dependency direction points inward: infrastructure and delivery mechanisms implement or call application ports; domain code never imports FastAPI, cloud SDKs, or provider clients. API, dispatcher, and worker can later have separate entry points and deployments while initially sharing one codebase.

## Runtime boundaries

The future public API, dispatcher, worker, data store, provider, and notification sender are separate trust and failure boundaries. Provider failures are now modeled separately from successful availability snapshots and fail closed during alert evaluation. User subscriptions remain separate from deduplicated shared monitoring watches; persistence for that separation is deferred to its approved phase.

## Configuration

`config.py` reads a small, explicitly allowed set of non-secret startup settings from the process environment. It does not read `.env` files, discover cloud projects, or initialize SDK clients. Future sensitive settings must remain externally supplied and must never be returned by health endpoints or emitted in logs.

### Watch scheduling integration

Applications accepting watch creation or pause-to-active transitions must inject
`job_repository` into `create_app`, using the same repository as the dispatcher
and worker. These operations return 503 before modifying the watch when scheduling
is unconfigured. Read, pause, cancel and delete operations retain their existing
repository requirements.

`JobRepository.ensure_pending` must atomically create or reactivate the stable
per-watch job ID, preserving an existing pending schedule or active lease. A
resumed completed/failed job starts with a fresh retry budget. Concrete external
job persistence and queue adapters remain injectable; the default app initializes
no cloud clients.

Successful recurring checks reset the attempt budget; lease recovery preserves it.
Execution failures use sanitized, bounded retries. To preserve alerts across
partial writes, the worker persists a qualifying outbox item before advancing the
observation baseline. Its idempotency key includes the previous observation time,
so a retry deduplicates the same transition and a later qualifying transition can
notify again. This refines the operation ordering listed in implementation plan
section 8 while preserving its reliable-outbox requirement.
