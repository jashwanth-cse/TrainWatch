"""Pure TrainWatch business models and rules."""

from trainwatch.domain.alerts import AlertCondition, AlertKind, should_alert
from trainwatch.domain.availability import (
    AvailabilityObservation,
    AvailabilitySnapshot,
    AvailabilityStatus,
    ProviderFailure,
    compare_availability,
    parse_availability,
)
from trainwatch.domain.watch import TrainQuery, Watch, WatchStatus

__all__ = [
    "AlertCondition",
    "AlertKind",
    "AvailabilityObservation",
    "AvailabilitySnapshot",
    "AvailabilityStatus",
    "ProviderFailure",
    "TrainQuery",
    "Watch",
    "WatchStatus",
    "compare_availability",
    "parse_availability",
    "should_alert",
]
