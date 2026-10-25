"""Port for retrieving and persisting availability observations."""

from typing import Protocol

from trainwatch.domain.availability import AvailabilityObservation
from trainwatch.domain.watch import TrainQuery


class AvailabilityProvider(Protocol):
    """Return typed observations without exposing provider-specific failures."""

    async def fetch(self, query: TrainQuery) -> AvailabilityObservation:
        """Fetch one observation for a canonical train query."""
        ...


class ObservationRepository(Protocol):
    """Persist and retrieve historical availability observations for condition evaluation."""

    async def save_observation(
        self,
        *,
        watch_id: str,
        observation: AvailabilityObservation,
    ) -> None:
        """Store an observation for the watch."""
        ...

    async def get_latest_observation(
        self,
        *,
        watch_id: str,
    ) -> AvailabilityObservation | None:
        """Return the most recent observation for baseline comparison."""
        ...
