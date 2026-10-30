# Cloud Firestore Configuration for Staging
#
# Firestore Native database and composite indexes are deployed via Firebase CLI:
#   firebase deploy --only firestore:indexes
# using the root `firestore.indexes.json` file.
# This prevents 409 conflict errors between Terraform and Firebase CLI.
