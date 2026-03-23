# AWS Lambda + Pulumi Deployment Runbook

## Purpose

Deploy the bot runtime to AWS Lambda as a Bun container image, publish the miniapp to S3 website hosting, and place Cloudflare in front of both public origins.

This runbook is additive to the current GCP path. It does not replace the existing Terraform/Cloud Run deployment flow.

## Architecture

- Bot/API origin: AWS Lambda Function URL backed by `apps/bot/Dockerfile.lambda`
- Miniapp origin: S3 website hosting for `apps/miniapp/dist`
- Public edge: `api.<domain>` proxied by Cloudflare to the Lambda Function URL
- Public edge: `app.<domain>` proxied by Cloudflare to the S3 website endpoint
- Scheduler: Supabase Cron calling `https://api.<domain>/jobs/reminder/<type>`

## Prerequisites

- AWS account with permissions for ECR, Lambda, IAM, S3, and Secrets Manager
- Pulumi backend access
- Cloudflare zone access
- Supabase project with Cron enabled
- Bun `1.3.10`
- Docker
- AWS CLI

## Required Pulumi config

Set these on the target stack:

```bash
cd infra/pulumi/aws

pulumi config set publicApiHostname "api.example.com"
pulumi config set publicMiniappHostname "app.example.com"
pulumi config set miniAppAllowedOrigins '["https://app.example.com"]' --path
pulumi config set miniAppUrl "https://app.example.com"

pulumi config set --secret telegramBotToken "<token>"
pulumi config set --secret telegramWebhookSecret "<secret>"
pulumi config set --secret databaseUrl "<database-url>"
pulumi config set --secret schedulerSharedSecret "<scheduler-secret>"
pulumi config set --secret openaiApiKey "<openai-key>"
```

Optional:

```bash
pulumi config set environment "prod"
pulumi config set appName "household"
pulumi config set logLevel "info"
pulumi config set purchaseParserModel "gpt-4o-mini"
pulumi config set assistantModel "gpt-4o-mini"
pulumi config set topicProcessorModel "gpt-4o-mini"
pulumi config set memorySize "1024"
pulumi config set timeout "30"
```

## Deploy infrastructure

From the repo root:

```bash
bun run infra:aws:preview -- --stack <stack>
bun run infra:aws:up -- --stack <stack> --yes
```

Capture outputs:

```bash
cd infra/pulumi/aws
pulumi stack output botOriginUrl --stack <stack>
pulumi stack output miniAppWebsiteUrl --stack <stack>
pulumi stack output miniAppBucketName --stack <stack>
pulumi stack output cloudflareApiCnameTarget --stack <stack>
pulumi stack output cloudflareMiniappCnameTarget --stack <stack>
```

## Publish miniapp

From the repo root:

```bash
export AWS_MINIAPP_BUCKET="<bucket-name>"
export BOT_API_URL="https://api.example.com"
export AWS_REGION="<region>"

bun run ops:aws:miniapp:publish
```

## Cloudflare setup

Create proxied DNS records:

- `api` CNAME -> Pulumi output `cloudflareApiCnameTarget`
- `app` CNAME -> Pulumi output `cloudflareMiniappCnameTarget`

Recommended Cloudflare settings:

- SSL/TLS mode: `Flexible` for the S3 website origin path if you keep S3 website hosting
- Cache bypass for `api.<domain>/*`
- Cache static assets aggressively for `app.<domain>/assets/*`
- Optional WAF or rate limits for `/webhook/telegram`
- Optional WAF or rate limits for `/jobs/reminder/*`

Note: S3 website hosting is HTTP-only between Cloudflare and the bucket website endpoint. If you want stricter origin hardening later, move to S3 + CloudFront.

## Telegram webhook cutover

```bash
export TELEGRAM_WEBHOOK_URL="https://api.example.com/webhook/telegram"
export TELEGRAM_BOT_TOKEN="<token>"
export TELEGRAM_WEBHOOK_SECRET="<secret>"

bun run ops:telegram:webhook set
bun run ops:telegram:webhook info
```

## Supabase Cron jobs

Keep the existing HTTP scheduler contract and call the public API through Cloudflare.

Required endpoints:

- `POST https://api.<domain>/jobs/reminder/utilities`
- `POST https://api.<domain>/jobs/reminder/rent-warning`
- `POST https://api.<domain>/jobs/reminder/rent-due`

Required auth:

- Header `x-household-scheduler-secret: <scheduler-secret>`

Suggested schedules:

- utilities: day 4 at 09:00 `Asia/Tbilisi`
- rent-warning: day 1 at 09:00 `Asia/Tbilisi`
- rent-due: day 3 at 09:00 `Asia/Tbilisi`

## Validation

Run the existing smoke checks with the AWS public URLs:

```bash
export BOT_API_URL="https://api.example.com"
export MINI_APP_URL="https://app.example.com"
export TELEGRAM_EXPECTED_WEBHOOK_URL="${BOT_API_URL}/webhook/telegram"

bun run ops:deploy:smoke
```

Also verify:

- Cloudflare proxies both hostnames successfully
- miniapp session and dashboard endpoints succeed via `api.<domain>`
- Supabase Cron can hit each reminder endpoint with the shared secret
