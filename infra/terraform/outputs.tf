output "api_service_url" {
  description = "The publicly reachable URL of the deployed Cloud Run service"
  value       = google_cloud_run_v2_service.api.uri
}

output "api_service_account" {
  description = "Service account running the Cloud Run API"
  value       = google_service_account.api.email
}

output "worker_service_account" {
  description = "Service account processing reminder checks"
  value       = google_service_account.worker.email
}

output "scheduler_service_account" {
  description = "Service account triggering scheduler dispatches"
  value       = google_service_account.scheduler.email
}

output "tasks_service_account" {
  description = "Service account invoking tasks worker endpoints"
  value       = google_service_account.tasks.email
}

output "tasks_queue_name" {
  description = "Name of the reminder check Cloud Tasks queue"
  value       = google_cloud_tasks_queue.reminder_jobs.name
}

output "notifications_queue_name" {
  description = "Name of the outbox notifications Cloud Tasks queue"
  value       = google_cloud_tasks_queue.notifications.name
}

output "secret_internal_key_id" {
  description = "Secret Manager secret ID for internal communication token"
  value       = google_secret_manager_secret.internal_service_key.secret_id
}

output "secret_fcm_credentials_id" {
  description = "Secret Manager secret ID for Firebase FCM credentials"
  value       = google_secret_manager_secret.fcm_credentials.secret_id
}
