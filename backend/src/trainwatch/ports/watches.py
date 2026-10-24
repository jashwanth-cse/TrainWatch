"""Port for watch persistence implemented by local fakes or later adapters."""

from typing import Protocol

from trainwatch.domain.watch import Watch


class WatchDataError(RuntimeError):
    """Stored watch data could not be safely reconstructed."""


class WatchRepository(Protocol):
    """Persist watches without coupling domain rules to a database."""

    async def get(self, *, watch_id: str, owner_id: str) -> Watch | None:
        """Return an owned watch when it exists."""
        ...

    async def save(self, watch: Watch) -> None:
        """Persist a validated watch."""
        ...
