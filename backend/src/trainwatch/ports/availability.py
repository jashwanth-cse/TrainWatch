"""Port for retrieving one availability observation."""

from typing import Protocol

from trainwatch.domain.availability import AvailabilityObservation
from trainwatch.domain.watch import TrainQuery


class AvailabilityProvider(Protocol):
    """Return typed observations without exposing provider-specific failures."""

    async def fetch(self, query: TrainQuery) -> AvailabilityObservation:
        """Fetch one observation for a canonical train query."""
        ...
