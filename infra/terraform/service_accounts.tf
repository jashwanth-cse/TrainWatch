# Least-Privilege IAM Service Accounts for TrainWatch Staging

# 1. API Service Account (Cloud Run runtime)
resource "google_service_account" "api" {
  account_id   = "sa-trainwatch-api-${var.environment}"
  display_name = "TrainWatch Staging API Service Account"
  description  = "Identity for the public TrainWatch Cloud Run API service"
}

resource "google_project_iam_member" "api_datastore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.api.email}"
}

resource "google_project_iam_member" "api_tasks_enqueuer" {
  project = var.project_id
  role    = "roles/cloudtasks.enqueuer"
  member  = "serviceAccount:${google_service_account.api.email}"
}

resource "google_project_iam_member" "api_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.api.email}"
}

resource "google_project_iam_member" "api_monitoring" {
  project = var.project_id
  role    = "roles/monitoring.metricWriter"
  member  = "serviceAccount:${google_service_account.api.email}"
}

# 2. Worker Service Account (Background task execution)
resource "google_service_account" "worker" {
  account_id   = "sa-trainwatch-worker-${var.environment}"
  display_name = "TrainWatch Staging Worker Service Account"
  description  = "Identity for background reminder evaluation and notifications"
}

resource "google_project_iam_member" "worker_datastore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_project_iam_member" "worker_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_project_iam_member" "worker_monitoring" {
  project = var.project_id
  role    = "roles/monitoring.metricWriter"
  member  = "serviceAccount:${google_service_account.worker.email}"
}

# 3. Cloud Scheduler Invoker Service Account
resource "google_service_account" "scheduler" {
  account_id   = "sa-trainwatch-sched-${var.environment}"
  display_name = "TrainWatch Staging Cloud Scheduler Invoker"
  description  = "Identity used by Cloud Scheduler to trigger internal dispatcher endpoints"
}

# 4. Cloud Tasks Queue Invoker Service Account
resource "google_service_account" "tasks" {
  account_id   = "sa-trainwatch-tasks-${var.environment}"
  display_name = "TrainWatch Staging Cloud Tasks Invoker"
  description  = "Identity used by Cloud Tasks HTTP targets to invoke internal worker endpoints"
}
