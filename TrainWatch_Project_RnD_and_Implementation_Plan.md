# TrainWatch --- R&D and Phased Implementation Plan

**Product:** TrainWatch\
**Tagline:** *Stop refreshing. Let us watch for RAC to AVL drops.*\
**Build order:** Backend first, React Native mobile UI second\
**Architecture baseline:** Python/FastAPI, React Native/TypeScript,
Firebase Authentication, Firestore, Cloud Tasks, Cloud Scheduler, FCM,
Cloud Run.

## 1. Purpose

TrainWatch lets users create train-seat-availability watches and receive
notifications when availability improves or meets a configured
condition. It must handle concurrent users, avoid duplicate upstream
checks, and remain secure, modular, testable, and cost-aware.

This is a staged plan for an AI coding agent. The agent must implement
one phase, run its tests, report evidence, and **stop for explicit user
approval** before moving to the next phase.

## 2. Non-negotiable user-safety rules

1.  **Never connect to a database independently.** Do not connect to
    Firestore or any other database using real credentials. Do not
    inspect, export, alter, migrate, or delete real data.
2.  **Never ask the user to paste secrets into chat or source files.**
    Use placeholders only. The user will set environment variables and
    configure secret stores themselves.
3.  **Never create or populate a real `.env` file.** Only create
    `.env.example` with placeholder values. Ignore `.env`, credentials,
    private keys, and local secret files in Git.
4.  **Never access cloud projects, create resources, change IAM, enable
    APIs, affect billing, run migrations, deploy, or send real push
    notifications without explicit approval for that action.**
5.  **Do not modify existing deployed train APIs or Dream
    Destiny/TripSense services.** Treat existing APIs as external
    dependencies and create this project in a fresh directory.
6.  Use synthetic fixtures, mocks, and local tests by default. Live
    endpoint, database, cloud, and FCM tests require the user's explicit
    approval.
7.  Never log secrets, authorization headers, Firebase ID tokens, FCM
    tokens, raw environment dumps, or sensitive provider payloads.
8.  Never claim a test passed unless it was actually executed.
    Distinguish mocks from live integration tests and proposed tests
    from executed tests.
9.  At every phase gate, report files changed, commands run, actual
    results, unrun tests, risks, and unresolved decisions; then stop and
    ask permission to continue.
10. If an action could affect privacy, security, cost, production data,
    or an existing service, pause and ask the user.

## 3. MVP scope

-   Mandatory Google Sign-In using Firebase Authentication before
    protected app access.
-   Train/station search through the existing train API.
-   Create, list, inspect, update, pause/resume, and cancel availability
    watches.
-   Configurable alert conditions, based on verified upstream semantics:
    availability becomes confirmed/available, RAC/waitlist improves, or
    a selected threshold is reached where the response supports reliable
    comparison.
-   Periodic checks of shared journey watches and push notifications
    when user conditions are met.
-   Deduplication of identical upstream checks within a monitoring
    cycle.
-   Watch status and recent notification history.
-   Expiration after journey date by default, subject to user approval
    of retention behavior.
-   Safe handling of timeouts, throttling, malformed responses, and
    provider outages. Provider failures must never be interpreted as
    improved availability.

Out of scope unless approved: booking/payment, replacing the provider, a
custom auth system, unnecessary personal data collection, an admin
dashboard, or Redis before measurements justify it.

## 4. Recommended technology stack

| Concern | Recommendation |
| --- | --- |
| Mobile | React Native + TypeScript |
| Mobile workflow | Expo if current Firebase Auth/FCM requirements are supported; validate before locking |
| Backend | Python + FastAPI + Pydantic + Uvicorn |
| Identity | Firebase Authentication, Google Sign-In |
| Database | Firestore, only through explicitly configured code and user-approved credentials |
| Async work | Cloud Tasks with bounded concurrency and retries |
| Scheduling | Cloud Scheduler invoking one authenticated dispatcher, not a scheduler job per user/watch |
| Push | Firebase Cloud Messaging |
| Hosting | Separate Cloud Run deployments for public API, dispatcher, and worker where useful |
| Observability | Cloud Logging and Cloud Monitoring; mobile Crashlytics/Analytics/Performance Monitoring as appropriate |
| Testing | pytest, httpx/FastAPI TestClient, fixtures, mocks, concurrency tests, mobile component tests |
| Quality | Ruff, one selected Python type checker, ESLint/Prettier, dependency/secret/container scanning |
| IaC | Terraform only if approved; plans reviewed before any apply |

