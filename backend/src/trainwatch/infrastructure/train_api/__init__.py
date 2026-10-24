"""Dream Destiny train-service adapter."""

from trainwatch.infrastructure.train_api.client import (
    DreamDestinyClient,
    TrainApiError,
    TrainApiFailure,
    create_train_api_http_client,
)

__all__ = [
    "DreamDestinyClient",
    "TrainApiError",
    "TrainApiFailure",
    "create_train_api_http_client",
]
