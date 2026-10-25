# Cloud Firestore Native Database & Composite Indexes for Staging

resource "google_firestore_database" "database" {
  project     = var.project_id
  name        = "(default)"
  location_id = var.region
  type        = "FIRESTORE_NATIVE"

  # Delete protection enabled for staging data safety
  delete_protection_state = "DELETE_PROTECTION_ENABLED"
}

# 1. reminderJobs: status ASC, dueAt ASC (Dispatcher query)
resource "google_firestore_index" "reminder_jobs_due" {
  project    = var.project_id
  database   = google_firestore_database.database.name
  collection = "reminderJobs"

  fields {
    field_path = "status"
    order      = "ASCENDING"
  }

  fields {
    field_path = "dueAt"
    order      = "ASCENDING"
  }
}

# 2. reminderJobs: status ASC, leaseUntil ASC (Expired lease recovery)
resource "google_firestore_index" "reminder_jobs_leases" {
  project    = var.project_id
  database   = google_firestore_database.database.name
  collection = "reminderJobs"

  fields {
    field_path = "status"
    order      = "ASCENDING"
  }

  fields {
    field_path = "leaseUntil"
    order      = "ASCENDING"
  }
}

# 3. notificationOutbox: status ASC, createdAt ASC (Notification dispatcher)
resource "google_firestore_index" "notification_outbox_created" {
  project    = var.project_id
  database   = google_firestore_database.database.name
  collection = "notificationOutbox"

  fields {
    field_path = "status"
    order      = "ASCENDING"
  }

  fields {
    field_path = "createdAt"
    order      = "ASCENDING"
  }
}

# 4. notificationOutbox: status ASC, leaseUntil ASC (Outbox lease recovery)
resource "google_firestore_index" "notification_outbox_leases" {
  project    = var.project_id
  database   = google_firestore_database.database.name
  collection = "notificationOutbox"

  fields {
    field_path = "status"
    order      = "ASCENDING"
  }

  fields {
    field_path = "leaseUntil"
    order      = "ASCENDING"
  }
}

# 5. reminders collection group: status ASC, createdAt DESC (Active reminders listing)
resource "google_firestore_index" "reminders_collection_group" {
  project     = var.project_id
  database    = google_firestore_database.database.name
  collection  = "reminders"
  query_scope = "COLLECTION_GROUP"

  fields {
    field_path = "status"
    order      = "ASCENDING"
  }

  fields {
    field_path = "createdAt"
    order      = "DESCENDING"
  }
}