Do not hard-code cloud project IDs or region. Ask the user to provide
the approved staging project/region directly in their environment and
confirm compatibility before proposing deployment. Do not discover these
by connecting independently. Do not assume a specific Firestore
location.

## 5. Existing train API boundary

Known availability contract (must be verified before implementation
relies on it):

-   Base URL configuration key: `TRAIN_API_BASE_URL`
-   Path: `/api/v1/trains/availability`
-   Method: `POST`
-   Query parameters: `trainNo`, `source`, `destination`, `travelClass`,
    `date` (`DD-MM-YYYY`), `quota`
-   Request body: empty, according to the currently known contract.

Example test fixture values only: train `06030`, source `RJPM`,
destination `CBE`, date `25-10-2026`, class `SL`, quota `GN`. These are
not production defaults.

The agent must ask the user for an OpenAPI export or sanitized examples,
or ask permission for a narrowly scoped live contract check. Do not
guess station/train search routes or response fields. Do not call a live
endpoint by default. Document response semantics, errors, timeouts, rate
limits, and fields needed for comparisons in `docs/API_CONTRACTS.md`.

## 6. Architecture and design principles

### High cohesion, loose coupling

-   Keep domain/business rules separate from FastAPI, Firestore, Cloud
    Tasks, FCM, and provider SDKs.
-   Route handlers validate requests and invoke application use cases;
    they do not implement polling, alert comparison, or notification
    deduplication.
-   Application logic depends on interfaces/ports such as
    `AvailabilityProvider`, `WatchRepository`, `TaskPublisher`, and
    `NotificationSender`.
-   Infrastructure adapters implement those interfaces.
-   Keep API DTOs, domain entities, and database document models
    separate.
-   Use dependency injection and small interfaces. Avoid giant service
    classes, circular imports, global mutable state, and unnecessary
    abstraction layers.
-   The mobile app calls the public backend API; it must not directly
    mutate server-owned monitoring state in Firestore.
-   API, dispatcher, and worker should have separate entry points and be
    independently deployable where scaling or isolation requires it,
    while sharing one modular codebase initially.

### Logical architecture

``` text
React Native app
  ├─ Google Sign-In / Firebase Authentication
  └─ HTTPS + Firebase ID token
                 |
                 v
           FastAPI public API
       ├─ AuthN/AuthZ + validation
       ├─ Search and watch use cases
       └─ Repository/task interfaces
          |                 |
          v                 v
      Firestore          Cloud Tasks
   users/subscriptions       |
   shared watches            v
   snapshots/outbox      Availability worker
                              ├─ atomic claim/lease
Cloud Scheduler ─> Dispatcher ├─ existing API adapter
                              ├─ snapshot comparison
                              └─ notification outbox
                                        |
                                        v
                                       FCM
```

### Suggested repository layout

