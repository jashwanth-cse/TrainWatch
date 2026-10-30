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
REVISION_TAG="smoke-$(date +%s)-$$"

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
  --no-traffic \
  --tag="${REVISION_TAG}" \
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

# 3. Identify the exact tagged revision and its URL. Avoid latestReadyRevisionName,
# which can change if another deployment is running concurrently.
SERVICE_JSON="$(gcloud run services describe "${SERVICE_NAME}" --region="${REGION}" --format=json)"
readarray -t TARGET < <(python3 -c '
import json, sys
service = json.load(sys.stdin)
tag = sys.argv[1]
for target in service.get("status", {}).get("traffic", []):
    if target.get("tag") == tag and target.get("revisionName") and target.get("url"):
        print(target["revisionName"])
        print(target["url"])
        break
' "${REVISION_TAG}" <<< "${SERVICE_JSON}")
if [[ "${#TARGET[@]}" -ne 2 ]]; then
  echo "Could not find the tagged revision URL; traffic was not changed." >&2
  exit 1
fi
REVISION_NAME="${TARGET[0]}"
REVISION_URL="${TARGET[1]}"
echo "[3/4] Probing tagged revision ${REVISION_NAME}..."

# 4. Only the tested revision receives traffic after a successful health probe.
if ! HTTP_STATUS="$(curl --silent --show-error --max-time 30 -o /dev/null -w '%{http_code}' "${REVISION_URL}/healthz")" || [[ "${HTTP_STATUS}" != "200" ]]; then
  echo "Health probe failed for ${REVISION_NAME}; traffic was not changed." >&2
  exit 1
fi
echo "[4/4] Shifting traffic to ${REVISION_NAME}..."
gcloud run services update-traffic "${SERVICE_NAME}" \
  --region="${REGION}" \
  --to-revisions="${REVISION_NAME}=100" \
  --quiet
echo "Deployment succeeded."
