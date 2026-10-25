# Secret Manager Secrets for TrainWatch Staging

resource "google_secret_manager_secret" "internal_service_key" {
  secret_id = "trainwatch-internal-service-key-${var.environment}"

  replication {
    auto {}
  }

  labels = {
    environment = var.environment
    managed_by  = "terraform"
  }
}

resource "google_secret_manager_secret_iam_member" "api_internal_key_access" {
  secret_id = google_secret_manager_secret.internal_service_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}

resource "google_secret_manager_secret" "fcm_credentials" {
  secret_id = "trainwatch-fcm-credentials-${var.environment}"

  replication {
    auto {}
  }

  labels = {
    environment = var.environment
    managed_by  = "terraform"
  }
}

resource "google_secret_manager_secret_iam_member" "api_fcm_access" {
  secret_id = google_secret_manager_secret.fcm_credentials.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}

resource "google_secret_manager_secret_iam_member" "worker_fcm_access" {
  secret_id = google_secret_manager_secret.fcm_credentials.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.worker.email}"
}