``` text
trainwatch/
├── README.md
├── .gitignore
├── .env.example                 # placeholders only
├── docs/
│   ├── PROJECT_PLAN.md
│   ├── ARCHITECTURE.md
│   ├── API_CONTRACTS.md
│   ├── SECURITY.md
│   ├── OPERATIONS.md
│   ├── DECISIONS.md
│   └── phases/
├── backend/
│   ├── pyproject.toml
│   ├── Dockerfile
│   ├── src/trainwatch/
│   │   ├── main.py
│   │   ├── config.py
│   │   ├── api/v1/
│   │   ├── domain/
│   │   ├── application/
│   │   ├── ports/
│   │   ├── infrastructure/
│   │   │   ├── firestore/
│   │   │   ├── firebase_auth/
│   │   │   ├── train_api/
│   │   │   ├── cloud_tasks/
│   │   │   └── fcm/
│   │   ├── dispatcher/
│   │   ├── worker/
│   │   └── observability/
│   └── tests/{unit,contract,integration,concurrency,fixtures}/
├── mobile/
│   ├── package.json
│   └── src/
│       ├── app/
│       ├── navigation/
│       ├── features/{auth,train-search,watches,notifications,settings}/
│       ├── shared/{api,components,hooks,theme,validation}/
│       └── types/
├── deployment/{cloud-run,cloud-tasks,scheduler}/
└── scripts/local-dev/
```

Agent may refine this layout with a written rationale and approval for
major changes. Do not create empty abstractions without a clear
responsibility.

## 7. Domain and data design

Proposed entities; finalize schema/indexes and retention with the user
before real database setup:

-   **User:** Firebase UID, timestamps, minimal preferences. Avoid
    duplicating Google profile data unnecessarily.
-   **Device:** user, device ID, FCM token (sensitive), platform,
    timestamps, token status. Redact tokens in logs. An invalid token
    does not prove the app was uninstalled.
-   **User watch/subscription:** user ID, shared `watchKey`, query
    fields, condition, status, timestamps, expiry, deduplication state.
-   **Shared monitoring watch:** normalized query fields, status, next
    check time, last valid snapshot, lease owner/expiry, retry/failure
    metadata.
-   **Availability snapshot:** observation time, normalized comparison
    fields, provider status, safe diagnostic metadata. Store only
    necessary fields; do not retain full provider payloads by default.
-   **Notification outbox:** deterministic notification ID/idempotency
    key, user/watch/snapshot references, condition, status, attempt
    count, timestamps, sanitized failure category.

Canonical shared key candidate:

`hash(trainNo | source | destination | journeyDate | travelClass | quota)`

Confirm these fields fully identify an upstream query. Normalize only
semantically safe differences. Keep a user's subscription separate from
the shared monitoring job.

Retention periods, indexes, deletion policies, and migration behavior
must be proposed and approved before any real data operation. Default
behavior: stop polling after the journey date.

## 8. API design candidates

