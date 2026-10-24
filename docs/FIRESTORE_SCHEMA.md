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
reads and writes require none. Add an index only alongside the concrete query
that needs it in a later approved phase.

## Credential and validation status

The service-account key must remain outside the repository. Local execution may
reference it through `GOOGLE_APPLICATION_CREDENTIALS`; deployed environments
should prefer workload identity/Application Default Credentials or Secret
Manager-backed configuration.

Phase 4 automated tests use an in-memory fake and make no database calls. A live
integration test has not been run and must not be run until the user privately
configures credentials and explicitly approves access to the intended database.
