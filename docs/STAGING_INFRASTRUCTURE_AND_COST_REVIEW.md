# TrainWatch Staging Infrastructure & Cost Review (Phase 10)

This document provides the complete infrastructure-as-code specification, least-privilege security permissions matrix, disaster-recovery rollback runbook, and detailed cost analysis for the TrainWatch staging environment.

> [!IMPORTANT]
> **Phase 10 Exit Gate**: No cloud resources will be provisioned or billed without explicit user approval. All infrastructure definitions are staged declaratively in `infra/terraform/` and `deploy/staging/`.

---

## 1. Staging Architecture Overview

The staging environment uses a 100% serverless, zero-idle-cost architecture on Google Cloud Platform, isolated in a dedicated project (`trainwatch-staging`):

```text
                                       +-----------------------+
                                       |  Cloud Scheduler      |
                                       |  (5m dispatcher cron) |
                                       +-----------+-----------+
                                                   |
                                                   | OIDC (sa-trainwatch-sched)
                                                   v
+------------------+     HTTPS (Public)     +-----------------------+     Claim & Lease      +--------------------+
|  Mobile Client   | ---------------------> |  Cloud Run Service    | <--------------------> |  Cloud Firestore   |
|  (Staging App)   |   Bearer Firebase ID   |  (trainwatch-api)     |                        |  (Native mode)     |
+------------------+                        +-----------+-----------+                        +--------------------+
                                                        |
                                                        | Enqueue Task
                                                        v
                                            +-----------------------+
                                            |  Cloud Tasks Queue    |
                                            |  (Concurrency: 10)    |
                                            +-----------+-----------+
                                                        |
                                                        | HTTP POST (sa-trainwatch-tasks)
                                                        v
                                            +-----------------------+     Deliver Push       +--------------------+
                                            |  Worker Process Job   | ---------------------> |  Firebase Cloud    |
                                            |  (/internal/worker)   |                        |  Messaging (FCM)   |
                                            +-----------------------+                        +--------------------+
```

---

## 2. Resource Inventory & Configuration

| Resource | Service | Resource ID / Name | Configuration & Sizing | Purpose |
|---|---|---|---|---|
| **API & Worker Service** | Cloud Run (v2) | `trainwatch-api-staging` | 1 vCPU, 512 MiB RAM, Concurrency: 80, Min instances: 0, Max instances: 3, Timeout: 30s | Serves public client API and internal worker endpoints. Scales to 0 when idle. |
| **NoSQL Database** | Cloud Firestore | `(default)` | Native mode, Region: `asia-south1`, Delete protection enabled | Stores user watches, device tokens, notification outbox, and observation history. |
| **Reminder Task Queue** | Cloud Tasks | `trainwatch-reminder-jobs-staging` | Max concurrent dispatches: 10, Rate: 5/s, Max retries: 5, Backoff: 5s–60s | Buffers and throttles upstream train API requests, preventing rate-limit violations. |
| **Notification Queue** | Cloud Tasks | `trainwatch-notifications-staging` | Max concurrent dispatches: 5, Rate: 10/s, Max retries: 3, Backoff: 2s–30s | Buffers asynchronous push notification delivery. |
| **Dispatcher Cron** | Cloud Scheduler | `trainwatch-dispatcher-staging` | Schedule: `*/5 * * * *` (every 5 min), OIDC auth, deadline: 60s | Invokes `/api/v1/internal/dispatch` to find and enqueue due reminder jobs. |
| **Notification Cron** | Cloud Scheduler | `trainwatch-notifications-staging` | Schedule: `*/2 * * * *` (every 2 min), OIDC auth, deadline: 60s | Flushes pending outbox notifications to FCM. |
| **Internal Auth Secret** | Secret Manager | `trainwatch-internal-service-key-staging` | Automatic replication | Shared authentication key securing internal worker/dispatcher routes. |
| **FCM Secret** | Secret Manager | `trainwatch-fcm-credentials-staging` | Automatic replication | Service account JSON / credentials for delivering push notifications. |
| **Alert Notification** | Cloud Monitoring | `TrainWatch Staging Operational Alerts` | Email notification channel | Alerts maintainers of 5xx errors or task delivery failures. |
| **5xx Alert Policy** | Cloud Monitoring | `TrainWatch Cloud Run 5xx Error Rate High` | Threshold: > 5 errors in 5 min window | Detects runtime crashes or uncaught exceptions. |
| **Task Failure Alert** | Cloud Monitoring | `TrainWatch Cloud Tasks Execution Failures` | Threshold: > 5 failures in 5 min window | Detects worker task failures and queue exhaustion. |
| **Monthly Budget Cap** | Cloud Billing | `TrainWatch Staging Monthly Budget Cap` | Target: $25 USD / ~Rs. 2,100 INR, Thresholds: 50%, 80%, 100% | Proactive spend alert preventing unexpected billing surprises. |

