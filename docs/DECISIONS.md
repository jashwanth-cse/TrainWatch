# Architecture Decision Log

This log records accepted baseline decisions and items that require later user approval.

## Accepted in Phase 0

### ADR-0001: Use the existing repository root

- **Decision:** Treat `E:\Projects\TrainWatch` as the fresh TrainWatch project root instead of creating a nested `trainwatch/` directory.
- **Reason:** The repository contained only the authoritative specification and no unrelated implementation. Nesting would add no isolation and would make commands and paths less clear.

### ADR-0002: Target Python 3.13

- **Decision:** Require Python 3.13 or 3.14 and use Python 3.13 in CI.
- **Reason:** Python 3.13 is supported through October 2029 and has broad package support. The locally installed Python 3.10 is end-of-life and is not the project baseline.

### ADR-0003: Start as a modular monolith

- **Decision:** Keep one Python distribution with strict package boundaries, with independently deployable API/dispatcher/worker entry points added only when their phases are approved.
- **Reason:** This preserves loose coupling without premature services or operational overhead.

### ADR-0004: Materialize only real Phase 0 responsibilities

- **Decision:** Create configuration, an app factory/liveness route, and unit tests now. Document future packages rather than committing empty abstractions.
- **Reason:** It proves installation/startup while respecting the planned phase ownership of domain, auth, adapters, workers, and notifications.

### ADR-0005: Environment-only configuration

- **Decision:** Do not auto-load `.env` files. Use safe local defaults for non-secret startup labels and keep `.env.example` as documentation only.
- **Reason:** This reduces accidental credential discovery and keeps tests independent from developer machines.

### ADR-0006: One shared Python tool configuration

- **Decision:** Configure Ruff, mypy, pytest, and coverage in `backend/pyproject.toml`; run a dependency-free repository secret scan separately.
- **Reason:** Local and CI behavior stays aligned with minimal tooling.

## Deferred decisions

- Provider OpenAPI contract, response semantics, permitted rates, and fixtures (Phase 1).
- Domain fields, alert transition semantics, and canonical watch-key fields (Phase 2).
- Authentication implementation and error envelope details (Phase 3).
- Firestore schema, indexes, retention, emulator/test-project use, and migrations (Phase 4).
- Queue limits, leases, retries, polling intervals, and concurrency (Phase 7).
- Notification content and delivery/retry policy (Phase 8).
- Cloud project, region, infrastructure-as-code, budget, deployment, and rollback (Phases 10+).
- Expo versus bare React Native and target mobile platforms (Phase 12).
- Repository license and ownership metadata.

## Accepted in Phase 1

### ADR-0007: Treat Dream Destiny as an external provider boundary

- **Decision:** TrainWatch consumes the deployed Dream Destiny train service and does not copy or reimplement its station, train-search, availability-provider, or route-fallback internals.
- **Reason:** The service already owns those responsibilities. TrainWatch needs a narrow typed adapter around its verified public contract.

### ADR-0008: Prefer the JSON availability request

- **Decision:** The future Phase 5 adapter will call `POST /api/v1/trains/availability` with its supported JSON body rather than duplicating parameters in the URL.
- **Reason:** Both forms are supported, and JSON provides a clearer typed boundary while preserving the deployed service contract.

### ADR-0009: Preserve raw status and fail closed

- **Decision:** Retain both `availability` and `booking_status`. Blank, malformed, `UNKNOWN`, transport-error, and provider-error observations are unusable for positive alerts.
- **Reason:** The coarse status alone cannot express numerical RAC or waitlist improvement, and provider failure must never look like better availability.
