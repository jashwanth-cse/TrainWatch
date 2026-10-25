#!/usr/bin/env bash
# ==============================================================================
# TrainWatch Staging Deployment Script
# Automates zero-downtime deployment to Google Cloud Run staging environment.
# ==============================================================================

set -euo pipefail

PROJECT_ID="${GOOGLE_CLOUD_PROJECT:-trainwatch-staging-placeholder}"
REGION="${GOOGLE_CLOUD_REGION:-asia-south1}"
SERVICE_NAME="${SERVICE_NAME:-trainwatch-api-staging}"
IMAGE_TAG="${IMAGE_TAG:-staging-latest}"
IMAGE_URI="${REGION}-docker.pkg.dev/${PROJECT_ID}/trainwatch/backend:${IMAGE_TAG}"

echo "=================================================="
echo "TrainWatch Staging Deployment"
echo "Project:   ${PROJECT_ID}"
echo "Region:    ${REGION}"
echo "Service:   ${SERVICE_NAME}"
echo "Image:     ${IMAGE_URI}"
echo "=================================================="

# 1. Pre-flight verification
echo "[1/4] Verifying gcloud authentication and project configuration..."
ACTIVE_PROJECT="$(gcloud config get-value project 2>/dev/null || echo "")"
if [[ "${ACTIVE_PROJECT}" != "${PROJECT_ID}" ]]; then
  echo "Setting gcloud project to ${PROJECT_ID}..."
  gcloud config set project "${PROJECT_ID}"
fi

# 2. Deploy revision to Cloud Run
echo "[2/4] Deploying container revision to Cloud Run..."
gcloud run deploy "${SERVICE_NAME}" \
  --image="${IMAGE_URI}" \
  --region="${REGION}" \
  --platform="managed" \
  --timeout="30s" \
  --concurrency="80" \
  --min-instances="0" \
  --max-instances="3" \
  --cpu="1" \
  --memory="512Mi" \
  --update-env-vars="APP_ENV=staging,LOG_LEVEL=INFO,ENABLE_RATE_LIMITER=true" \
  --quiet

# 3. Retrieve service URL and latest revision
SERVICE_URL="$(gcloud run services describe "${SERVICE_NAME}" --region="${REGION}" --format="value(status.url)")"
REVISION_NAME="$(gcloud run services describe "${SERVICE_NAME}" --region="${REGION}" --format="value(status.latestReadyRevisionName)")"

echo "[3/4] Revision ready: ${REVISION_NAME}"
echo "      Service endpoint: ${SERVICE_URL}"

# 4. Post-deployment smoke health check
echo "[4/4] Executing health check probe..."
HTTP_STATUS="$(curl -s -o /dev/null -w "%{http_code}" "${SERVICE_URL}/healthz" || echo "000")"
if [[ "${HTTP_STATUS}" == "200" ]]; then
  echo "Deployment succeeded! Health probe returned 200 OK."
else
  echo "WARNING: Health probe returned status ${HTTP_STATUS}. Review logs:"
  echo "  gcloud logging read \"resource.type=cloud_run_revision AND resource.labels.service_name=${SERVICE_NAME}\" --limit 20"
  exit 1
fi