---

## 3. Least-Privilege IAM Permissions Matrix

TrainWatch follows strict separation of duties. Zero broad or wildcard administrative roles are granted.

| Service Account | Bound Email Pattern | Assigned IAM Roles | Security Justification |
|---|---|---|---|
| **API Runtime** | `sa-trainwatch-api-staging@...` | • `roles/datastore.user`<br>• `roles/cloudtasks.enqueuer`<br>• `roles/secretmanager.secretAccessor`<br>• `roles/logging.logWriter`<br>• `roles/monitoring.metricWriter` | Permitted to read/write Firestore records, enqueue Cloud Tasks, retrieve internal secret keys, and write structured telemetry. Cannot deploy services or alter infrastructure. |
| **Worker Runtime** | `sa-trainwatch-worker-staging@...` | • `roles/datastore.user`<br>• `roles/secretmanager.secretAccessor`<br>• `roles/logging.logWriter`<br>• `roles/monitoring.metricWriter` | Permitted to claim jobs, evaluate observations, and access FCM credentials. Has no task creation or IAM privileges. |
| **Scheduler Caller** | `sa-trainwatch-sched-staging@...` | • `roles/run.invoker` (bound specifically to `trainwatch-api-staging`) | Only authorized to generate OIDC tokens to trigger the Cloud Run dispatcher endpoints. No data or secret access. |
| **Tasks Queue Caller** | `sa-trainwatch-tasks-staging@...` | • `roles/run.invoker` (bound specifically to `trainwatch-api-staging`) | Only authorized to generate OIDC tokens to invoke `/api/v1/internal/worker/process-job`. No data access. |
| **Deployer / CI-CD** | `sa-trainwatch-deployer-staging@...` | • `roles/run.developer`<br>• `roles/iam.serviceAccountUser` | Restricted to building and rolling out container revisions to Cloud Run. Cannot modify billing or IAM permissions. |

---

## 4. Firestore Composite Indexes

Defined in `firestore.indexes.json` and provisioned by `infra/terraform/firestore.tf`:

1. **`reminderJobs`**: `status` ASC, `dueAt` ASC (Supports dispatcher querying due checks).
2. **`reminderJobs`**: `status` ASC, `leaseUntil` ASC (Supports stale lease reconciliation).
3. **`notificationOutbox`**: `status` ASC, `createdAt` ASC (Supports chronological notification dispatch).
4. **`notificationOutbox`**: `status` ASC, `leaseUntil` ASC (Supports outbox retry leasing).
5. **`reminders` (Collection Group)**: `status` ASC, `createdAt` DESC (Supports user reminders listing).

Direct document lookups (`users/{uid}/reminders/{watchId}`) and single-field queries do not require composite indexes and are handled by default single-field indexing.

---

## 5. Monthly Cost Estimation & Free Tier Analysis

All staging resources were selected to operate almost entirely within Google Cloud's **Always Free Tier**.

### Staging Usage Assumptions:
- Up to 10 active test watches.
- 5-minute polling interval: \(10 \times 12 \text{ checks/hour} \times 24 \text{ hours} \times 30 \text{ days} = 86,400\text{ checks/month}\).
- Average check duration: 250ms with 512 MiB RAM.
- ~100 push notifications/month.

### Cost Breakdown Table:

