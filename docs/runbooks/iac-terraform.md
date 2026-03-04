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
terraform -chdir=infra/terraform init
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
echo -n "<telegram-webhook-secret>" | gcloud secrets versions add telegram-webhook-secret --data-file=- --project <project_id>
echo -n "<scheduler-shared-secret>" | gcloud secrets versions add scheduler-shared-secret --data-file=- --project <project_id>
```

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
