# TrainWatch

TrainWatch is a planned Indian train-seat-availability monitoring application. The repository has implemented **Phase 5: Existing Train API Integration Adapters** after completing Phases 0-4. It contains a credential-free versioned API, injectable token verification, ownership policy, pure domain rules, an owner-scoped Firestore adapter, and a typed Dream Destiny train-service adapter. Real Firebase verification, public reminder routes, queues, notifications, cloud deployment, and the mobile client are intentionally not implemented.

The authoritative implementation plan is [`TrainWatch_Full_Implementation_Plan.md`](TrainWatch_Full_Implementation_Plan.md). Each phase requires an explicit approval gate.

## Prerequisites

- Python 3.13 (the supported project baseline)
- uv 0.13.5

No database, cloud account, credentials, Firebase configuration, or live train API is required for the default application or test suite.

## Local setup

From `backend/`:

```powershell
uv sync --extra dev --locked
```

Do not create a populated `.env` in the repository. `.env.example` documents placeholders only. Configuration is read from the process environment and defaults to safe local values.

The Phase 4 repository accepts an injected Firestore client. Its production factory refuses to discover Application Default Credentials unless the caller explicitly opts in. Keep service-account files outside this repository.

## Run locally

From `backend/`:

```powershell
uv run --no-sync uvicorn trainwatch.main:app --reload
```

The local endpoints are `GET /api/v1/health/live` and `GET /api/v1/health/ready`. They prove the process starts and is locally ready; they do not contact external services. Protected routes remain closed until a later approved phase injects a real Firebase verifier.

## Quality gates

From `backend/`:

```powershell
uv run --no-sync ruff format --check . ../scripts
uv run --no-sync ruff check . ../scripts
uv run --no-sync mypy src tests ../scripts
uv run --no-sync pytest
```

From the repository root:

```powershell
python scripts/check_secrets.py
```

CI runs the same gates. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/SECURITY.md`](docs/SECURITY.md), and [`docs/DECISIONS.md`](docs/DECISIONS.md) for the current boundaries and decisions.

The verified external-service boundary is documented in [`docs/API_CONTRACTS.md`](docs/API_CONTRACTS.md). Contract tests use sanitized local fixtures and never call the deployed service.

Domain, API, persistence, and provider-adapter tests are fully offline. Authentication tests use synthetic tokens, persistence tests use an in-memory Firestore-shaped fake, and HTTP tests use an injected mock transport; no Firebase credential or live provider is required.

An intentional live CRUD check is available through `scripts/check_firestore_connection.py`.
It requires both `--confirm-live` and externally configured Application Default
Credentials, uses a unique disposable document, and deletes that document in a
cleanup block. It must never be added to the default test suite.
