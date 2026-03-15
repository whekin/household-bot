#!/bin/bash

# Configuration
PROJECT_ID="gen-lang-client-0200379851"
REGION="europe-west1"
WORKSPACE="${1:-prod}" # Takes first argument, defaults to 'prod'

# Change directory to terraform folder
cd infra/terraform || exit 1

echo "--- Shared Resource Import Utility ---"
echo "Target Project: $PROJECT_ID"
echo "Target Workspace: $WORKSPACE"

# 1. Ensure the workspace exists and is selected
terraform workspace select "$WORKSPACE" || terraform workspace new "$WORKSPACE"

# 2. Construct Resource IDs
echo -e "\nConstructing Resource IDs..."
REPO_ID="projects/$PROJECT_ID/locations/$REGION/repositories/household-bot"
POOL_ID="projects/$PROJECT_ID/locations/global/workloadIdentityPools/github-pool"
PROV_ID="projects/$PROJECT_ID/locations/global/workloadIdentityPools/github-pool/providers/github-provider"

echo "1. Repository Resource ID: $REPO_ID"
echo "2. Identity Pool Resource ID: $POOL_ID"
echo "3. Provider Resource ID: $PROV_ID"

# 3. Perform the Imports
echo -e "\nStarting Terraform Imports..."

# Import Repository
echo -e "\n--- Importing Artifact Registry ---"
terraform import -input=false -var-file="$WORKSPACE.tfvars" google_artifact_registry_repository.containers "$REPO_ID"

# Import Workload Identity Pool
echo -e "\n--- Importing Workload Identity Pool ---"
terraform import -input=false -var-file="$WORKSPACE.tfvars" 'google_iam_workload_identity_pool.github[0]' "$POOL_ID"

# Import Workload Identity Provider
echo -e "\n--- Importing Workload Identity Provider ---"
terraform import -input=false -var-file="$WORKSPACE.tfvars" 'google_iam_workload_identity_pool_provider.github[0]' "$PROV_ID"

echo -e "\n--- Import Complete for $WORKSPACE! ---"
echo "You can now run: bun run infra:apply:$WORKSPACE"
