# Terraform IaC Runbook

## Purpose

Provision and maintain GCP infrastructure for bot API, mini app, scheduler, and runtime secrets.

## Prerequisites

- Terraform `>= 1.8`
- GCP project with billing enabled
- Local auth:

```bash
gcloud auth application-default login
```

## Bootstrap

```bash
cp infra/terraform/terraform.tfvars.example infra/terraform/terraform.tfvars
terraform -chdir=infra/terraform init -backend-config="bucket=<terraform-state-bucket>"
terraform -chdir=infra/terraform plan
terraform -chdir=infra/terraform apply
```

## Quality checks

```bash
bun run infra:fmt:check
bun run infra:validate
```

## Add secret values

After first apply, add secret versions:

```bash
echo -n "<telegram-bot-token>" | gcloud secrets versions add telegram-bot-token --data-file=- --project <project_id>
echo -n "<telegram-webhook-secret>" | gcloud secrets versions add telegram-webhook-secret --data-file=- --project <project_id>
echo -n "<scheduler-shared-secret>" | gcloud secrets versions add scheduler-shared-secret --data-file=- --project <project_id>
```

If you set optional secret IDs such as `database_url_secret_id` or
`openai_api_key_secret_id`, add versions for those secrets too.

For a functional dev bot, set at least:

- `database_url_secret_id = "database-url"`
- `telegram_bot_token_secret_id = "telegram-bot-token"`
- optional `openai_api_key_secret_id = "openai-api-key"`

If `create_workload_identity = true`, Terraform also grants the GitHub deploy service account
`secretAccessor` on `telegram_bot_token_secret_id` so CD can sync Telegram commands after deploy.

Keep bot runtime config that is not secret in your `*.tfvars` file:

- `bot_mini_app_allowed_origins`
- optional `bot_purchase_parser_model`
- optional `bot_assistant_model`
- optional `bot_assistant_router_model`

Set `bot_mini_app_allowed_origins` to the exact mini app origins you expect in each environment.
Do not rely on permissive origin reflection in production.

## Reminder jobs

Terraform provisions three separate Cloud Scheduler jobs:

- `utilities`
- `rent-warning`
- `rent-due`

They target the bot runtime endpoints:

- `/jobs/reminder/utilities`
- `/jobs/reminder/rent-warning`
- `/jobs/reminder/rent-due`

Recommended rollout:

- keep `scheduler_paused = true` and `scheduler_dry_run = true` on first apply
- confirm `bot_mini_app_allowed_origins` is set for the environment before exposing the mini app
- validate job responses and logs
- unpause when the delivery side is ready
- disable dry-run only after production verification

## Environment strategy

- Keep separate states for `dev` and `prod`.
- Prefer separate GCP projects for stronger isolation.
- Keep environment-specific variables in dedicated `*.tfvars` files.

## Destructive operations

Review plan output before apply/destroy:

```bash
terraform -chdir=infra/terraform plan -destroy
terraform -chdir=infra/terraform destroy
```
