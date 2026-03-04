# Terraform Infrastructure (WHE-28)

This directory contains baseline IaC for deploying the household bot platform on GCP.

## Provisioned resources

- Artifact Registry Docker repository
- Cloud Run service: bot API (public webhook endpoint)
- Cloud Run service: mini app (public web UI)
- Cloud Scheduler job for reminder triggers
- Runtime and scheduler service accounts with least-privilege bindings
- Secret Manager secrets (IDs only, secret values are added separately)
- Optional GitHub OIDC Workload Identity setup for deploy automation

## Architecture (v1)

- `bot-api`: Telegram webhook + app API endpoints
- `mini-app`: front-end delivery
- `scheduler`: triggers `bot-api` internal reminder endpoint using OIDC token

## Prerequisites

- Terraform `>= 1.8`
- Authenticated GCP CLI context (`gcloud auth application-default login` for local)
- Enabled billing on the target GCP project

## Usage

1. Initialize:

```bash
terraform -chdir=infra/terraform init
```

2. Prepare variables:

```bash
cp infra/terraform/terraform.tfvars.example infra/terraform/terraform.tfvars
```

3. Plan:

```bash
terraform -chdir=infra/terraform plan
```

4. Apply:

```bash
terraform -chdir=infra/terraform apply
```

5. Add secret values (after apply):

```bash
echo -n "<value>" | gcloud secrets versions add telegram-webhook-secret --data-file=- --project <project_id>
echo -n "<value>" | gcloud secrets versions add scheduler-shared-secret --data-file=- --project <project_id>
```

## Environments

Recommended approach:

- Keep one state per environment (dev/prod) using separate backend configs or workspaces
- Use `terraform.tfvars` per environment (`dev.tfvars`, `prod.tfvars`)
- Keep `project_id` separate for dev/prod when possible

## CI validation

CI runs:

- `terraform -chdir=infra/terraform fmt -check -recursive`
- `terraform -chdir=infra/terraform init -backend=false`
- `terraform -chdir=infra/terraform validate`

## Notes

- Scheduler job defaults to `paused = true` to prevent accidental sends before app logic is ready.
- Bot API is public to accept Telegram webhooks; scheduler endpoint should still verify app-level auth.
