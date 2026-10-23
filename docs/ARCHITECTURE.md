# Architecture

## Current Phase 3 shape

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
    │   └── ports/                provider, repository, and identity protocols
    └── tests/                    offline unit and provider-contract tests
```

The domain layer uses only the Python standard library. It has no FastAPI, persistence, provider client, background-task, authentication SDK, or notification dependency. The API layer owns HTTP concerns and depends on an identity port; ports initialize nothing and perform no I/O.

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
