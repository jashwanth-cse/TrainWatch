# Firestore Schema

## Phase 4 implemented collection

```text
users/{uid}/reminders/{watchId}
```

`uid` and `watchId` are individual, non-empty path segments of at most 128
characters. The backend derives `uid` from verified authentication before a
repository is called; it must never accept ownership from a request body.

Each reminder document uses schema version `1`:

```text
schemaVersion: 1
query:
  trainNumber: string
  source: string
  destination: string
  journeyDate: YYYY-MM-DD string
  travelClass: string
  quota: string
condition:
  kind: string
  targetStatus: string | null
  maximumPosition: integer | null
status: active | paused | cancelled | expired
createdAt: Firestore timestamp
updatedAt: Firestore timestamp
```

The path supplies `uid` and `watchId`; they are intentionally not duplicated in
the document. TrainWatch reconstructs the domain object using those path values
and validates every stored field.

## Rules and indexes

Phase 4 authorizes backend-only persistence. `firestore.rules` therefore denies
all direct client reads and writes. An Admin/ADC client bypasses these rules, so
backend ownership checks remain mandatory.

`firestore.indexes.json` contains no composite indexes because direct document
reads, writes, and deletes require none. Add an index only alongside the concrete query
that needs it in a later approved phase.

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:abb2d97607fad4790290f391c1511603d7a82db65ebc2a2003d0152f137f1677 -->

## Staging dispatcher scan

The staging dispatcher queries active reminders in descending `createdAt` and
full document-path order, using the existing collection-group `status` /
`createdAt` composite index. Every schema-v1 reminder has `createdAt`; watches
without `lastCheckedAt` remain eligible. Each tick fetches at most its requested
limit (50 by default) and processes batches of at most five concurrently.

`dispatcherState/reminders` stores the last completed batch's `createdAt`
(timestamp) and `path` (full reminder document path). The cursor persists across
service restarts. An empty page resets the cursor for the next sweep. Failed,
malformed, or expired watches do not block later pages; provider failures retain
the previous observation for retry on the next sweep. This is a scan cursor,
not a lease: overlapping scheduler invocations may repeat work, with the outbox
retaining its existing transition idempotency behavior.

## Credential and validation status

<!-- /coderabbit-ai-generated:v1 -->

The service-account key must remain outside the repository. Local execution may
reference it through `GOOGLE_APPLICATION_CREDENTIALS`; deployed environments
should prefer workload identity/Application Default Credentials or Secret
Manager-backed configuration.

Phase 4 automated tests use an in-memory fake and make no database calls. On 24
October 2026, an explicitly approved smoke check created, read, updated, and
deleted one randomly named document beneath `users/trainwatch-connection-test` in
project `trainwatch`, database `(default)`. Cleanup succeeded. The check did not
list or inspect existing data, and it did not validate deployed client rules.
