"""In-memory application metrics tracker for latency, errors, and throughput."""

from __future__ import annotations

import threading
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any


@dataclass
class MetricsRegistry:
    """Thread-safe in-memory metric accumulator."""

    _lock: threading.Lock = field(default_factory=threading.Lock)
    _request_counts: dict[tuple[str, str, int], int] = field(
        default_factory=lambda: defaultdict(int)
    )
    _request_duration_sum: dict[tuple[str, str], float] = field(
        default_factory=lambda: defaultdict(float)
    )
    _request_duration_count: dict[tuple[str, str], int] = field(
        default_factory=lambda: defaultdict(int)
    )
    _counters: dict[str, int] = field(default_factory=lambda: defaultdict(int))

    def record_request(
        self,
        *,
        method: str,
        path: str,
        status_code: int,
        duration_seconds: float,
    ) -> None:
        """Record an HTTP request completion."""
        clean_method = method.upper()
        clean_path = self._sanitize_path(path)
        with self._lock:
            self._request_counts[(clean_method, clean_path, status_code)] += 1
            self._request_duration_sum[(clean_method, clean_path)] += duration_seconds
            self._request_duration_count[(clean_method, clean_path)] += 1

    def increment(self, name: str, count: int = 1) -> None:
        """Increment a named domain counter."""
        with self._lock:
            self._counters[name] += count

    def reset(self) -> None:
        """Reset all metrics (primarily for test isolation)."""
        with self._lock:
            self._request_counts.clear()
            self._request_duration_sum.clear()
            self._request_duration_count.clear()
            self._counters.clear()

    def snapshot(self) -> dict[str, Any]:
        """Return a structured dictionary snapshot of current metrics."""
        with self._lock:
            requests = [
                {
                    "method": m,
                    "path": p,
                    "status_code": s,
                    "count": c,
                }
                for (m, p, s), c in self._request_counts.items()
            ]
            latencies = [
                {
                    "method": m,
                    "path": p,
                    "count": self._request_duration_count[(m, p)],
                    "total_seconds": round(self._request_duration_sum[(m, p)], 4),
                    "avg_ms": round(
                        (
                            self._request_duration_sum[(m, p)]
                            / self._request_duration_count[(m, p)]
                            * 1000
                        )
                        if self._request_duration_count[(m, p)] > 0
                        else 0.0,
                        2,
                    ),
                }
                for (m, p) in self._request_duration_sum
            ]
            return {
                "requests": requests,
                "latencies": latencies,
                "counters": dict(self._counters),
            }

    def to_prometheus_text(self) -> str:
        """Render metrics in standard Prometheus exposition format."""
        lines: list[str] = [
            "# HELP http_requests_total Total HTTP requests served.",
            "# TYPE http_requests_total counter",
        ]
        with self._lock:
            for (m, p, s), c in sorted(self._request_counts.items()):
                lines.append(f'http_requests_total{{method="{m}",path="{p}",status="{s}"}} {c}')

            lines.append("# HELP http_request_duration_seconds Latency of HTTP requests.")
            lines.append("# TYPE http_request_duration_seconds summary")
            for (m, p), total in sorted(self._request_duration_sum.items()):
                cnt = self._request_duration_count[(m, p)]
                lines.append(
                    f'http_request_duration_seconds_sum{{method="{m}",path="{p}"}} {total:.6f}'
                )
                lines.append(
                    f'http_request_duration_seconds_count{{method="{m}",path="{p}"}} {cnt}'
                )

            lines.append("# HELP domain_counters_total Named application domain counters.")
            lines.append("# TYPE domain_counters_total counter")
            for name, val in sorted(self._counters.items()):
                lines.append(f'domain_counters_total{{name="{name}"}} {val}')

        lines.append("")
        return "\n".join(lines)

    @staticmethod
    def _sanitize_path(path: str) -> str:
        """Collapse UUIDs and numeric IDs to normalize metrics cardinality."""
        parts = path.strip("/").split("/")
        clean_parts: list[str] = []
        for part in parts:
            if not part:
                continue
            # Replace UUID-like or purely alphanumeric IDs > 16 chars
            if len(part) >= 16 or any(c.isdigit() for c in part):
                # Check known static tokens
                if part in {"v1", "health", "live", "ready", "metrics", "dispatcher"}:
                    clean_parts.append(part)
                else:
                    clean_parts.append("{id}")
            else:
                clean_parts.append(part)
        return "/" + "/".join(clean_parts) if clean_parts else "/"
