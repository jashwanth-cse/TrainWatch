"""Firestore adapters with explicit client construction."""

from trainwatch.infrastructure.firestore.client import create_firestore_client
from trainwatch.infrastructure.firestore.watches import FirestoreWatchRepository

__all__ = ["FirestoreWatchRepository", "create_firestore_client"]
