# First Deployment Runbook

## Purpose

Execute the first real deployment with a repeatable sequence that covers infrastructure, secrets, webhook cutover, smoke checks, scheduler rollout, and rollback.

## Preconditions

- `main` is green in CI.
- Terraform baseline has already been reviewed for the target environment.
- You have access to:
  - GCP project
  - GitHub repo settings
  - Telegram bot token
  - Supabase project and database URL

## Required Configuration Inventory

### Terraform variables

Required in your environment `*.tfvars`:

- `project_id`
- `region`
- `environment`
- `bot_api_image`
- `mini_app_image`
- `bot_household_id`
- `bot_household_chat_id`
- `bot_purchase_topic_id`

Recommended:

- `database_url_secret_id = "database-url"`
- `openai_api_key_secret_id = "openai-api-key"`
- optional `supabase_url_secret_id = "supabase-url"`
- optional `supabase_publishable_key_secret_id = "supabase-publishable-key"`
- `bot_feedback_topic_id`
- `bot_mini_app_allowed_origins`
- `scheduler_timezone`
- `scheduler_paused = true`
- `scheduler_dry_run = true`

### Secret Manager values

Create the secret resources via Terraform, then add secret versions for:

- `telegram-bot-token`
- `telegram-webhook-secret`
- `scheduler-shared-secret`
- `database-url`
- optional `openai-api-key`
- optional `supabase-url`
- optional `supabase-publishable-key`

### GitHub Actions secrets

Required for CD:

- `GCP_PROJECT_ID`
- `GCP_WORKLOAD_IDENTITY_PROVIDER`
- `GCP_SERVICE_ACCOUNT`

Recommended:

- `DATABASE_URL`

### GitHub Actions variables

Set if you do not want the defaults:

- `GCP_REGION`
- `ARTIFACT_REPOSITORY`
- `CLOUD_RUN_SERVICE_BOT`
- `CLOUD_RUN_SERVICE_MINI`

## Phase 1: Local Readiness

Run the quality gates locally from the deployment ref:

```bash
bun run format:check
bun run lint
bun run typecheck
bun run test
bun run build
```

If the release includes schema changes, also run:

```bash
bun run db:check
E2E_SMOKE_ALLOW_WRITE=true bun run test:e2e
```

## Phase 2: Provision or Reconcile Infrastructure

1. Prepare environment-specific variables:

```bash
cp infra/terraform/terraform.tfvars.example infra/terraform/dev.tfvars
```

2. Initialize Terraform with the correct state bucket:

```bash
terraform -chdir=infra/terraform init -backend-config="bucket=<terraform-state-bucket>"
```

3. Review and apply:

```bash
terraform -chdir=infra/terraform plan -var-file=dev.tfvars
terraform -chdir=infra/terraform apply -var-file=dev.tfvars
```

4. Capture outputs:

```bash
BOT_API_URL="$(terraform -chdir=infra/terraform output -raw bot_api_service_url)"
MINI_APP_URL="$(terraform -chdir=infra/terraform output -raw mini_app_service_url)"
```

5. If you did not know the mini app URL before the first apply, set `bot_mini_app_allowed_origins = [\"${MINI_APP_URL}\"]` in `dev.tfvars` and apply again.

## Phase 3: Add Runtime Secret Versions

Use the real project ID from Terraform variables:

```bash
echo -n "<telegram-bot-token>" | gcloud secrets versions add telegram-bot-token --data-file=- --project <project_id>
echo -n "<telegram-webhook-secret>" | gcloud secrets versions add telegram-webhook-secret --data-file=- --project <project_id>
echo -n "<scheduler-shared-secret>" | gcloud secrets versions add scheduler-shared-secret --data-file=- --project <project_id>
echo -n "<database-url>" | gcloud secrets versions add database-url --data-file=- --project <project_id>
```

Add optional secret versions only if those integrations are enabled.

For a functional household dev deployment, set `database_url_secret_id = "database-url"` in
`dev.tfvars` before the apply that creates the Cloud Run services. Otherwise the bot deploys
without `DATABASE_URL`, and finance commands, reminders, mini app auth/dashboard, and anonymous
feedback remain disabled.

