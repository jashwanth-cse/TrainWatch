"""Run an explicitly approved, disposable Firestore CRUD smoke check."""

from __future__ import annotations

import argparse
import asyncio
from datetime import UTC, date, datetime, timedelta
from uuid import uuid4

from trainwatch.domain.alerts import AlertCondition, AlertKind
from trainwatch.domain.watch import TrainQuery, Watch, WatchStatus
from trainwatch.infrastructure.firestore import (
    FirestoreWatchRepository,
    create_firestore_client,
)

_TEST_OWNER = "trainwatch-connection-test"


def _arguments() -> argparse.Namespace:
    """Parse the target database and explicit live-write acknowledgement."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True)
    parser.add_argument("--database", default="(default)")
    parser.add_argument(
        "--confirm-live",
        action="store_true",
        help="required acknowledgement that this command writes to live Firestore",
    )
    return parser.parse_args()


async def _check(*, project: str, database: str, confirm_live: bool) -> None:
    """Verify live CRUD using a unique watch and delete it during cleanup."""
    if not confirm_live:
        raise RuntimeError("live Firestore CRUD check requires --confirm-live")
    client = create_firestore_client(
        project_id=project,
        database_id=database,
        allow_live_access=True,
    )
    repository = FirestoreWatchRepository(client)
    watch_id = f"connection-test-{uuid4().hex}"
    now = datetime.now(UTC)
    initial = Watch(
        watch_id=watch_id,
        owner_id=_TEST_OWNER,
        query=TrainQuery(
            train_number="12661",
            source="RJPM",
            destination="MS",
            journey_date=date.today() + timedelta(days=30),
            travel_class="3A",
            quota="GN",
        ),
        condition=AlertCondition(AlertKind.BECOMES_AVAILABLE),
        status=WatchStatus.ACTIVE,
        created_at=now,
        updated_at=now,
    )
    try:
        await repository.save(initial)
        if await repository.get(watch_id=watch_id, owner_id=_TEST_OWNER) != initial:
            raise RuntimeError("create/read verification failed")

        updated = initial.transition(WatchStatus.PAUSED, at=now + timedelta(seconds=1))
        await repository.save(updated)
        if await repository.get(watch_id=watch_id, owner_id=_TEST_OWNER) != updated:
            raise RuntimeError("update/read verification failed")

        await repository.delete(watch_id=watch_id, owner_id=_TEST_OWNER)
        if await repository.get(watch_id=watch_id, owner_id=_TEST_OWNER) is not None:
            raise RuntimeError("delete verification failed")
    finally:
        await repository.delete(watch_id=watch_id, owner_id=_TEST_OWNER)


def main() -> int:
    """Run the guarded check and emit no credentials or document contents."""
    arguments = _arguments()
    try:
        asyncio.run(
            _check(
                project=arguments.project,
                database=arguments.database,
                confirm_live=arguments.confirm_live,
            )
        )
    except Exception as exc:
        print(f"Firestore CRUD check failed ({type(exc).__name__}).")
        return 1
    print("Firestore CRUD check passed; disposable test document was deleted.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
