# Cloud Monitoring Alerts and GCP Billing Budget

# Notification channel for operational alerts
resource "google_monitoring_notification_channel" "email" {
  display_name = "TrainWatch Staging Operational Alerts"
  type         = "email"

  labels = {
    email_address = var.alert_notification_email
  }
}

# Alert on Cloud Run 5xx server errors (> 5% error rate)
resource "google_monitoring_alert_policy" "cloud_run_errors" {
  display_name = "TrainWatch Cloud Run 5xx Error Rate High"
  combiner     = "OR"

  conditions {
    display_name = "Cloud Run 5xx response count > 5"

    condition_threshold {
      filter          = "resource.type = \"cloud_run_revision\" AND metric.type = \"run.googleapis.com/request_count\" AND metric.labels.response_code_class = \"5xx\""
      duration        = "300s"
      comparison      = "COMPARISON_GT"
      threshold_value = 5

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_RATE"
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email.name]

  alert_strategy {
    auto_close = "1800s"
  }
}

# Alert on Cloud Tasks failure rate
resource "google_monitoring_alert_policy" "cloud_tasks_failures" {
  display_name = "TrainWatch Cloud Tasks Execution Failures"
  combiner     = "OR"

  conditions {
    display_name = "Tasks failure count > 5"

    condition_threshold {
      filter          = "resource.type = \"cloud_tasks_queue\" AND metric.type = \"cloudtasks.googleapis.com/queue/task_attempt_count\" AND metric.labels.response_status != \"OK\""
      duration        = "300s"
      comparison      = "COMPARISON_GT"
      threshold_value = 5

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_RATE"
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email.name]
}

# Cloud Billing Budget with threshold notifications
resource "google_billing_budget" "staging_budget" {
  count = var.billing_account_id != "" ? 1 : 0

  billing_account = var.billing_account_id
  display_name    = "TrainWatch Staging Monthly Budget Cap"

  budget_filter {
    projects = ["projects/${var.project_id}"]
  }

  amount {
    specified_amount {
      currency_code = "USD"
      units         = tostring(var.budget_amount_monthly_usd)
    }
  }

  threshold_rules {
    threshold_percent = 0.50
    spend_basis       = "CURRENT_SPEND"
  }

  threshold_rules {
    threshold_percent = 0.80
    spend_basis       = "CURRENT_SPEND"
  }

  threshold_rules {
    threshold_percent = 1.00
    spend_basis       = "CURRENT_SPEND"
  }

  all_updates_rule {
    monitoring_notification_channels = [google_monitoring_notification_channel.email.name]
    disable_default_iam_recipients  = false
  }
}
