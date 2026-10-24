# Project Plan

## Source of truth

The complete, authoritative plan is [`../TrainWatch_Full_Implementation_Plan.md`](../TrainWatch_Full_Implementation_Plan.md). This file is a progress index, not a replacement for it. If the two disagree, the authoritative plan wins.

## Delivery rules

- Implement exactly one approved phase at a time.
- Use synthetic fixtures, local fakes, and mocks by default.
- End every phase with executed-check evidence and an explicit approval gate.
- Never infer approval for database, cloud, provider, deployment, or notification access.

## Phase status

| Phase | Scope | Status |
|---|---|---|
| 0 | Safe repository baseline | Complete; merged in PR #1 |
| 1 | Upstream R&D and API contract | Complete; merged in PR #2 |
| 2 | Domain model | Complete; merged in PR #3 |
| 3 | FastAPI skeleton and auth boundary | Complete; merged in PR #4 |
| 4 | Firestore repository boundary | Implemented; mocked suite and disposable live CRUD smoke check pass |
| 5-15 | Adapters, features, hardening, deployment, mobile, release | Not approved / not started |

## Phase 0 acceptance criteria

- Fresh modular repository structure and initial documentation.
- Placeholder-only configuration template and defensive ignore rules.
- Supported Python project metadata with pinned direct dependencies and a practical lock strategy.
- Formatting, linting, type-checking, tests, secret scan, and minimal CI.
- A locally startable backend smoke endpoint.
- Default tests require no credentials, database, cloud resource, provider API, FCM, or network access.

Phase 0 explicitly excludes train API contracts/integration, Firestore, authentication implementation, task dispatch, workers, notifications, deployments, infrastructure-as-code, and mobile UI.

## Phase 2 acceptance criteria

- Pure domain models and minimal ports have no cloud SDK or HTTP dependencies.
- Canonical query keys, lifecycle transitions, structured availability ordering, and alert conditions are unit tested.
- Baselines, duplicate states, unknown values, malformed values, and provider failures cannot create false-positive alerts.
- Prediction semantics remain excluded until the provider contract supports safe use.
- Default tests remain offline and credential-free.

## Phase 3 acceptance criteria

- Versioned health routes, request IDs, and sanitized error envelopes are tested in process.
- Protected-route identity comes only from the injected verifier, never request data.
- Missing, malformed, and invalid bearer tokens return the same sanitized `401` response.
- Cross-user resource access uses a non-enumerating `404` policy.
- The default verifier fails closed without Firebase credentials, SDK initialization, or network access.

## Phase 4 acceptance criteria

- The Firestore adapter stores watches only at owner-scoped reminder paths and reconstructs them through the validated Phase 2 domain model.
- Unsafe path segments and malformed or unsupported stored schemas fail closed.
- Client construction requires an explicit live-access opt-in; imports and default tests cannot discover credentials or access Firestore.
- Firestore rules deny all direct client access because Phase 4 approves only backend-owned persistence.
- No composite indexes are declared until an implemented query requires one.
- Unit tests use an in-memory Firestore-shaped fake. An explicitly approved disposable live CRUD check passed against project `trainwatch` and database `(default)` on 24 October 2026; deployed-rules verification remains pending.