Routes below are proposals, not existing endpoints. Finalize schemas in
the contract phase.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/v1/health/live` | Liveness |
| GET | `/api/v1/health/ready` | Readiness without secret leakage |
| GET | `/api/v1/trains/search` | Search trains through adapter |
| GET | `/api/v1/stations/search` | Search stations through adapter |
| POST | `/api/v1/watches` | Create subscription |
| GET | `/api/v1/watches` | List own subscriptions |
| GET | `/api/v1/watches/{watch_id}` | Get owned subscription |
| PATCH | `/api/v1/watches/{watch_id}` | Update/pause/resume |
| DELETE | `/api/v1/watches/{watch_id}` | Cancel subscription |
| POST | `/api/v1/devices` | Register/refresh device token |
| DELETE | `/api/v1/devices/{device_id}` | Remove device |
| GET | `/api/v1/notifications` | Notification history |

Requirements: - Verify Firebase ID tokens on protected endpoints. -
Derive the user UID from the verified token, never a request body. -
Enforce ownership for all user resources. - Validate station codes,
dates, classes, quotas, alert conditions, payload sizes, and request
frequency. - Use pagination for lists. - Use consistent sanitized
errors; never return stack traces or raw provider exceptions. - Internal
worker/dispatcher routes require service-to-service authentication and
must not be publicly callable as normal client routes. - Use
request/correlation IDs without sensitive content.

## 9. Concurrency and reliability design

1.  Dispatcher selects **due shared watches**, not each user's
    subscription.
2.  Cloud Tasks applies bounded dispatch rate and concurrency.
3.  Worker atomically claims a shared watch using a
    transaction/conditional update and a lease expiry.
4.  Only the current lease holder may commit results; stale workers
    cannot overwrite newer snapshots.
5.  Each upstream request has explicit connect/read timeouts and bounded
    retries with exponential backoff and jitter; honor `Retry-After`.
6.  Respect provider rate limits; add circuit-breaker/backoff behavior
    after repeated failures.
7.  Persist only valid observations. Timeout, malformed response, auth
    failure, `429`, and provider `5xx` are not availability
    improvements.
8.  Compare structured status and numeric fields using documented domain
    rules; never compare status strings lexicographically. Unknown
    statuses must fail safely.
9.  Evaluate user alert conditions against the valid snapshot and write
    a notification outbox record with an idempotency key.
10. Deliver outbox messages through a separate bounded processor. Retry
    transient FCM errors; disable invalid tokens according to provider
    response.
11. Ensure duplicate task delivery is safe and bounded. Do not use
    unbounded `asyncio.create_task`, in-memory queues, or `gather`.
12. Public API remains responsive when workers or provider calls are
    slow. Worker/dispatcher failures must not trigger a retry storm.

Measure before promising scale: API p95/p99 latency, active
subscriptions, unique shared keys, upstream calls per cycle, queue
depth/age, worker concurrency, provider `429`/timeouts, Firestore
contention, outbox age, and cost per active watch. Set limits from
provider quotas and staged load-test evidence, not guesses.

## 10. Security, privacy, and configuration

### Placeholder-only environment template

``` dotenv
APP_ENV=local
LOG_LEVEL=INFO
TRAIN_API_BASE_URL=https://example.invalid
FIREBASE_PROJECT_ID=REPLACE_ME
GOOGLE_CLOUD_PROJECT=REPLACE_ME
GOOGLE_CLOUD_REGION=REPLACE_ME
FIRESTORE_DATABASE_ID=REPLACE_ME
CLOUD_TASKS_QUEUE=REPLACE_ME
CLOUD_TASKS_LOCATION=REPLACE_ME
FCM_ENABLED=false
```

This is an example template, not a working configuration. Never create
or populate a real `.env`; the user owns environment setup. Use workload
identity/short-lived credentials where possible rather than
service-account key files. Never embed privileged secrets in the mobile
bundle, Git, tests, docs, or CI logs.

Security requirements: - Firebase Auth is mandatory; server verifies ID
tokens. - Least-privilege service identities and separate
staging/production environments. - TLS for network calls; rate limits
and abuse protection. - No sensitive values in logs, crash reports,
analytics, or notification payloads. - Firestore rules and IAM must
prevent users from bypassing the API to modify shared jobs, leases,
snapshots, or outbox records. - Keep personal data minimal and document
retention. - Run dependency, static, secret, and container scans; review
findings instead of blindly upgrading dependencies. - Do not change IAM,
billing, project settings, or cloud resources without explicit approval.

## 11. Test strategy

-   **Unit:** key normalization, lifecycle transitions, snapshot
    comparison, alert rules, retry policy.
-   **Contract:** provider response parsing against sanitized fixtures.
-   **API:** auth, ownership, validation, pagination, error envelopes.
-   **Repository:** fakes by default; emulator only in a user-approved
    test environment.
-   **Concurrency:** simultaneous claims, lease expiry, stale worker,
    duplicate task, shared-key deduplication.
-   **Failure injection:** timeout, `429`, `5xx`, malformed response,
    FCM transient/permanent errors.
-   **Integration:** local fakes/emulators first; approved staging only
    later.
-   **Load:** bounded synthetic load with a fake provider first. Any
    live provider load test needs explicit approval and an agreed rate.
-   **Mobile:** sign-in states, search, CRUD, offline/error/loading
    states, push permission/token lifecycle.
-   **End-to-end:** synthetic watch -\> fixture snapshot -\> detected
    improvement -\> mocked notification.

Suggested tools: pytest, httpx, Ruff, one selected type checker, React
Native Testing Library/Jest or compatible current equivalents,
ESLint/Prettier, dependency/secret/container scanners. Choose supported
versions at implementation time, pin dependencies, and keep lockfiles.
Do not claim coverage or test results that were not measured.

## 12. Phased implementation and approval gates

**Every phase ends with a written report and a stop. The agent must wait
for explicit approval before starting the next phase.**

### Phase 0 --- Safe repository baseline

Create fresh project structure, `.gitignore`, placeholder
`.env.example`, docs, backend metadata, lint/format/type/test setup, and
CI. No cloud/database access. **Pass:** clean install, local checks run,
tests run without credentials, secret scan clean. **Stop for approval.**

### Phase 1 --- Upstream R&D and API contract

Ask for OpenAPI export or sanitized fixtures; live checks only with
explicit approval. Document endpoint schemas, responses, errors, limits,
timeouts, and availability semantics. **Pass:** contract docs and
fixture tests exist; no guessed fields/routes. **Stop for approval.**

### Phase 2 --- Domain model

Implement pure models, watch-key generation, lifecycle rules, alert
evaluation, snapshot comparison, and ports. No cloud SDK dependencies in
domain code. **Pass:** unit tests cover normal/edge/unknown/error cases;
provider errors never create positive alerts. **Stop for approval.**

### Phase 3 --- FastAPI skeleton and auth boundary

Add versioned routers, dependency injection, health endpoints,
structured sanitized errors, request IDs, injectable Firebase token
verification, fake auth for tests, and ownership policy. **Pass:** auth
and cross-user isolation tests pass; API starts without production
credentials. **Stop for approval.**

### Phase 4 --- Repository adapters

Finalize proposed schema/index/retention docs. Implement repository
interfaces and fakes first. Firestore adapter remains disabled unless
user configures it; emulator only after approval. **Pass:** repository
contract tests pass; default test suite cannot accidentally connect to
production; user reviews schema. **Stop for approval.**

### Phase 5 --- Existing train API adapter and search

Implement typed outbound adapter with timeout/retry/error mapping; use
sanitized fixtures and mocked HTTP by default. Implement search use
cases only after route contract verification. **Pass:** contract and
failure tests pass; default suite makes no live calls. **Stop for
approval.**

### Phase 6 --- Watch management

Implement create/list/get/update/pause/resume/cancel, ownership,
validation, idempotent creation where appropriate, and expiration rules.
**Pass:** lifecycle, duplicate, invalid-input, expired-watch, and
cross-user tests pass. **Stop for approval.**

### Phase 7 --- Dispatcher, queue, and worker

Implement due-watch dispatch, fake queue, Cloud Tasks adapter, atomic
claim/lease, snapshot storage/comparison, schedule advancement, bounded
retries, stale-result protection, and failure recording. **Pass:**
concurrent workers cannot double-claim; same key is checked once per
cycle; distinct keys can proceed within limits; retries are bounded.
**Stop for approval.**

### Phase 8 --- Notification outbox and FCM

Implement durable outbox, idempotency, bounded processor, fake sender,
device registration/removal, invalid-token handling, and privacy-safe
message content. **Pass:** duplicate execution does not duplicate
notification intent; transient errors retry; user data never crosses
accounts. Real FCM disabled until explicit approval. **Stop for
approval.**

### Phase 9 --- Backend hardening

Run complete suite, static/type/dependency/secret/container scans,
failure injection, bounded fake-provider load test, container build,
graceful shutdown, readiness, and observability review. **Pass:** no
unapproved critical risk, results documented, deployment prerequisites
ready. **Stop for approval.**

### Phase 10 --- Staging infrastructure plan

Ask for approved project/region, budget, service identities, and staging
setup. Propose Cloud Run, Tasks, Scheduler, Firestore access, IAM,
logging, and rollback. Terraform only if approved; plan review before
apply. **Pass:** user approves scope and estimated costs; secrets are
configured by user; no changes made until explicit deployment
authorization. **Stop for approval.**

### Phase 11 --- Approved staging validation

Only after authorization, deploy staging. Start with fake provider and
sender; real provider/FCM tests need separate approval. Run gradual
bounded load tests and measure latency, queue, contention, upstream
request volume, and cost. **Pass:** staging thresholds met and report
reviewed. **Stop for approval.**

### Phase 12 --- Mobile foundation

Only after backend contracts are approved, create React
Native/TypeScript app; decide Expo/native workflow based on current
Firebase requirements. Add navigation, theme, typed API client, token
injection, and test setup. **Pass:** app shell and auth states work with
mocks; no privileged secrets in app. **Stop for approval.**

### Phase 13 --- Mobile features

Implement sign-in, train/station search, watch
creation/list/detail/pause/resume/cancel, notification history, push
permission/token registration, and loading/empty/offline/error states.
**Pass:** component tests, validation, accessibility checks, and
approved staging integration pass. **Stop for approval.**

### Phase 14 --- End-to-end release readiness

Test full journey, token expiry, offline app, provider outage, duplicate
jobs, retry recovery, privacy, analytics, retention, and rollback.
Document known limitations and release checklist. **Pass:** user
approves evidence and release configuration. **Stop for approval.**

### Phase 15 --- Controlled production launch

Only with explicit production approval: deploy approved resources, use
conservative concurrency and staged rollout, monitor error
rates/queue/provider limits/cost, and keep rollback ready. Increase
capacity only using measured evidence.

## 13. CI/CD and operations

PR checks: format, lint, type check, unit/contract tests, secret
scanning. Build reproducible containers, pin dependencies, generate an
SBOM and scan images where supported. Separate local/staging/production.
Never log secret values. Require approval for production deployment and
infrastructure changes.

Metrics to consider: request rate/latency/status, auth failures, active
subscriptions, unique keys, queue depth/age, provider call
rate/latency/429s, worker duration/lease contention, unknown response
statuses, outbox age, FCM errors, Firestore contention, and cost
indicators. Logs should contain service/environment/request IDs and safe
error categories, not credentials or full payloads.

## 14. Questions to raise just in time

Do not block Phase 0 with all questions. Ask when relevant: 1. Can the
user provide OpenAPI or sanitized provider fixtures? Is a live contract
check allowed, with what rate? 2. Which cloud project and region are
approved for staging? The user supplies values in their own environment.
3. Is a local emulator or dedicated test project available? Never
discover by connecting independently. 4. What polling interval and
provider request limits are permitted? 5. Which exact availability
transitions trigger alerts, and should each improvement notify once or
repeatedly? 6. What active-watch limits and history-retention periods
are acceptable? 7. Is Expo acceptable if current Firebase Auth/FCM
support is verified, or is bare React Native preferred? 8. Should
Terraform be used, with plans only until separately approved? 9. Is the
first release Android-only or Android and iOS?

Never ask for passwords, private keys, API keys, service-account JSON,
or tokens in chat.

## 15. Definition of done

-   Mandatory authentication and server-side authorization are tested.
-   Cross-user data access is prevented.
-   Identical queries share monitoring work.
-   Concurrent workers cannot corrupt snapshots or duplicate
    notification intents.
-   Provider errors never appear as availability improvements.
-   Timeouts, retries, concurrency, and rate limits are bounded.
-   Tests run on synthetic data without production credentials.
-   No real secrets are committed or embedded in the app.
-   Observability supports diagnosis without sensitive logs.
-   Retention, cost assumptions, provider limits, deployment, and
    rollback are documented.
-   Each phase gate was explicitly approved.
-   Staging/production actions occurred only with explicit user
    authorization.

## 16. Agent operating instructions

At each session start, read this plan and `docs/DECISIONS.md`, identify
the current approved phase, inspect existing work before editing, and
change only files in scope. Use mocks by default. Do not connect to
databases, retrieve credentials, call live APIs, or touch cloud
resources unless the user explicitly approved that specific action.
Never populate real environment files. Run the phase tests, report exact
commands and actual outcomes, document assumptions and risks, then stop
for approval.

**When uncertain: pause, explain the risk, and ask the user.**
