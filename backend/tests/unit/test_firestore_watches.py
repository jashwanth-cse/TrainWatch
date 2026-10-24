"""Offline tests for the owner-scoped Firestore watch adapter."""

from __future__ import annotations

from collections.abc import Mapping
from datetime import UTC, date, datetime
from typing import cast

import pytest

from trainwatch.domain.alerts import AlertCondition, AlertKind
from trainwatch.domain.availability import AvailabilityStatus
from trainwatch.domain.watch import TrainQuery, Watch, WatchStatus
from trainwatch.infrastructure.firestore import client as client_module
from trainwatch.infrastructure.firestore.client import create_firestore_client
from trainwatch.infrastructure.firestore.watches import (
    FirestoreClient,
    FirestoreWatchRepository,
)
from trainwatch.ports.watches import WatchDataError, WatchRepository


class FakeSnapshot:
    """In-memory snapshot matching the adapter's narrow protocol."""

    def __init__(self, data: dict[str, object] | None) -> None:
        """Represent a stored document or an absent snapshot."""
        self.exists = data is not None
        self._data = data

    def to_dict(self) -> dict[str, object] | None:
        """Return a defensive copy of stored fields."""
        return None if self._data is None else dict(self._data)


class FakeDocument:
    """In-memory document with child-collection support."""

    def __init__(self, store: dict[str, dict[str, object]], path: str) -> None:
        """Bind a document path to the shared in-memory store."""
        self._store = store
        self._path = path

    def collection(self, collection_path: str) -> FakeCollection:
        """Select a child collection."""
        return FakeCollection(self._store, f"{self._path}/{collection_path}")

    async def get(self) -> FakeSnapshot:
        """Read one stored document without I/O."""
        return FakeSnapshot(self._store.get(self._path))

    async def set(self, document_data: Mapping[str, object]) -> object:
        """Replace one stored document without I/O."""
        self._store[self._path] = dict(document_data)
        return object()

    async def delete(self) -> object:
        """Delete one stored document without I/O."""
        self._store.pop(self._path, None)
        return object()


class FakeCollection:
    """In-memory collection used to validate generated paths."""

    def __init__(self, store: dict[str, dict[str, object]], path: str) -> None:
        """Bind a collection path to the shared in-memory store."""
        self._store = store
        self._path = path

    def document(self, document_id: str) -> FakeDocument:
        """Select a document below this collection."""
        return FakeDocument(self._store, f"{self._path}/{document_id}")


class FakeClient:
    """Credential-free Firestore-shaped client."""

    def __init__(self) -> None:
        """Create an empty store for isolated repository tests."""
        self.store: dict[str, dict[str, object]] = {}

    def collection(self, collection_path: str) -> FakeCollection:
        """Select a top-level collection."""
        return FakeCollection(self.store, collection_path)


def watch(
    *,
    watch_id: str = "watch-1",
    owner_id: str = "user-a",
    condition: AlertCondition | None = None,
) -> Watch:
    """Build a deterministic valid watch fixture."""
    created = datetime(2026, 10, 24, 8, 0, tzinfo=UTC)
    return Watch(
        watch_id=watch_id,
        owner_id=owner_id,
        query=TrainQuery(
            train_number="12661",
            source="RJPM",
            destination="MS",
            journey_date=date(2026, 11, 1),
            travel_class="3A",
            quota="GN",
        ),
        condition=condition or AlertCondition(AlertKind.BECOMES_AVAILABLE),
        status=WatchStatus.ACTIVE,
        created_at=created,
        updated_at=created,
    )


@pytest.mark.anyio
async def test_round_trip_uses_owner_scoped_path() -> None:
    """Save and reconstruct a watch only below its owner's reminder path."""
    client = FakeClient()
    repository: WatchRepository = FirestoreWatchRepository(client)
    expected = watch(
        condition=AlertCondition(
            AlertKind.REACHES_THRESHOLD,
            target_status=AvailabilityStatus.RAC,
            maximum_position=11,
        )
    )

    await repository.save(expected)

    assert set(client.store) == {"users/user-a/reminders/watch-1"}
    assert await repository.get(watch_id="watch-1", owner_id="user-a") == expected


@pytest.mark.anyio
async def test_owner_path_prevents_cross_user_reads() -> None:
    """Treat the same watch ID beneath another owner as absent."""
    client = FakeClient()
    repository = FirestoreWatchRepository(client)
    await repository.save(watch())

    assert await repository.get(watch_id="watch-1", owner_id="user-b") is None


@pytest.mark.anyio
async def test_delete_is_idempotent_and_owner_scoped() -> None:
    """Delete only the selected owner's document and tolerate a missing document."""
    client = FakeClient()
    repository = FirestoreWatchRepository(client)
    await repository.save(watch(owner_id="user-a"))
    await repository.save(watch(owner_id="user-b"))

    await repository.delete(watch_id="watch-1", owner_id="user-a")
    await repository.delete(watch_id="watch-1", owner_id="user-a")

    assert await repository.get(watch_id="watch-1", owner_id="user-a") is None
    assert await repository.get(watch_id="watch-1", owner_id="user-b") == watch(owner_id="user-b")


