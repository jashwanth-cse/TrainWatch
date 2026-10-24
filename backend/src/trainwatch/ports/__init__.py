"""Infrastructure-independent interfaces used by future application services."""

from trainwatch.ports.availability import AvailabilityProvider
from trainwatch.ports.identity import AuthenticatedUser, TokenVerificationError, TokenVerifier
from trainwatch.ports.train_search import TrainSearchProvider
from trainwatch.ports.watches import WatchDataError, WatchRepository

__all__ = [
    "AuthenticatedUser",
    "AvailabilityProvider",
    "TokenVerificationError",
    "TokenVerifier",
    "TrainSearchProvider",
    "WatchDataError",
    "WatchRepository",
]
