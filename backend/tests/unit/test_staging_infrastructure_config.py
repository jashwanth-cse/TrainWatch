"""Unit tests verifying Phase 10 staging infrastructure, IaC, and Docker configuration."""

from __future__ import annotations

import json
from pathlib import Path

from trainwatch.config import AppSettings

REPO_ROOT = Path(__file__).resolve().parents[3]


def test_firestore_indexes_configuration_valid() -> None:
    """Verify firestore.indexes.json contains valid composite indexes."""
    indexes_file = REPO_ROOT / "firestore.indexes.json"
    assert indexes_file.exists(), "firestore.indexes.json must exist in repository root"

    with open(indexes_file, encoding="utf-8") as f:
        data = json.load(f)

    assert "indexes" in data
    indexes = data["indexes"]
    assert len(indexes) >= 4

    collection_groups = {idx["collectionGroup"] for idx in indexes}
    assert "reminderJobs" in collection_groups
    assert "notificationOutbox" in collection_groups
    assert "reminders" in collection_groups

    # Validate reminderJobs index fields
    reminder_job_indexes = [idx for idx in indexes if idx["collectionGroup"] == "reminderJobs"]
    due_at_index = next(
        idx for idx in reminder_job_indexes if any(f["fieldPath"] == "dueAt" for f in idx["fields"])
    )
    assert due_at_index["fields"][0] == {"fieldPath": "status", "order": "ASCENDING"}
    assert due_at_index["fields"][1] == {"fieldPath": "dueAt", "order": "ASCENDING"}


def test_dockerfile_security_and_port_specifications() -> None:
    """Verify backend Dockerfile complies with unprivileged non-root and Cloud Run standards."""
    dockerfile_path = REPO_ROOT / "backend" / "Dockerfile"
    assert dockerfile_path.exists(), "backend/Dockerfile must exist"

    content = dockerfile_path.read_text(encoding="utf-8")

    assert "FROM python:3.13-slim" in content
    assert "USER 10001:10001" in content or "USER appuser" in content
    assert "EXPOSE 8080" in content
    assert "/healthz" in content
    assert "uvicorn" in content


def test_terraform_iac_files_and_resource_declarations() -> None:
    """Verify Terraform configuration files and least-privilege resource definitions exist."""
    tf_dir = REPO_ROOT / "infra" / "terraform"
    assert tf_dir.exists(), "infra/terraform directory must exist"

    required_files = [
        "versions.tf",
        "variables.tf",
        "service_accounts.tf",
        "secret_manager.tf",
        "firestore.tf",
        "cloud_tasks.tf",
        "cloud_scheduler.tf",
        "cloud_run.tf",
        "monitoring_budget.tf",
        "outputs.tf",
        "terraform.tfvars.example",
    ]
    for filename in required_files:
        assert (tf_dir / filename).exists(), f"Missing required Terraform file: {filename}"

    sa_content = (tf_dir / "service_accounts.tf").read_text(encoding="utf-8")
    assert "sa-trainwatch-api" in sa_content
    assert "sa-trainwatch-worker" in sa_content
    assert "sa-trainwatch-sched" in sa_content
    assert "sa-trainwatch-tasks" in sa_content

    # Cloud tasks concurrency protections
    tasks_content = (tf_dir / "cloud_tasks.tf").read_text(encoding="utf-8")
    assert "max_concurrent_dispatches = 10" in tasks_content
    assert "trainwatch-reminder-jobs" in tasks_content
    assert "trainwatch-notifications" in tasks_content

    # Cloud Run serverless limits
    run_content = (tf_dir / "cloud_run.tf").read_text(encoding="utf-8")
    assert "min_instance_count = 0" in run_content
    assert "max_instance_count = 3" in run_content
    assert "max_instance_request_concurrency = 80" in run_content


def test_deployment_and_rollback_scripts_exist() -> None:
    """Verify zero-downtime deployment and instant rollback scripts are present."""
    deploy_dir = REPO_ROOT / "deploy" / "staging"
    assert deploy_dir.exists(), "deploy/staging directory must exist"

    deploy_sh = deploy_dir / "deploy.sh"
    rollback_sh = deploy_dir / "rollback.sh"
    assert deploy_sh.exists()
    assert rollback_sh.exists()

    deploy_content = deploy_sh.read_text(encoding="utf-8")
    assert "gcloud run deploy" in deploy_content
    assert "/healthz" in deploy_content

    rollback_content = rollback_sh.read_text(encoding="utf-8")
    assert "gcloud run services update-traffic" in rollback_content
    assert "--to-revisions" in rollback_content


def test_app_settings_staging_environment_validation(monkeypatch: object) -> None:
    """Verify AppSettings handles staging configuration correctly."""
    env_overrides = {
        "APP_ENV": "staging",
        "LOG_LEVEL": "WARNING",
        "TRAIN_API_BASE_URL": "https://staging.trainwatch.example.invalid",
        "INTERNAL_SERVICE_KEY": "placeholder_secret_key",
        "RATE_LIMIT_PER_MINUTE": "120",
        "REQUEST_TIMEOUT_SECONDS": "20.0",
        "ENABLE_RATE_LIMITER": "true",
    }
    for k, v in env_overrides.items():
        monkeypatch.setenv(k, v)  # type: ignore[attr-defined]

    settings = AppSettings.from_environment()
    assert settings.app_env == "staging"
    assert settings.log_level == "WARNING"
    assert settings.train_api_base_url == "https://staging.trainwatch.example.invalid"
    assert settings.internal_service_key == "placeholder_secret_key"
    assert settings.rate_limit_per_minute == 120
    assert settings.request_timeout_seconds == 20.0
    assert settings.enable_rate_limiter is True
