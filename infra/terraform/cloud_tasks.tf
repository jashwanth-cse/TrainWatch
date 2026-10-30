# Cloud Tasks Queues with Strict Concurrency & Backoff Limits

resource "google_cloud_tasks_queue" "reminder_jobs" {
  name     = "trainwatch-reminder-jobs-${var.environment}"
  location = var.region

  rate_limits {
    max_concurrent_dispatches = 10
    max_dispatches_per_second = 5.0
  }

  retry_config {
    max_attempts  = 5
    min_backoff   = "5s"
    max_backoff   = "60s"
    max_doublings = 3
  }

  # Prevent indefinite task queue accumulation
  stackdriver_logging_config {
    sampling_ratio = 1.0
  }
}

resource "google_cloud_tasks_queue" "notifications" {
  name     = "trainwatch-notifications-${var.environment}"
  location = var.region

  rate_limits {
    max_concurrent_dispatches = 5
    max_dispatches_per_second = 10.0
  }

  retry_config {
    max_attempts  = 3
    min_backoff   = "2s"
    max_backoff   = "30s"
    max_doublings = 2
  }

  stackdriver_logging_config {
    sampling_ratio = 1.0
  }
}
