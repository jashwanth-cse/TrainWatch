"""FCM push notification sender implementations."""

from __future__ import annotations

from typing import Any

from trainwatch.ports.fcm import FcmDeliveryResult


class FakeFcmSender:
    """In-memory test double recording sent push notifications."""

    def __init__(self) -> None:
        """Initialize empty message log."""
        self.sent_messages: list[dict[str, Any]] = []
        self.invalid_tokens: set[str] = set()
        self.simulate_failure: bool = False

    async def send_multicast(
        self,
        *,
        tokens: list[str],
        title: str,
        body: str,
        data: dict[str, str],
    ) -> FcmDeliveryResult:
        """Record the multicast delivery attempt without calling external services."""
        if self.simulate_failure:
            raise RuntimeError("simulated_fcm_network_failure")

        unregistered: list[str] = []
        success = 0
        failure = 0

        for token in tokens:
            if token in self.invalid_tokens:
                unregistered.append(token)
                failure += 1
            else:
                success += 1

        self.sent_messages.append(
            {
                "tokens": list(tokens),
                "title": title,
                "body": body,
                "data": dict(data),
                "success_count": success,
                "failure_count": failure,
            }
        )

        return FcmDeliveryResult(
            success_count=success,
            failure_count=failure,
            unregistered_tokens=unregistered,
        )


class FirebaseFcmSender:
    """Production FCM multicast sender using Firebase Admin SDK."""

    def __init__(self, app: Any = None) -> None:
        """Initialize with an optional Firebase app reference."""
        self._app = app

    async def send_multicast(
        self,
        *,
        tokens: list[str],
        title: str,
        body: str,
        data: dict[str, str],
    ) -> FcmDeliveryResult:
        """Deliver multicast push via firebase_admin.messaging."""
        if not tokens:
            return FcmDeliveryResult(success_count=0, failure_count=0, unregistered_tokens=[])

        try:
            import firebase_admin
            from firebase_admin import messaging  # type: ignore[import-not-found]

            if self._app is None and not firebase_admin._apps:
                firebase_admin.initialize_app()

            android_config = messaging.AndroidConfig(
                priority="high",
                notification=messaging.AndroidNotification(
                    channel_id="trainwatch-alerts",
                    color="#1E3A8A",
                ),
            )
            message = messaging.MulticastMessage(
                tokens=tokens,
                notification=messaging.Notification(
                    title=title,
                    body=body,
                ),
                data=data,
                android=android_config,
            )
            response = messaging.send_each_for_multicast(message, app=self._app)

            unregistered: list[str] = []
            for idx, res in enumerate(response.responses):
                if not res.success and res.exception:
                    code = getattr(res.exception, "code", "")
                    if "registration-token-not-registered" in str(code):
                        unregistered.append(tokens[idx])

            return FcmDeliveryResult(
                success_count=response.success_count,
                failure_count=response.failure_count,
                unregistered_tokens=unregistered,
            )
        except Exception as err:
            raise RuntimeError(f"FCM delivery error: {err}") from err
