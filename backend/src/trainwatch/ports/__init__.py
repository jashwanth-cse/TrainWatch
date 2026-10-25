"""Infrastructure-independent interfaces used by application services."""

from trainwatch.ports.availability import AvailabilityProvider, ObservationRepository
from trainwatch.ports.devices import DeviceRepository
from trainwatch.ports.fcm import FcmDeliveryResult, FcmSender
from trainwatch.ports.identity import AuthenticatedUser, TokenVerificationError, TokenVerifier
from trainwatch.ports.jobs import JobRepository
from trainwatch.ports.notifications import NotificationOutbox, NotificationOutboxItem
from trainwatch.ports.queue import TaskEnqueuer
from trainwatch.ports.train_search import TrainSearchProvider
from trainwatch.ports.watches import WatchDataError, WatchRepository

__all__ = [
    "AuthenticatedUser",
    "AvailabilityProvider",
    "DeviceRepository",
    "FcmDeliveryResult",
    "FcmSender",
    "JobRepository",
    "NotificationOutbox",
    "NotificationOutboxItem",
    "ObservationRepository",
    "TaskEnqueuer",
    "TokenVerificationError",
    "TokenVerifier",
    "TrainSearchProvider",
    "WatchDataError",
    "WatchRepository",
]