## Phase 4: Configure GitHub CD

Populate GitHub repository secrets with the Terraform outputs:

- `GCP_PROJECT_ID`
- `GCP_WORKLOAD_IDENTITY_PROVIDER`
- `GCP_SERVICE_ACCOUNT`
- optional `DATABASE_URL`

If you prefer the GitHub CLI:

```bash
gh secret set GCP_PROJECT_ID
gh secret set GCP_WORKLOAD_IDENTITY_PROVIDER
gh secret set GCP_SERVICE_ACCOUNT
gh secret set DATABASE_URL
```

Set GitHub repository variables if you want to override the defaults used by `.github/workflows/cd.yml`.

## Phase 5: Trigger the First Deployment

You have two safe options:

- Merge the deployment ref into `main` and let `CD` run after successful CI.
- Trigger `CD` manually from the GitHub Actions UI with `workflow_dispatch`.

The workflow will:

- optionally run `bun run db:migrate` if `DATABASE_URL` secret is configured
- build and push bot and mini app images
- deploy both Cloud Run services

## Phase 6: Telegram Webhook Cutover

After the bot service is live, set the webhook explicitly:

```bash
export TELEGRAM_BOT_TOKEN="$(gcloud secrets versions access latest --secret telegram-bot-token --project <project_id>)"
export TELEGRAM_WEBHOOK_SECRET="$(gcloud secrets versions access latest --secret telegram-webhook-secret --project <project_id>)"
export TELEGRAM_WEBHOOK_URL="${BOT_API_URL}/webhook/telegram"

bun run ops:telegram:webhook set
bun run ops:telegram:webhook info
```

If you want to discard queued updates during cutover:

```bash
export TELEGRAM_DROP_PENDING_UPDATES=true
bun run ops:telegram:webhook set
```

## Phase 7: Post-Deploy Smoke Checks

Run the smoke script:

```bash
export BOT_API_URL
export MINI_APP_URL
export TELEGRAM_EXPECTED_WEBHOOK_URL="${BOT_API_URL}/webhook/telegram"

bun run ops:deploy:smoke
```

The smoke script verifies:

- bot health endpoint
- mini app root delivery
- mini app auth endpoint is mounted
- scheduler endpoint rejects unauthenticated requests
- Telegram webhook matches the expected URL when bot token is provided

## Phase 8: Scheduler Enablement

First release:

1. Keep `scheduler_paused = true` and `scheduler_dry_run = true` on initial deploy.
2. After smoke checks pass, set `scheduler_paused = false` and apply Terraform.
3. Trigger one job manually:

```bash
gcloud scheduler jobs run household-dev-utilities --location <region> --project <project_id>
```

4. Verify the reminder request succeeded and produced `dryRun: true` logs.
5. Set `scheduler_dry_run = false` and apply Terraform.
6. Trigger one job again and verify the delivery side behaves as expected.

## Rollback

If the release is unhealthy:

1. Pause scheduler jobs again in Terraform:

```bash
terraform -chdir=infra/terraform apply -var-file=dev.tfvars -var='scheduler_paused=true'
```

2. Move Cloud Run traffic back to the last healthy revision:

```bash
gcloud run revisions list --service <bot-service-name> --region <region> --project <project_id>
gcloud run services update-traffic <bot-service-name> --region <region> --project <project_id> --to-revisions <previous-revision>=100
gcloud run revisions list --service <mini-service-name> --region <region> --project <project_id>
gcloud run services update-traffic <mini-service-name> --region <region> --project <project_id> --to-revisions <previous-revision>=100
```

3. If webhook traffic must stop immediately:

```bash
bun run ops:telegram:webhook delete
```

4. If migrations were additive, leave schema in place and roll application code back.
5. If a destructive migration failed, stop and use the rollback SQL prepared in that PR.

## Dev-to-Prod Promotion Notes

- Repeat the same sequence in a separate `prod.tfvars` and Terraform state.
- Keep separate GCP projects for `dev` and `prod` when possible.
- Do not unpause production scheduler jobs until prod smoke checks are complete.
