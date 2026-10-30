"""Bounded, fair reminder scans using synthetic Firestore state only."""

import asyncio
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from google.auth.credentials import AnonymousCredentials
from google.cloud.firestore_v1 import AsyncClient
from google.cloud.firestore_v1.async_query import AsyncQuery

from trainwatch.domain.availability import (
    AvailabilityObservation,
    AvailabilitySnapshot,
    AvailabilityStatus,
)
from trainwatch.domain.watch import TrainQuery
from trainwatch.main import FirestoreWatchDispatcher


@pytest.mark.anyio
async def test_scan_bounds_work_and_progresses_across_restarts() -> None:
    now = datetime(2026, 11, 1, tzinfo=UTC)
    documents = []
    for index in range(24):
        data: dict[str, Any] = {
            "schemaVersion": 1,
            "status": "active" if index < 22 else "paused",
            "query": {
                "trainNumber": str(10000 + index),
                "source": "MS",
                "destination": "TEN",
                "journeyDate": "2026-11-05",
                "travelClass": "SL",
                "quota": "GN",
            },
            "condition": {"kind": "improves"},
            # Equal creation times exercise the document-path tie breaker.
            "createdAt": now,
            "updatedAt": now,
        }
        if index == 0:
            data["query"]["journeyDate"] = "2026-10-01"
        if index == 1:
            data["schemaVersion"] = 999
        doc = MagicMock(id=f"w{index:02d}")
        doc.reference.path = f"users/u1/reminders/w{index:02d}"
        doc.reference.parent.parent.id = "u1"
        doc.to_dict.side_effect = lambda data=data: dict(data)
        doc.reference.update = AsyncMock(side_effect=lambda fields, data=data: data.update(fields))
        documents.append(doc)

    cursor: dict[str, Any] = {}
    client = MagicMock()
    cursor_ref = client.collection.return_value.document.return_value
    cursor_ref.get = AsyncMock(return_value=MagicMock(to_dict=lambda: dict(cursor)))

    async def save_cursor(fields: dict[str, Any]) -> None:
        cursor.clear()
        cursor.update(fields)

    cursor_ref.set = AsyncMock(side_effect=save_cursor)
    client.document.side_effect = lambda path: MagicMock(path=path)
    query = client.collection_group.return_value
    query.where.return_value = query
    query.order_by.return_value = query
    query.limit.return_value = query
    query.start_after.return_value = query
    reads = []

    async def get_page() -> list[Any]:
        active_filter = query.where.call_args.kwargs["filter"]
        assert (active_filter.field_path, active_filter.op_string, active_filter.value) == (
            "status",
            "==",
            "active",
        )
        candidates = sorted(
            (doc for doc in documents if doc.to_dict()["status"] == "active"),
            key=lambda doc: (doc.to_dict()["createdAt"], doc.reference.path),
            reverse=True,
        )
        if cursor:
            start = query.start_after.call_args.args[0]
            assert start["__name__"].path == cursor["path"]
            candidates = [
                doc
                for doc in candidates
                if (doc.to_dict()["createdAt"], doc.reference.path)
                < (start["createdAt"], start["__name__"].path)
            ]
        page = candidates[: query.limit.call_args.args[0]]
        reads.append(len(page))
        return page

    query.get = AsyncMock(side_effect=get_page)
    in_flight = 0
    peak = 0
    fetched: list[str] = []

    async def fetch(train_query: TrainQuery) -> AvailabilityObservation:
        nonlocal in_flight, peak
        in_flight += 1
        peak = max(peak, in_flight)
        fetched.append(train_query.train_number)
        await asyncio.sleep(0)
        in_flight -= 1
        if train_query.train_number == "10003":
            raise RuntimeError("synthetic provider failure")
        return AvailabilityObservation.success(
            AvailabilitySnapshot(
                status=AvailabilityStatus.AVAILABLE,
                raw_availability="AVAILABLE",
                observed_at=now,
            )
        )

    provider = MagicMock(fetch=AsyncMock(side_effect=fetch))
    counts = []
    for tick in range(5):
        # A fresh service must resume the stored position rather than starve old watches.
        dispatcher = FirestoreWatchDispatcher(
            client, availability_provider=provider, outbox=MagicMock()
        )
        counts.append(
            await dispatcher.dispatch_due_jobs(now=now + timedelta(minutes=tick), limit=7)
        )
    assert counts == [7, 7, 7, 1, 0]
    assert reads == [7, 7, 7, 1, 0]
    assert 1 < peak <= 5
    assert sorted(fetched) == [str(10000 + index) for index in range(2, 22)]
    assert cursor == {}
    # The next sweep retries the failed provider and checks the other watches again.
    for _ in range(4):
        await dispatcher.dispatch_due_jobs(now=now, limit=7)
    assert fetched.count("10003") == 2


@pytest.mark.anyio
@pytest.mark.parametrize("limit", [0, -1])
async def test_nonpositive_limit_does_no_work(limit: int) -> None:
    client = MagicMock()
    assert (
        await FirestoreWatchDispatcher(client).dispatch_due_jobs(
            now=datetime(2026, 11, 1, tzinfo=UTC), limit=limit
        )
        == 0
    )
    client.collection.assert_not_called()
    client.collection_group.assert_not_called()


@pytest.mark.anyio
async def test_query_encodes_cursor_with_existing_index(monkeypatch: pytest.MonkeyPatch) -> None:
    """Use the installed SDK's query encoder without making an RPC or looking up ADC."""
    now = datetime(2026, 11, 1, tzinfo=UTC)
    real_client = AsyncClient(project="synthetic-project", credentials=AnonymousCredentials())  # type: ignore[no-untyped-call]
    client = MagicMock()
    client.collection_group.side_effect = real_client.collection_group
    client.document.side_effect = real_client.document
    cursor_ref = client.collection.return_value.document.return_value
    cursor_ref.get = AsyncMock(
        return_value=MagicMock(
            to_dict=lambda: {
                "createdAt": now,
                "path": "users/u1/reminders/w1",
            }
        )
    )
    cursor_ref.set = AsyncMock()
    captured = []

    async def get(query: AsyncQuery) -> list[Any]:
        captured.append(query._to_protobuf())
        return []

    monkeypatch.setattr(AsyncQuery, "get", get)
    assert await FirestoreWatchDispatcher(client).dispatch_due_jobs(now=now, limit=3) == 0
    encoded = captured[0]
    assert encoded.limit == 3
    assert encoded.from_[0].all_descendants
    assert encoded.where.field_filter.field.field_path == "status"
    assert encoded.where.field_filter.value.string_value == "active"
    assert [order.field.field_path for order in encoded.order_by] == ["createdAt", "__name__"]
    assert all(order.direction == 2 for order in encoded.order_by)  # DESCENDING
    assert encoded.start_at.values[0].timestamp_value == now
    assert encoded.start_at.values[1].reference_value.endswith("/users/u1/reminders/w1")
    assert not encoded.start_at.before  # start_after excludes the saved row
    cursor_ref.set.assert_awaited_once_with({})
    indexes = json.loads(
        (Path(__file__).resolve().parents[3] / "firestore.indexes.json").read_text()
    )
    assert any(
        index["collectionGroup"] == "reminders"
        and index["queryScope"] == "COLLECTION_GROUP"
        and index["fields"]
        == [
            {"fieldPath": "status", "order": "ASCENDING"},
            {"fieldPath": "createdAt", "order": "DESCENDING"},
        ]
        for index in indexes["indexes"]
    )
