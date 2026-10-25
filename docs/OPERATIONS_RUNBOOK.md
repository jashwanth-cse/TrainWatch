# TrainWatch Operations & Reliability Runbook

This document details the operational failure modes, retention schedules, backup/recovery procedures, alerting thresholds, and incident runbooks for the TrainWatch production and staging environments.

---

## 1. Data Retention & Privacy Policies

TrainWatch minimizes stored personal and query data in compliance with security guidelines and least-privilege principles.

| Entity | Storage Location | Retention Window | Purge / Archival Mechanism |
|---|---|---|---|
| **Active Watches** | Firestore `watches/{watchId}` | Valid until journey date + 24 hours | Lifecycle sweeper marks status `EXPIRED` once journey date passes. |
| **Expired Watches** | Firestore `watches/{watchId}` | 30 days after expiration | Hard deletion by scheduled cleanup Cloud Function or Cloud Task. |
| **Notification Outbox** | Firestore `notificationOutbox/{key}` | 14 days after terminal state (`DELIVERED` or `FAILED`) | Sweeper queries `sentAt < now - 14d` and issues batch deletes. |
| **Registered Devices** | Firestore `users/{uid}/devices/{devId}` | Active indefinitely; deactivated after 90 days of inactivity | Deactivated automatically on FCM `registration-token-not-registered`. Stale records purged at 90 days. |
| **Internal Execution Logs** | Google Cloud Logging | 30 days | Configured via GCP Log Bucket retention policy. |
| **Operational Metrics** | Google Cloud Monitoring | 45 days (standard rolling retention) | Automated roll-up by Cloud Monitoring. |

### Privacy and Redaction Standards
- **Zero Token Logging:** Never log Authorization headers, Google ID tokens, Firebase bearer tokens, FCM push tokens, internal service keys, or private keys.
- **Log Masking:** All incoming HTTP headers matching `authorization`, `x-internal-token`, `cookie`, `set-cookie`, `fcm-token`, or any header containing `secret` or `token` are masked as `[REDACTED]`.

---

## 2. Backup & Disaster Recovery Expectations

### Objectives
- **Recovery Point Objective (RPO):** 24 hours for database configuration and historical alerts.
- **Recovery Time Objective (RTO):** Under 2 hours to reconstruct services in a secondary GCP region.

### Firestore Automated Backups & PITR
1. **Point-in-Time Recovery (PITR):**
   - Enabled for production Firestore databases, allowing 7-day continuous window restore.
2. **Daily Scheduled Export:**
   - Cloud Scheduler triggers daily Firestore export to a versioned, multi-region Google Cloud Storage (GCS) bucket (`trainwatch-firestore-backups-${PROJECT_ID}`).
   - Bucket lifecycle rule transitions backups to Coldline after 30 days and deletes after 90 days.

### Restore Procedure
```bash
# 1. List available backup timestamps
gcloud firestore operations list --project=trainwatch-prod

# 2. Restore collection group from GCS backup bucket
gcloud firestore import gs://trainwatch-firestore-backups-prod/2026-10-25T00:00:00/ --project=trainwatch-prod
```

---

## 3. Alerting Rules & Thresholds

Alerts are monitored in Google Cloud Monitoring with notifications routed to PagerDuty / On-call Slack.

| Alert Name | Condition | Severity | Action Trigger |
|---|---|---|---|
| **API High Error Rate** | HTTP 5xx responses > 1.0% over a 5-minute rolling window | **P1 (Critical)** | Page primary on-call engineer. |
| **API Latency P99 Spike** | P99 latency > 1,500 ms for 5 consecutive minutes | **P2 (High)** | Investigate upstream Train API latency or Firestore contention. |
| **Rate Limit Spike** | HTTP 429 responses > 100 per minute | **P3 (Medium)** | Check for client retry loops or automated scraping. |
| **Queue Backlog / Latency** | Scheduled watch checks waiting > 5 minutes past `dueAt` | **P2 (High)** | Verify Cloud Tasks queue concurrency and worker autoscaling. |
| **Notification Outbox Failures** | FCM delivery failure rate > 5.0% over 15 minutes | **P2 (High)** | Check FCM sender credentials and FCM service health dashboard. |
| **Worker Upstream Outage** | Provider returning 5xx or connection timeouts for > 3 minutes | **P1 (Critical)** | Enable provider circuit breaker and pause aggressive polling. |

---

## 4. Operational Incident Runbooks

### Runbook A: Upstream Train API Outage or Flakiness
**Symptoms:** Worker returns `ProviderFailure(can_retry=True)` repeatedly; API availability proxy routes return 502/504.
1. Inspect Cloud Logging for upstream error codes:
   ```text
   resource.type="cloud_run_revision"
   jsonPayload.extra.error="ProviderFailure"
   ```
2. If the provider is experiencing total downtime:
   - Worker service automatically backs off exponentially (interval doubles up to maximum 6 hours).
   - Verify that circuit breaker is tripping and not exhausting connection pools.
   - Do not manually force tasks or replay queued checks until provider health is restored.

### Runbook B: High Cloud Tasks Backlog
**Symptoms:** Cloud Tasks queue depth exceeds 1,000 pending tasks; checks are running late.
1. Check Cloud Run worker concurrency and instance count in Cloud Console:
   - Ensure Cloud Run maximum instance count has not hit quota.
2. Inspect worker error rates:
   - Check if workers are failing tasks due to Firestore contention or lease conflicts.
3. If tasks are retrying endlessly:
   - Check task lease expiration: leases expire automatically after 120 seconds.
   - Check worker logs for unhandled exceptions.

### Runbook C: FCM Push Delivery Failures
**Symptoms:** High percentage of notifications marked `FAILED` or repeatedly retried in `notificationOutbox`.
1. Inspect `lastError` in Firestore `notificationOutbox`:
   - `registration-token-not-registered`: Expected client uninstallation or token rotation; automatically triggers device token deactivation.
   - `quota-exceeded` or `401 Unauthorized`: Verify Firebase service account credentials in Secret Manager and FCM project quota.
2. Verify dispatcher service is leasing and dispatching pending items:
   ```bash
   curl -X POST https://api.trainwatch.app/api/v1/internal/notifications/process \
     -H "X-Internal-Token: placeholder"
   ```

### Runbook D: Service Rollback Procedure
If a deployment introduces regressions:
1. Identify the previous stable Cloud Run revision:
   ```bash
   gcloud run revisions list --service=trainwatch-api --project=trainwatch-prod
   ```
2. Roll back traffic 100% to the previous revision immediately:
   ```bash
   gcloud run services update-traffic trainwatch-api \
     --to-revisions=PREVIOUS_REVISION_NAME=100 \
     --project=trainwatch-prod
   ```
3. Verify `/healthz` and `/readyz` report `200 OK` on the rolled-back revision.
