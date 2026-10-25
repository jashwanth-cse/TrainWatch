variable "project_id" {
  description = "The Google Cloud project ID for staging"
  type        = string
}

variable "region" {
  description = "The primary Google Cloud region for serverless workloads"
  type        = string
  default     = "asia-south1"
}

variable "environment" {
  description = "Deployment environment name"
  type        = string
  default     = "staging"
}

variable "container_image" {
  description = "Artifact Registry container image URI for TrainWatch backend"
  type        = string
  default     = "gcr.io/trainwatch/backend:staging"
}

variable "billing_account_id" {
  description = "The Google Cloud Billing account ID (optional, for budget configuration)"
  type        = string
  default     = ""
}

variable "budget_amount_monthly_usd" {
  description = "Monthly budget alert limit in USD"
  type        = number
  default     = 25
}

variable "alert_notification_email" {
  description = "Email address for monitoring and budget threshold alerts"
  type        = string
  default     = "alerts@example.invalid"
}

variable "train_api_base_url" {
  description = "Base URL for the upstream train search and availability API"
  type        = string
  default     = "https://dream-destiny.cloud.run"
}
