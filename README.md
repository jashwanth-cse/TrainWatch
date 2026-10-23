# TrainWatch

TrainWatch is a planned Indian train-seat-availability monitoring application. The repository has completed the local work for **Phase 2: Domain Model**. It contains a credential-free FastAPI startup probe, development quality gates, offline provider-contract fixtures, and pure domain rules for shared query identity, watch lifecycles, availability comparison, and alerts. Provider adapters, persistence, queues, notifications, cloud configuration, and the mobile client are intentionally not implemented.

The authoritative implementation plan is [`TrainWatch_Project_RnD_and_Implementation_Plan.md`](TrainWatch_Project_RnD_and_Implementation_Plan.md). Each phase requires an explicit approval gate.

## Prerequisites

- Python 3.13 (the supported project baseline)
- uv 0.13.5

No database, cloud account, credentials, Firebase configuration, or live train API is required.

## Local setup

From `backend/`:

```powershell
uv sync --extra dev --locked
```

Do not create a populated `.env` in the repository. `.env.example` documents placeholders only. Configuration is read from the process environment and defaults to safe local values.

## Run locally

From `backend/`:

```powershell
uv run --no-sync uvicorn trainwatch.main:app --reload
```

The only endpoint is `GET /health/live`. It proves the process starts; it does not contact an external service.

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

Phase 2 domain tests are also fully offline. A provider error is represented separately from a successful snapshot and cannot satisfy an alert condition.
