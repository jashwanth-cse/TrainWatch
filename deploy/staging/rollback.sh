#!/usr/bin/env bash
# ==============================================================================
# TrainWatch Staging Instant Rollback Script
# Reverts Cloud Run traffic to the previous known-healthy revision.
# ==============================================================================

set -euo pipefail

PROJECT_ID="${GOOGLE_CLOUD_PROJECT:-trainwatch-staging-placeholder}"
REGION="${GOOGLE_CLOUD_REGION:-asia-south1}"
SERVICE_NAME="${SERVICE_NAME:-trainwatch-api-staging}"
TARGET_REVISION="${1:-}"

echo "=================================================="
echo "TrainWatch Staging Traffic Rollback"
echo "Project:  ${PROJECT_ID}"
echo "Region:   ${REGION}"
echo "Service:  ${SERVICE_NAME}"
echo "=================================================="

# 1. Identify target revision if not explicitly provided
if [[ -z "${TARGET_REVISION}" ]]; then
  echo "Finding previous healthy revisions..."
  PREVIOUS_REVISION="$(gcloud run revisions list \
    --service="${SERVICE_NAME}" \
    --region="${REGION}" \
    --project="${PROJECT_ID}" \
    --format="value(metadata.name)" \
    --sort-by="~metadata.creationTimestamp" \
    --limit=2 | tail -n 1)"

  if [[ -z "${PREVIOUS_REVISION}" ]]; then
    echo "ERROR: Unable to locate a previous revision to roll back to."
    exit 1
  fi
  TARGET_REVISION="${PREVIOUS_REVISION}"
fi

echo "Rolling back 100% traffic to revision: ${TARGET_REVISION}..."

# 2. Shift 100% traffic to target revision
gcloud run services update-traffic "${SERVICE_NAME}" \
  --region="${REGION}" \
  --project="${PROJECT_ID}" \
  --to-revisions="${TARGET_REVISION}=100" \
  --quiet

# 3. Verify health probe
SERVICE_URL="$(gcloud run services describe "${SERVICE_NAME}" --region="${REGION}" --project="${PROJECT_ID}" --format="value(status.url)")"
echo "Validating health on ${SERVICE_URL}/healthz..."
HTTP_STATUS="$(curl -s -o /dev/null -w "%{http_code}" "${SERVICE_URL}/healthz" || echo "000")"

if [[ "${HTTP_STATUS}" == "200" ]]; then
  echo "Rollback successful! Traffic fully routed to ${TARGET_REVISION} (Health: 200 OK)."
else
  echo "WARNING: Health check after rollback returned status ${HTTP_STATUS}."
  exit 1
fi
