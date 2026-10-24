"""Explicit, guarded construction of the production Firestore client."""

from __future__ import annotations

from typing import cast

from google.cloud.firestore_v1 import AsyncClient

from trainwatch.infrastructure.firestore.watches import FirestoreClient

_PLACEHOLDER_VALUES = frozenset({"", "REPLACE_ME", "YOUR_PROJECT_ID"})


def create_firestore_client(
    *,
    project_id: str,
    database_id: str = "(default)",
    allow_live_access: bool = False,
) -> FirestoreClient:
    """Create an ADC-backed client only after an explicit live-access opt-in."""
    project = project_id.strip()
    database = database_id.strip()
    if not allow_live_access:
        raise RuntimeError("live Firestore access is disabled")
    if project in _PLACEHOLDER_VALUES:
        raise ValueError("a non-placeholder Firestore project ID is required")
    if database in _PLACEHOLDER_VALUES:
        raise ValueError("a non-placeholder Firestore database ID is required")
    return cast(FirestoreClient, AsyncClient(project=project, database=database))
