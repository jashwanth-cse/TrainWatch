# Cloud Firestore Composite Indexes for Staging
# Note: The (default) database is already created via Firebase Console.
# We configure composite indexes against "(default)".

# 1. reminderJobs: status ASC, dueAt ASC (Dispatcher query)
resource "google_firestore_index" "reminder_jobs_due" {
  project    = var.project_id
  database   = "(default)"
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
  database   = "(default)"
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
  database   = "(default)"
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
  database   = "(default)"
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
  database    = "(default)"
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
