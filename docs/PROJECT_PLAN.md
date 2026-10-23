# Project Plan

## Source of truth

The complete, authoritative plan is [`../TrainWatch_Project_RnD_and_Implementation_Plan.md`](../TrainWatch_Project_RnD_and_Implementation_Plan.md). This file is a progress index, not a replacement for it. If the two disagree, the authoritative plan wins.

## Delivery rules

- Implement exactly one approved phase at a time.
- Use synthetic fixtures, local fakes, and mocks by default.
- End every phase with executed-check evidence and an explicit approval gate.
- Never infer approval for database, cloud, provider, deployment, or notification access.

## Phase status

| Phase | Scope | Status |
|---|---|---|
| 0 | Safe repository baseline | Complete; awaiting phase-gate approval |
| 1 | Upstream R&D and API contract | Not approved / not started |
| 2 | Domain model | Not approved / not started |
| 3 | FastAPI skeleton and auth boundary | Not approved / not started |
| 4-15 | Adapters, features, hardening, deployment, mobile, release | Not approved / not started |

## Phase 0 acceptance criteria

- Fresh modular repository structure and initial documentation.
- Placeholder-only configuration template and defensive ignore rules.
- Supported Python project metadata with pinned direct dependencies and a practical lock strategy.
- Formatting, linting, type-checking, tests, secret scan, and minimal CI.
- A locally startable backend smoke endpoint.
- Default tests require no credentials, database, cloud resource, provider API, FCM, or network access.

Phase 0 explicitly excludes train API contracts/integration, Firestore, authentication implementation, task dispatch, workers, notifications, deployments, infrastructure-as-code, and mobile UI.