@pytest.mark.anyio
@pytest.mark.parametrize(
    "field,value",
    [
        ("owner_id", "bad/user"),
        ("watch_id", " "),
        ("owner_id", "__reserved__"),
        ("owner_id", "."),
        ("owner_id", ".."),
        ("watch_id", "."),
        ("watch_id", ".."),
        ("owner_id", " . "),
        ("owner_id", " .. "),
        ("watch_id", " . "),
        ("watch_id", " .. "),
    ],
)
async def test_unsafe_document_ids_are_rejected(field: str, value: str) -> None:
    """Reject identifiers that could alter the intended document path."""
    repository = FirestoreWatchRepository(FakeClient())
    arguments = {"owner_id": "user-a", "watch_id": "watch-1", field: value}
    with pytest.raises(ValueError, match="safe Firestore document ID"):
        await repository.get(**arguments)


@pytest.mark.anyio
async def test_overlong_document_id_is_rejected() -> None:
    """Bound document path segments before invoking a client."""
    repository = FirestoreWatchRepository(FakeClient())
    with pytest.raises(ValueError, match="safe Firestore document ID"):
        await repository.get(watch_id="x" * 129, owner_id="user-a")


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("mutation"),
    [
        {"schemaVersion": 2},
        {"schemaVersion": True},
        {"schemaVersion": False},
        {"schemaVersion": 1.0},
        {"schemaVersion": "1"},
        {"schemaVersion": None},
        {"query": "not-a-map"},
        {"condition": "not-a-map"},
        {
            "condition": {
                "kind": "reaches_threshold",
                "targetStatus": "RAC",
                "maximumPosition": True,
            }
        },
        {"status": 3},
        {"createdAt": "not-a-timestamp"},
    ],
)
async def test_malformed_documents_raise_sanitized_data_error(
    mutation: dict[str, object],
) -> None:
    """Fail closed without including stored values in the public exception."""
    client = FakeClient()
    repository = FirestoreWatchRepository(client)
    await repository.save(watch())
    client.store["users/user-a/reminders/watch-1"].update(mutation)

    with pytest.raises(WatchDataError, match="stored watch is malformed") as captured:
        await repository.get(watch_id="watch-1", owner_id="user-a")
    assert "not-a" not in str(captured.value)


@pytest.mark.anyio
async def test_existing_snapshot_without_fields_is_malformed() -> None:
    """Reject a contradictory snapshot rather than treating it as absent."""

    class EmptySnapshot(FakeSnapshot):
        def __init__(self) -> None:
            """Simulate an existing document whose fields are unavailable."""
            super().__init__(None)
            self.exists = True

    class EmptyDocument(FakeDocument):
        def collection(self, collection_path: str) -> FakeCollection:
            """Keep child paths attached to the contradictory snapshot fake."""
            return EmptyCollection(self._store, f"{self._path}/{collection_path}")

        async def get(self) -> FakeSnapshot:
            """Return an existing snapshot without document fields."""
            return EmptySnapshot()

    class EmptyCollection(FakeCollection):
        def document(self, document_id: str) -> FakeDocument:
            """Select a document that returns the contradictory snapshot."""
            return EmptyDocument(self._store, f"{self._path}/{document_id}")

    class EmptyClient(FakeClient):
        def collection(self, collection_path: str) -> FakeCollection:
            """Select a collection of contradictory snapshot documents."""
            return EmptyCollection(self.store, collection_path)

    repository = FirestoreWatchRepository(EmptyClient())
    with pytest.raises(WatchDataError, match="stored watch is malformed"):
        await repository.get(watch_id="watch-1", owner_id="user-a")


def test_production_client_requires_explicit_opt_in() -> None:
    """Refuse to discover ADC or construct a client by default."""
    with pytest.raises(RuntimeError, match="live Firestore access is disabled"):
        create_firestore_client(project_id="project-for-test")


@pytest.mark.parametrize("field", ["project_id", "database_id"])
def test_production_client_rejects_placeholders(field: str) -> None:
    """Refuse placeholder configuration before credential discovery."""
    arguments: dict[str, object] = {
        "project_id": "project-for-test",
        "database_id": "database-for-test",
        "allow_live_access": True,
    }
    arguments[field] = "REPLACE_ME"
    with pytest.raises(ValueError, match="non-placeholder Firestore"):
        create_firestore_client(**arguments)  # type: ignore[arg-type]


def test_production_client_forwards_explicit_configuration(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Construct the Google client only after all safeguards pass."""
    captured: dict[str, str] = {}

    def fake_async_client(*, project: str, database: str) -> FirestoreClient:
        """Capture client configuration without discovering credentials."""
        captured.update(project=project, database=database)
        return cast(FirestoreClient, FakeClient())

    monkeypatch.setattr(client_module, "AsyncClient", fake_async_client)
    result = create_firestore_client(
        project_id=" project-for-test ",
        database_id=" database-for-test ",
        allow_live_access=True,
    )

    assert isinstance(result, FakeClient)
    assert captured == {"project": "project-for-test", "database": "database-for-test"}
