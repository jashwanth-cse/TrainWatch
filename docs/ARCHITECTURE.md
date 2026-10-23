# Architecture

## Current Phase 0 shape

```text
repository root
├── docs/                         decision and safety records
├── scripts/check_secrets.py      dependency-free repository safety check
└── backend/
    ├── pyproject.toml            package and shared tool configuration
    ├── src/trainwatch/
    │   ├── config.py             non-secret process configuration
    │   └── main.py               FastAPI app factory and liveness route
    └── tests/unit/               local, isolated smoke tests
```

Only responsibilities needed to start and validate the process exist today. The application has no persistence, provider client, background task, authentication SDK, or notification dependency.

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

The future public API, dispatcher, worker, data store, provider, and notification sender are separate trust and failure boundaries. Provider failures never become positive availability observations. User subscriptions remain separate from deduplicated shared monitoring watches. These rules are design constraints only in Phase 0; they are not yet implemented.

## Configuration

`config.py` reads a small, explicitly allowed set of non-secret startup settings from the process environment. It does not read `.env` files, discover cloud projects, or initialize SDK clients. Future sensitive settings must remain externally supplied and must never be returned by health endpoints or emitted in logs.
