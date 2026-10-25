# Cloud Scheduler Jobs for Dispatching Reminder Checks & Outbox Notifications

resource "google_cloud_scheduler_job" "reminder_dispatcher" {
  name             = "trainwatch-dispatcher-${var.environment}"
  description      = "Periodically triggers TrainWatch reminder check dispatcher"
  schedule         = "*/5 * * * *"
  time_zone        = "Asia/Kolkata"
  attempt_deadline = "60s"
  region           = var.region

  retry_config {
    retry_count          = 1
    max_retry_duration   = "120s"
    min_backoff_duration = "5s"
    max_backoff_duration = "30s"
  }

  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.api.uri}/api/v1/internal/dispatch"

    oidc_token {
      service_account_email = google_service_account.scheduler.email
      audience              = google_cloud_run_v2_service.api.uri
    }
  }
}

resource "google_cloud_scheduler_job" "notification_dispatcher" {
  name             = "trainwatch-notifications-${var.environment}"
  description      = "Periodically flushes pending notification outbox items"
  schedule         = "*/2 * * * *"
  time_zone        = "Asia/Kolkata"
  attempt_deadline = "60s"
  region           = var.region

  retry_config {
    retry_count          = 1
    max_retry_duration   = "60s"
    min_backoff_duration = "5s"
    max_backoff_duration = "20s"
  }

  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.api.uri}/api/v1/internal/notifications/dispatch"
    body        = base64encode("{\"batch_size\": 20, \"lease_seconds\": 60}")
    headers = {
      "Content-Type" = "application/json"
    }

    oidc_token {
      service_account_email = google_service_account.scheduler.email
      audience              = google_cloud_run_v2_service.api.uri
    }
  }
}
