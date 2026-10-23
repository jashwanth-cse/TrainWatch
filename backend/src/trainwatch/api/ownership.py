"""Authorization policy for user-owned resources."""

from trainwatch.api.errors import ApiError
from trainwatch.ports.identity import AuthenticatedUser


def require_owner(*, user: AuthenticatedUser, resource_owner_id: str) -> None:
    """Hide both absent and cross-user resources behind the same 404 response."""
    if user.uid != resource_owner_id:
        raise ApiError(status_code=404, code="not_found", message="Resource not found")
