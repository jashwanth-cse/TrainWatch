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
from trainwatch.domain.jobs import JobRecord, JobStatus
from trainwatch.domain.notifications import (
    DevicePlatform,
    DeviceRecord,
    NotificationDeliveryStatus,
    NotificationRecord,
)
from trainwatch.domain.smart_routes import (
    SmartRouteQuery,
    SmartRouteResult,
    SmartRouteSolution,
    SolutionTier,
    StationRole,
    SubLeg,
    calculate_recommendation_score,
    compute_leg_horizon,
)
from trainwatch.domain.watch import TrainQuery, Watch, WatchStatus

__all__ = [
    "AlertCondition",
    "AlertKind",
    "AvailabilityObservation",
    "AvailabilitySnapshot",
    "AvailabilityStatus",
    "DevicePlatform",
    "DeviceRecord",
    "JobRecord",
    "JobStatus",
    "NotificationDeliveryStatus",
    "NotificationRecord",
    "ProviderFailure",
    "SmartRouteQuery",
    "SmartRouteResult",
    "SmartRouteSolution",
    "SolutionTier",
    "StationRole",
    "SubLeg",
    "TrainQuery",
    "Watch",
    "WatchStatus",
    "calculate_recommendation_score",
    "compare_availability",
    "compute_leg_horizon",
    "parse_availability",
    "should_alert",
]
