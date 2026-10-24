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

## Accepted in Phase 2

### ADR-0010: Version the canonical shared-watch key

- **Decision:** Normalize only verified safe fields and hash the ordered train number, source, destination, ISO journey date, travel class, and quota into a `v1:` SHA-256 key. Preserve leading-zero train numbers.
- **Reason:** Identical provider queries can share work without exposing query values in identifiers, while the version prefix permits a controlled future normalization change.

### ADR-0011: Use structured availability ordering

- **Decision:** Order comparable states as `AVAILABLE` above `RAC` above `WL`, with lower numeric RAC/WL positions considered better. Do not compare raw strings or use provider prediction values.
- **Reason:** This implements only source-verified semantics. Raw lexical ordering and undocumented prediction scores could create false alerts.

### ADR-0012: Alerts require a valid transition

- **Decision:** The first successful observation establishes a baseline. Repeated values do not alert. Unknown, malformed, or failed observations cannot create a positive alert; provider `REGRET` is not numerically comparable.
- **Reason:** A notification must be supported by two trustworthy observations and a deterministic transition, not by missing or uncertain data.

### ADR-0013: Keep domain state immutable and infrastructure-free

- **Decision:** Domain values are frozen dataclasses with explicit lifecycle transitions. Provider and repository dependencies are minimal async Protocol ports outside the domain package.
- **Reason:** Immutable values make transitions testable and reduce shared-state risks. Protocols preserve dependency inversion without selecting an HTTP or database implementation early.

## Accepted in Phase 3

### ADR-0014: Inject token verification and fail closed by default

- **Decision:** Protected routes depend on a `TokenVerifier` Protocol. When no approved adapter is configured, the application uses a verifier that rejects every token without external access.
- **Reason:** API structure and authorization behavior can be tested now without Firebase credentials, SDK initialization, or accidental network access.

### ADR-0015: Hide ownership mismatches as not found

- **Decision:** A caller requesting another user's resource receives the same sanitized `404` response as an absent resource.
- **Reason:** A distinct authorization response would reveal whether another user's identifier exists.

### ADR-0016: Centralize public errors and opaque request IDs

- **Decision:** Public failures use one error envelope and a bounded opaque request ID. Invalid client IDs are replaced; raw framework validation and exception details are suppressed.
- **Reason:** Stable errors support clients and diagnosis without reflecting sensitive input or exposing implementation details.

## Accepted in Phase 4

### ADR-0017: Keep reminders in owner-scoped Firestore subcollections

- **Decision:** Persist watch documents at `users/{uid}/reminders/{watchId}` and require the owner ID for every repository read and write.
- **Reason:** Ownership becomes part of document addressing, avoids global user-watch lookups, and matches the backend authorization boundary.

### ADR-0018: Version and revalidate stored documents

- **Decision:** Store a `schemaVersion` and decode all fields through Phase 2 domain constructors. Treat unknown, malformed, or invariant-breaking documents as `WatchDataError` rather than returning partial state.
- **Reason:** Firestore is schemaless at rest; validation on both write and read prevents corrupt or manually edited data from bypassing domain rules.

### ADR-0019: Require explicit live Firestore activation

- **Decision:** Inject a narrow Firestore client into repositories. The production ADC factory refuses construction unless the caller explicitly enables live access and supplies non-placeholder project and database IDs.
- **Reason:** Tests and normal imports must never discover local credentials or accidentally connect to a real database.

### ADR-0020: Deny direct Firestore client access in Phase 4

- **Decision:** Commit deny-all Firestore rules and no composite indexes. Mobile clients will use the authenticated backend until a later phase explicitly designs and tests direct access.
- **Reason:** Backend-only persistence provides the smallest authorization surface and avoids granting unneeded client permissions.

## Accepted in Phase 5

### ADR-0021: Adapt the existing train service behind narrow typed ports

- **Decision:** Implement one `DreamDestinyClient` that maps the verified station, train-search, and availability contracts into application-owned immutable DTOs and availability observations.
- **Reason:** The existing service remains the source of provider behavior while TrainWatch avoids coupling domain and use-case code to provider-specific payloads.

### ADR-0022: Inject the async HTTP client

- **Decision:** Accept an `httpx.AsyncClient` in the adapter and provide a separate factory with explicit timeout and connection-pool limits.
- **Reason:** Client injection keeps construction side-effect free, makes transport behavior deterministic in tests, and allows later runtime composition without hiding network configuration.

### ADR-0023: Retry only bounded transient failures

- **Decision:** Use finite exponential backoff with jitter for transport exceptions and `429`, `502`, `503`, and `504`; do not retry other `4xx` or `5xx` responses.
- **Reason:** A short transient failure may recover, while retrying invalid requests or arbitrary upstream errors adds load and latency without a safe expectation of success.

### ADR-0024: Sanitize and fail closed at the provider boundary

- **Decision:** Expose stable error categories without response bodies or exception text. Reject malformed required response data; convert availability failures to non-successful observations.
- **Reason:** Provider diagnostics may contain sensitive or unstable details, and uncertain data must never become a false-positive seat alert.
