"""Owner-scoped Firestore persistence for validated watches."""

from __future__ import annotations

import re
from collections.abc import Awaitable, Mapping
from datetime import date, datetime
from typing import Protocol

from trainwatch.domain.alerts import AlertCondition, AlertKind
from trainwatch.domain.availability import AvailabilityStatus
from trainwatch.domain.watch import TrainQuery, Watch, WatchStatus
from trainwatch.ports.watches import WatchDataError

_SCHEMA_VERSION = 1
_MAX_DOCUMENT_ID_LENGTH = 128
_RESERVED_DOCUMENT_ID = re.compile(r"^__.*__$")


class DocumentSnapshot(Protocol):
    """Subset of a Firestore snapshot consumed by the adapter."""

    exists: bool

    def to_dict(self) -> dict[str, object] | None:
        """Return document fields when the document exists."""
        ...


class DocumentReference(Protocol):
    """Subset of an async Firestore document reference."""

    def get(self) -> Awaitable[DocumentSnapshot]:
        """Read one document."""
        ...

    def set(self, document_data: Mapping[str, object]) -> Awaitable[object]:
        """Replace one document."""
        ...

    def delete(self) -> Awaitable[object]:
        """Delete one document."""
        ...

    def collection(self, collection_path: str) -> CollectionReference:
        """Select a child collection."""
        ...


class CollectionReference(Protocol):
    """Subset of a Firestore collection reference."""

    def document(self, document_id: str) -> DocumentReference:
        """Select one document by ID."""
        ...


class FirestoreClient(Protocol):
    """Narrow client contract that keeps tests independent of Google Cloud."""

    def collection(self, collection_path: str) -> CollectionReference:
        """Select a top-level collection."""
        ...


def _document_id(value: str, *, field: str) -> str:
    """Validate a value before using it as one Firestore path segment."""
    normalized = value.strip()
    if (
        not normalized
        or normalized in {".", ".."}
        or "/" in normalized
        or len(normalized) > _MAX_DOCUMENT_ID_LENGTH
        or _RESERVED_DOCUMENT_ID.fullmatch(normalized)
    ):
        raise ValueError(f"{field} is not a safe Firestore document ID")
    return normalized


def _encode(watch: Watch) -> dict[str, object]:
    """Serialize one validated domain watch into the versioned storage schema."""
    return {
        "schemaVersion": _SCHEMA_VERSION,
        "query": {
            "trainNumber": watch.query.train_number,
            "source": watch.query.source,
            "destination": watch.query.destination,
            "journeyDate": watch.query.journey_date.isoformat(),
            "travelClass": watch.query.travel_class,
            "quota": watch.query.quota,
        },
        "condition": {
            "kind": watch.condition.kind.value,
            "targetStatus": (
                watch.condition.target_status.value if watch.condition.target_status else None
            ),
            "maximumPosition": watch.condition.maximum_position,
        },
        "status": watch.status.value,
        "createdAt": watch.created_at,
        "updatedAt": watch.updated_at,
    }


def _mapping(value: object, *, field: str) -> Mapping[str, object]:
    """Require a mapping without exposing stored values in errors."""
    if not isinstance(value, Mapping):
        raise ValueError(f"{field} must be a mapping")
    return value


def _text(value: object, *, field: str) -> str:
    """Require a string storage field."""
    if not isinstance(value, str):
        raise ValueError(f"{field} must be text")
    return value


def _optional_text(value: object, *, field: str) -> str | None:
    """Require an optional string storage field."""
    if value is None:
        return None
    return _text(value, field=field)


def _optional_integer(value: object, *, field: str) -> int | None:
    """Require an optional integer while excluding booleans."""
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{field} must be an integer")
    return value


def _timestamp(value: object, *, field: str) -> datetime:
    """Require a Firestore timestamp decoded as a datetime."""
    if not isinstance(value, datetime):
        raise ValueError(f"{field} must be a timestamp")
    return value


def _decode(data: Mapping[str, object], *, watch_id: str, owner_id: str) -> Watch:
    """Decode and revalidate a versioned Firestore watch document."""
    version = data.get("schemaVersion")
    if isinstance(version, bool) or not isinstance(version, int) or version != _SCHEMA_VERSION:
        raise ValueError("unsupported watch schema version")
    query = _mapping(data.get("query"), field="query")
    condition = _mapping(data.get("condition"), field="condition")
    target = _optional_text(condition.get("targetStatus"), field="targetStatus")
    return Watch(
        watch_id=watch_id,
        owner_id=owner_id,
        query=TrainQuery(
            train_number=_text(query.get("trainNumber"), field="trainNumber"),
            source=_text(query.get("source"), field="source"),
            destination=_text(query.get("destination"), field="destination"),
            journey_date=date.fromisoformat(_text(query.get("journeyDate"), field="journeyDate")),
            travel_class=_text(query.get("travelClass"), field="travelClass"),
            quota=_text(query.get("quota"), field="quota"),
        ),
        condition=AlertCondition(
            kind=AlertKind(_text(condition.get("kind"), field="kind")),
            target_status=AvailabilityStatus(target) if target is not None else None,
            maximum_position=_optional_integer(
                condition.get("maximumPosition"), field="maximumPosition"
            ),
        ),
        status=WatchStatus(_text(data.get("status"), field="status")),
        created_at=_timestamp(data.get("createdAt"), field="createdAt"),
        updated_at=_timestamp(data.get("updatedAt"), field="updatedAt"),
    )


class FirestoreWatchRepository:
    """Store watches below their verified owner's user document."""

    def __init__(self, client: FirestoreClient) -> None:
        """Use the injected client without initiating credential discovery."""
        self._client = client

    def _reference(self, *, watch_id: str, owner_id: str) -> DocumentReference:
        """Validate both identifiers before selecting an owned reminder path."""
        owner = _document_id(owner_id, field="owner_id")
        watch = _document_id(watch_id, field="watch_id")
        return (
            self._client.collection("users").document(owner).collection("reminders").document(watch)
        )

    async def get(self, *, watch_id: str, owner_id: str) -> Watch | None:
        """Return only a watch found beneath the supplied owner's path."""
        snapshot = await self._reference(watch_id=watch_id, owner_id=owner_id).get()
        if not snapshot.exists:
            return None
        data = snapshot.to_dict()
        if data is None:
            raise WatchDataError("stored watch is malformed")
        try:
            return _decode(data, watch_id=watch_id, owner_id=owner_id)
        except (KeyError, TypeError, ValueError) as exc:
            raise WatchDataError("stored watch is malformed") from exc

    async def save(self, watch: Watch) -> None:
        """Replace one owned watch document with its validated representation."""
        await self._reference(watch_id=watch.watch_id, owner_id=watch.owner_id).set(_encode(watch))

    async def delete(self, *, watch_id: str, owner_id: str) -> None:
        """Delete one watch beneath the supplied owner's path."""
        await self._reference(watch_id=watch_id, owner_id=owner_id).delete()
