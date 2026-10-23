"""Infrastructure-independent interfaces used by future application services."""

from trainwatch.ports.availability import AvailabilityProvider
from trainwatch.ports.watches import WatchRepository

__all__ = ["AvailabilityProvider", "WatchRepository"]