| Google Cloud Service | Always Free Allowance | Expected Monthly Staging Consumption | Billed Consumption | Estimated Cost (USD) | Estimated Cost (INR) |
|---|---|---|---|---|---|
| **Cloud Run** | • 2M requests/mo<br>• 360,000 vCPU-seconds<br>• 180,000 GiB-seconds | • ~90,000 requests<br>• ~22,500 vCPU-seconds<br>• ~11,250 GiB-seconds | 0 | **$0.00** | **₹0.00** |
| **Cloud Firestore** | • 1 GiB storage<br>• 50,000 reads/day<br>• 20,000 writes/day | • ~15 MiB storage<br>• ~6,000 reads/day<br>• ~3,000 writes/day | 0 | **$0.00** | **₹0.00** |
| **Cloud Tasks** | • 1,000,000 tasks/mo | • ~90,000 tasks/mo | 0 | **$0.00** | **₹0.00** |
| **Cloud Scheduler** | • 3 free jobs / billing account | • 2 jobs configured | 0 | **$0.00** | **₹0.00** |
| **Secret Manager** | • 6 secret versions active | • 3 secret versions active | 0 | **$0.00** | **₹0.00** |
| **Cloud Monitoring & Logging** | • 50 GiB logs/mo | • ~2 GiB structured logs | 0 | **$0.00** | **₹0.00** |
| **Firebase Cloud Messaging** | • 100% free / unlimited | • ~100 notifications/mo | 0 | **$0.00** | **₹0.00** |
| **Network Egress (North America / Asia)** | • 100 GiB/mo free | • < 1 GiB/mo | 0 | **$0.00** | **₹0.00** |
| **Total Estimated Staging Cost** | — | — | — | **$0.00 – $0.50** | **₹0.00 – ₹42.00** |

> [!NOTE]
> Even if traffic exceeds typical staging volumes by 500%, monthly billing remains under **$1.50 USD (~₹125 INR)**. A hard budget limit of **$25.00 USD (~₹2,100 INR)** is enforced with alerts triggered at 50%, 80%, and 100%.

---

## 6. Deployment & Rollback Runbook

### Deployment Procedure (`deploy/staging/deploy.sh`):
1. Build and tag backend container:
   ```bash
   docker build -t asia-south1-docker.pkg.dev/trainwatch-staging/trainwatch/backend:staging-latest backend/
   docker push asia-south1-docker.pkg.dev/trainwatch-staging/trainwatch/backend:staging-latest
   ```
<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:9c5e8690501b2040b34925f1872abedfaf86ea9c62410d674c6cefdd98bd9bb3 -->

2. Provision Firestore for a new staging project, before deploying the service. Confirm the project and Firestore location first: database locations cannot be changed later. If `(default)` already exists, verify that it is a Native-mode database in the intended location instead of creating it again. Enable Firebase for the project and install/authenticate the Firebase CLI, then run from the repository root:
   ```bash
   gcloud firestore databases create --project="$GOOGLE_CLOUD_PROJECT" --database="(default)" --location="$GOOGLE_CLOUD_REGION" --type=firestore-native
   firebase deploy --project "$GOOGLE_CLOUD_PROJECT" --only firestore:indexes
   ```
   Wait for index creation to finish before using indexed queries.
3. Configure an access-restricted, encrypted remote Terraform state backend before applying. Terraform state contains the generated internal service key; never commit, share publicly, or log it. From the repository root:
   ```bash
   (cd infra/terraform && terraform init && terraform apply -var-file="terraform.tfvars")
   ```
   The generated secret replaces the former known placeholder. For an existing deployment that used the placeholder, restrict internal endpoint access during rotation, deploy the new revision, and disable the old Secret Manager version after verifying the new key is active. Treat the old key as compromised.
4. Deploy the new revision:
   ```bash
   ./deploy/staging/deploy.sh
   ```
5. Automated verification: the script probes `/healthz` on the tagged revision before shifting traffic to that exact revision.

<!-- /coderabbit-ai-generated:v1 -->

### Instant Rollback Procedure (`deploy/staging/rollback.sh`):
If an issue occurs post-deployment, roll back traffic instantaneously without rebuilding containers:
```bash
./deploy/staging/rollback.sh
```
This re-routes 100% of Cloud Run traffic back to the immediately preceding healthy revision within < 5 seconds.

---

## 7. Approval Sign-Off Gate

Prior to executing any `terraform apply` or `gcloud run deploy` against live staging projects:

- [ ] Project ID and billing account confirmed by the project owner.
- [ ] IAM service accounts and least-privilege permissions accepted.
- [ ] Concurrency limit (10 tasks max) on Cloud Tasks accepted to protect upstream IRCTC / Dream Destiny endpoints.
- [ ] Zero-idle-cost scaling model (min instances = 0) approved.
- [ ] $25 monthly budget ceiling approved.
