# Terraform Infrastructure (WHE-28)

This directory contains baseline IaC for deploying the household bot platform on GCP.

## Provisioned resources

- Artifact Registry Docker repository
- Cloud Run service: bot API (public webhook endpoint)
- Cloud Run service: mini app (public web UI)
- Cloud Scheduler jobs for reminder triggers
- Runtime and scheduler service accounts with least-privilege bindings
- Secret Manager secrets (IDs only, secret values are added separately)
- Optional GitHub OIDC Workload Identity setup for deploy automation

## Architecture (v1)

- `bot-api`: Telegram webhook + app API endpoints
- `mini-app`: front-end delivery
- `scheduler`: triggers `bot-api` reminder endpoints using OIDC tokens

## Prerequisites

- Terraform `>= 1.8`
- Authenticated GCP CLI context (`gcloud auth application-default login` for local)
- Enabled billing on the target GCP project

## Usage

1. Initialize:

```bash
terraform -chdir=infra/terraform init -backend-config="bucket=<terraform-state-bucket>"
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
echo -n "<telegram-bot-token>" | gcloud secrets versions add telegram-bot-token --data-file=- --project <project_id>
echo -n "<value>" | gcloud secrets versions add telegram-webhook-secret --data-file=- --project <project_id>
echo -n "<value>" | gcloud secrets versions add scheduler-shared-secret --data-file=- --project <project_id>
```

If you configure optional secret IDs such as `database_url_secret_id` or
`openai_api_key_secret_id`, add versions for those secrets as well.

If GitHub OIDC deploy access is enabled, keep `telegram_bot_token_secret_id` aligned with the
real bot token secret name so CD can read it and sync Telegram commands automatically.

## Environments

Recommended approach:

- Keep one state per environment (dev/prod) using separate backend configs or workspaces
- Use `terraform.tfvars` per environment (`dev.tfvars`, `prod.tfvars`)
- Keep `project_id` separate for dev/prod when possible
- Keep non-secret bot config in `*.tfvars`:
  - optional `bot_parser_model`
  - optional `bot_purchase_parser_model`
  - optional `bot_assistant_model`
  - optional assistant runtime knobs:
    `bot_assistant_timeout_ms`,
    `bot_assistant_memory_max_turns`,
    `bot_assistant_rate_limit_burst`,
    `bot_assistant_rate_limit_burst_window_ms`,
    `bot_assistant_rate_limit_rolling`,
    `bot_assistant_rate_limit_rolling_window_ms`
  - optional `bot_mini_app_allowed_origins`

## CI validation

CI runs:

- `terraform -chdir=infra/terraform fmt -check -recursive`
- `terraform -chdir=infra/terraform init -backend=false`
- `terraform -chdir=infra/terraform validate`

## Notes

- Scheduler jobs default to `paused = true` and `dry_run = true` to prevent accidental sends before live reminder delivery is ready.
- Bot API is public to accept Telegram webhooks; scheduler endpoint should still verify app-level auth.
- `bot_mini_app_allowed_origins` cannot be auto-derived in Terraform because the bot and mini app Cloud Run services reference each other; set it explicitly once the mini app URL is known.
